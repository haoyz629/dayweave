use super::*;

// All result writes use the backend clock. A caller's date only identifies the record.
pub(super) fn window(date: Option<&str>, ends_at: Option<&str>) -> bool {
    let Some(date) = date.and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()) else { return false; };
    let today = clock_now().with_timezone(&FixedOffset::east_opt(8 * 3600).unwrap()).date_naive();
    if date == today { return true; }
    if date > today { return false; }
    let Some(end) = ends_at.and_then(|end| DateTime::parse_from_rfc3339(end).ok()) else { return false; };
    let current = clock_now();
    current >= end && current.signed_duration_since(end) <= Duration::hours(6)
}

fn expired() -> AppError { AppError::Domain("已超过结果修改时间".into()) }

pub(super) fn block_context(connection: &Connection, id: &str) -> AppResult<(String, String, String)> {
    Ok(connection.query_row("SELECT pb.task_id, COALESCE(pb.result_date, dp.plan_date), COALESCE(pb.result_ends_at, pb.ends_at)
        FROM plan_blocks pb JOIN daily_plans dp ON dp.id = pb.daily_plan_id WHERE pb.id = ?1", [id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?)
}

pub(super) fn block_window(connection: &Connection, id: &str) -> AppResult<bool> {
    let (_, date, end) = block_context(connection, id)?;
    Ok(window(Some(&date), Some(&end)))
}

pub(super) fn require_block_window(connection: &Connection, id: &str) -> AppResult<()> {
    if !block_window(connection, id)? { return Err(expired()); }
    Ok(())
}

pub(super) fn require_task_window(connection: &Connection, id: &str) -> AppResult<()> {
    let (date, end): (Option<String>, Option<String>) = connection.query_row(
        "SELECT result_date, result_ends_at FROM tasks WHERE id = ?1", [id], |row| Ok((row.get(0)?, row.get(1)?)))?;
    if !window(date.as_deref(), end.as_deref()) { return Err(expired()); }
    Ok(())
}

pub(super) fn freeze_block(connection: &Connection, id: &str) -> AppResult<()> {
    connection.execute("UPDATE plan_blocks SET result_ends_at = COALESCE(result_ends_at, ends_at),
        result_date = COALESCE(result_date, (SELECT plan_date FROM daily_plans WHERE id = daily_plan_id)) WHERE id = ?1", [id])?;
    Ok(())
}

// Context survives reopen, undo and trash restore. Only a genuinely different execution can replace it.
pub(super) fn completion_context(connection: &Connection, task: &TaskDto, block: Option<&str>) -> AppResult<()> {
    let saved_block: Option<String> = connection.query_row("SELECT result_block_id FROM tasks WHERE id = ?1", [&task.id], |row| row.get(0))?;
    if task.status == "done" && block != saved_block.as_deref() {
        return Err(AppError::Domain("不能借其他执行块修改已有整项完成结果".into()));
    }
    if task.status == "done" || (task.result_date.is_some() && (block.is_none() || block == saved_block.as_deref())) {
        if let Some(block) = block { require_block_window(connection, block)?; }
        return require_task_window(connection, &task.id);
    }
    let (date, end) = if let Some(block) = block {
        let (owner, date, end) = block_context(connection, block)?;
        if owner != task.id { return Err(AppError::Domain("执行块不属于该任务".into())); }
        require_block_window(connection, block)?;
        // Never use another old result to reset the task's original completion context.
        if task.result_date.is_some() {
            let recorded: bool = connection.query_row("SELECT result_ends_at IS NOT NULL FROM plan_blocks WHERE id = ?1", [block], |row| row.get(0))?;
            if recorded && task.result_date.as_deref().is_some_and(|old| date.as_str() <= old) { return Err(expired()); }
        }
        freeze_block(connection, block)?;
        (date, Some(end))
    } else {
        (shanghai_today(), task.due_at.clone())
    };
    connection.execute("UPDATE tasks SET result_date = ?2, result_ends_at = ?3, result_block_id = ?4 WHERE id = ?1",
        params![task.id, date, end, block])?;
    Ok(())
}

// Historical block results are always record-only, even inside the whole-task grace window.
pub(super) fn allow_capture(connection: &Connection, date: &str, id: &str) -> AppResult<bool> {
    let (_, actual_date, _) = block_context(connection, id)?;
    if actual_date != date { return Err(AppError::Domain("执行日期必须与执行块所属日期一致".into())); }
    let date = parse_plan_date(date)?;
    let today = parse_plan_date(&shanghai_today())?;
    if date > today { return Err(AppError::Domain("未来日期不能记录执行结果".into())); }
    Ok(date == today)
}

// Migration 26: JSON snapshots are optional evidence, never a reason to abort a user's migration.
pub(super) fn backfill_completion_context(connection: &Connection) -> AppResult<()> {
    let tasks = {
        let mut statement = connection.prepare("SELECT id FROM tasks")?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
        rows
    };
    for id in tasks {
        let durable: Option<(String, Option<String>)> = connection.query_row(
            "SELECT before_json, block_after_json FROM task_completion_snapshots WHERE task_id = ?1", [&id],
            |row| Ok((row.get(0)?, row.get(1)?))).optional()?;
        let undo = {
            let mut statement = connection.prepare("SELECT before_json, created_at FROM undo_entries
                WHERE target_type = 'task_completion' AND target_id = ?1 AND action_kind = 'task_completed'
                ORDER BY julianday(created_at) DESC, rowid DESC")?;
            let rows = statement.query_map([&id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };
        let mut evidence = Vec::new();
        if let Some((before, after)) = durable {
            evidence.push((before, after, None));
        }
        for (before, timestamp) in undo { evidence.push((before, None, Some(timestamp))); }
        let mut original_due = None;
        let mut operation_date = None;
        let mut earliest_operation: Option<DateTime<FixedOffset>> = None;
        let mut recovered = false;
        for (before, after, timestamp) in evidence {
            let Ok(value) = serde_json::from_str::<serde_json::Value>(&before) else { continue; };
            if value["task"]["id"].as_str() != Some(id.as_str()) { continue; }
            if original_due.is_none() { original_due = value["task"]["due_at"].as_str().map(str::to_owned); }
            if let Some(date) = timestamp.and_then(|time| DateTime::parse_from_rfc3339(&time).ok()) {
                if earliest_operation.is_none_or(|old| date < old) {
                    original_due = value["task"]["due_at"].as_str().map(str::to_owned);
                    earliest_operation = Some(date);
                }
                let date = date.with_timezone(&FixedOffset::east_opt(8 * 3600).unwrap()).date_naive().to_string();
                operation_date = Some(operation_date.map_or(date.clone(), |old: String| old.min(date)));
            }
            let after = after.and_then(|json| serde_json::from_str::<serde_json::Value>(&json).ok());
            let block = after.as_ref().and_then(|value| value["id"].as_str())
                .or_else(|| value["block"]["id"].as_str());
            if let Some(block) = block {
                if let Ok((owner, date, end)) = block_context(connection, block) {
                    if owner == id {
                        connection.execute("UPDATE tasks SET result_date = ?2, result_ends_at = ?3, result_block_id = ?4 WHERE id = ?1",
                            params![id, date, end, block])?;
                        recovered = true;
                        break;
                    }
                }
            }
        }
        if recovered { continue; }
        let change_time: Option<String> = connection.query_row("SELECT created_at FROM task_changes WHERE task_id = ?1
            AND change_kind = 'status_changed' AND new_value = 'done' AND old_value IN ('open','scheduled','inbox')
            AND julianday(created_at) IS NOT NULL ORDER BY julianday(created_at), rowid LIMIT 1", [&id], |row| row.get(0)).optional()?;
        if let Some(time) = &change_time {
            // Legacy completions can have a captured execution but no durable completion snapshot.
            let blocks = {
                let mut statement = connection.prepare("SELECT pb.id FROM plan_blocks pb WHERE pb.task_id = ?1
                    AND pb.execution_status = 'completed' AND abs((julianday(pb.execution_captured_at) - julianday(?2)) * 86400) < 1")?;
                let rows = statement.query_map(params![id, time], |row| row.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
                rows
            };
            if blocks.len() == 1 {
                let (_, date, end) = block_context(connection, &blocks[0])?;
                connection.execute("UPDATE tasks SET result_date = ?2, result_ends_at = ?3, result_block_id = ?4 WHERE id = ?1",
                    params![id, date, end, blocks[0]])?;
                continue;
            }
        }
        let change_date = change_time.and_then(|time| DateTime::parse_from_rfc3339(&time).ok())
            .map(|time| time.with_timezone(&FixedOffset::east_opt(8 * 3600).unwrap()).date_naive().to_string());
        let date = match (change_date, operation_date) {
            (Some(a), Some(b)) => Some(a.min(b)), (a, b) => a.or(b),
        };
        if date.is_some() {
            connection.execute("UPDATE tasks SET result_date = ?2, result_ends_at = ?3 WHERE id = ?1",
                params![id, date, original_due])?;
        }
    }
    Ok(())
}

// Version-25 fingerprints predate the appended context columns. Preserve all their old comparisons.
pub(super) fn facts_match(current: &str, expected: &str) -> bool {
    if current == expected { return true; }
    let Ok(mut current) = serde_json::from_str::<Vec<Vec<Vec<String>>>>(current) else { return false; };
    let Ok(expected) = serde_json::from_str::<Vec<Vec<Vec<String>>>>(expected) else { return false; };
    if current.len() != 6 || expected.len() != 6 { return false; }
    for index in [0, 1] {
        if current[index].len() != expected[index].len() { return false; }
        for (row, old) in current[index].iter_mut().zip(&expected[index]) {
            if index == 0 && row.len() == old.len() + 3 { row.truncate(old.len()); }
            else if index == 1 && row.len() == old.len() + 2 { row.drain(row.len() - 4..row.len() - 2); }
            else { return false; }
        }
    }
    current == expected
}

// The task inspector and the completion command must choose the same execution, not the latest backfill.
pub(super) fn completion_candidate(connection: &Connection, task_id: &str) -> AppResult<Option<String>> {
    let (status, result_date, saved): (String, Option<String>, Option<String>) = connection.query_row(
        "SELECT status, result_date, result_block_id FROM tasks WHERE id = ?1", [task_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?;
    let today = shanghai_today();
    if result_date.is_some() {
        let fresh = if status != "done" {
            connection.query_row("SELECT pb.id FROM plan_blocks pb JOIN daily_plans dp ON dp.id = pb.daily_plan_id
                WHERE pb.task_id = ?1 AND dp.plan_date = ?2 AND pb.id <> COALESCE(?3, '')
                AND (dp.plan_date > ?4 OR pb.result_date IS NULL) ORDER BY pb.starts_at DESC, pb.id LIMIT 1",
                params![task_id, today, saved, result_date], |row| row.get::<_, String>(0)).optional()?
        } else { None };
        Ok(fresh.or(saved))
    } else {
        Ok(connection.query_row("SELECT pb.id FROM plan_blocks pb JOIN daily_plans dp ON dp.id = pb.daily_plan_id
            WHERE pb.task_id = ?1 ORDER BY (dp.plan_date > ?2),
                CASE WHEN dp.plan_date <= ?2 THEN dp.plan_date END DESC, dp.plan_date, pb.starts_at, pb.id LIMIT 1",
            params![task_id, today], |row| row.get(0)).optional()?)
    }
}

pub(super) fn candidate_context(connection: &Connection, task_id: &str) -> AppResult<(Option<String>, Option<String>)> {
    let (status, date, end, saved, due): (String, Option<String>, Option<String>, Option<String>, Option<String>) = connection.query_row(
        "SELECT status, result_date, result_ends_at, result_block_id, due_at FROM tasks WHERE id = ?1", [task_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)))?;
    let candidate = completion_candidate(connection, task_id)?;
    if status == "done" || (date.is_some() && candidate == saved) { return Ok((date, end)); }
    if let Some(block) = candidate {
        let (_, date, end) = block_context(connection, &block)?;
        return Ok((Some(date), Some(end)));
    }
    Ok((Some(shanghai_today()), due))
}
