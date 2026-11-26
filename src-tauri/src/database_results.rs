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
    if !window(date.as_deref(), end.as_deref()) && !historical_completion_recorded_at(connection, id)?
        .as_deref().is_some_and(recorded_window) { return Err(expired()); }
    Ok(())
}

// Historical completion is a durable fact, even inside the old cross-midnight grace window.
pub(super) fn require_task_reopenable(connection: &Connection, id: &str) -> AppResult<()> {
    let task = load_task_dto_in_transaction(connection, id)?;
    if task.status == "done" && task.result_date.as_deref().or(task.due_date.as_deref())
        .is_some_and(|date| date < shanghai_today().as_str()) {
        return Err(AppError::Domain("历史完成记录不支持取消".into()));
    }
    require_task_window(connection, id)
}

pub(super) fn require_block_outcome_change(connection: &Connection, id: &str, outcome: &str) -> AppResult<()> {
    let (_, date, _) = block_context(connection, id)?;
    if date < shanghai_today() && outcome != "completed" {
        let completed: bool = connection.query_row("SELECT COALESCE(
            (SELECT outcome FROM review_entries WHERE plan_block_id = pb.id), pb.execution_status) = 'completed'
            FROM plan_blocks pb WHERE pb.id = ?1", [id], |row| row.get(0))?;
        if completed { return Err(AppError::Domain("历史完成记录不支持取消".into())); }
    }
    Ok(())
}

pub(super) fn freeze_block(connection: &Connection, id: &str) -> AppResult<()> {
    connection.execute("UPDATE plan_blocks SET result_ends_at = COALESCE(result_ends_at, ends_at),
        result_date = COALESCE(result_date, (SELECT plan_date FROM daily_plans WHERE id = daily_plan_id)) WHERE id = ?1", [id])?;
    Ok(())
}

// A backfill is a new fact about a past single day, not permission to rewrite an old whole-task result.
pub(super) fn historical_single_day(task: &TaskDto) -> Option<String> {
    let (date, minutes) = single_day_range(task.earliest_start_at.as_deref(), task.due_at.as_deref()).ok().flatten()?;
    (date < shanghai_today() && minutes >= MIN_TASK_BLOCK_MINUTES
        && task.earliest_start_date.as_deref() == Some(date.as_str())
        && task.due_date.as_deref() == Some(date.as_str())).then_some(date)
}

pub(super) fn has_schedule_dates(task: &TaskDto) -> bool {
    task.earliest_start_date.is_some() || task.due_date.is_some()
}

pub(super) fn historical_untimed_single_day(task: &TaskDto) -> Option<String> {
    if task.earliest_start_at.is_some() || task.due_at.is_some()
        || task.earliest_start_time.is_some() || task.due_time.is_some()
    {
        return None;
    }
    let date = task.due_date.as_deref()?;
    (task.earliest_start_date.as_deref() == Some(date) && date < shanghai_today().as_str())
        .then(|| date.to_string())
}

pub(super) fn historical_completion_recorded_at(connection: &Connection, task_id: &str) -> AppResult<Option<String>> {
    let json: Option<String> = connection.query_row("SELECT before_json FROM task_completion_snapshots WHERE task_id = ?1",
        [task_id], |row| row.get(0)).optional()?;
    Ok(json.and_then(|json| serde_json::from_str::<serde_json::Value>(&json).ok())
        .and_then(|value| value["historical_completion_recorded_at"].as_str().map(str::to_owned)))
}

fn recorded_window(recorded_at: &str) -> bool {
    DateTime::parse_from_rfc3339(recorded_at).ok().is_some_and(|recorded| {
        let elapsed = clock_now().signed_duration_since(recorded);
        elapsed >= Duration::zero() && elapsed <= Duration::hours(6)
    })
}

pub(super) fn can_backfill_completion(connection: &Connection, task: &TaskDto) -> AppResult<bool> {
    let Some(date) = historical_single_day(task).or_else(|| historical_untimed_single_day(task)) else { return Ok(false); };
    if !matches!(task.status.as_str(), "open" | "scheduled") || task.deleted_at.is_some() { return Ok(false); }
    if task.result_date.is_some() && historical_completion_recorded_at(connection, &task.id)?.is_none() {
        // Reopening keeps the original context, but its unfinished block can still be completed later.
        let unfinished_original: bool = connection.query_row("SELECT EXISTS(SELECT 1 FROM tasks task
            JOIN plan_blocks pb ON pb.id = task.result_block_id AND pb.task_id = task.id
            JOIN daily_plans dp ON dp.id = pb.daily_plan_id LEFT JOIN review_entries review ON review.plan_block_id = pb.id
            WHERE task.id = ?1 AND task.result_date = ?2 AND dp.plan_date = ?2 AND dp.status = 'confirmed'
                AND COALESCE(pb.result_date, dp.plan_date) = ?2 AND COALESCE(review.outcome, pb.execution_status) <> 'completed')",
            params![task.id, date], |row| row.get(0))?;
        if !unfinished_original { return Ok(false); }
    }
    let other_dates: bool = connection.query_row("SELECT EXISTS(SELECT 1 FROM plan_blocks pb
        JOIN daily_plans dp ON dp.id = pb.daily_plan_id WHERE pb.task_id = ?1 AND dp.status = 'confirmed' AND dp.plan_date <> ?2)",
        params![task.id, date], |row| row.get(0))?;
    Ok(!other_dates)
}

// An unfinished cross-day task is an active task today even without a reservation
// today. Its explicit completion must not edit a future or expired historical block.
fn active_cross_day(connection: &Connection, task_id: &str) -> AppResult<bool> {
    Ok(connection.query_row("SELECT status IN ('open', 'scheduled') AND deleted_at IS NULL
        AND earliest_start_date < due_date AND earliest_start_date <= ?2
        FROM tasks WHERE id = ?1", params![task_id, shanghai_today()],
        |row| Ok(row.get::<_, Option<bool>>(0)?.unwrap_or(false)))?)
}

// Context survives reopen, undo and trash restore. Only a genuinely different execution can replace it.
pub(super) fn completion_context(connection: &Connection, task: &TaskDto, block: Option<&str>) -> AppResult<()> {
    let saved_block: Option<String> = connection.query_row("SELECT result_block_id FROM tasks WHERE id = ?1", [&task.id], |row| row.get(0))?;
    if task.status == "done" && block != saved_block.as_deref() {
        return Err(AppError::Domain("不能借其他执行块修改已有整项完成结果".into()));
    }
    let active = active_cross_day(connection, &task.id)?;
    if active && block.is_none() {
        connection.execute("UPDATE tasks SET result_date = ?2, result_ends_at = ?3, result_block_id = NULL WHERE id = ?1",
            params![task.id, shanghai_today(), now()])?;
        return Ok(());
    }
    if task.status == "done" || (!active && task.result_date.is_some() && (block.is_none() || block == saved_block.as_deref())) {
        if historical_completion_recorded_at(connection, &task.id)?.is_none() {
            if let Some(block) = block { require_block_window(connection, block)?; }
        }
        return require_task_window(connection, &task.id);
    }
    let (date, end) = if let Some(block) = block {
        let (owner, date, end) = block_context(connection, block)?;
        if owner != task.id { return Err(AppError::Domain("执行块不属于该任务".into())); }
        require_block_window(connection, block)?;
        // Never use another old result to reset the task's original completion context.
        if task.result_date.is_some() && !active {
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

// Return whether today's workflow applies; historical lifecycle sync is handled after the block write.
pub(super) fn allow_capture(connection: &Connection, date: &str, id: &str) -> AppResult<bool> {
    let (_, actual_date, _) = block_context(connection, id)?;
    if actual_date != date { return Err(AppError::Domain("执行日期必须与执行块所属日期一致".into())); }
    let date = parse_plan_date(date)?;
    let today = parse_plan_date(&shanghai_today())?;
    if date > today { return Err(AppError::Domain("未来日期不能记录执行结果".into())); }
    Ok(date == today)
}

// Recycling permits completing an existing reservation, never changing the task lifecycle.
// Return true when this narrow path handled the write (including a no-op retry).
pub(super) fn save_recycled_completion(transaction: &Transaction<'_>, task: &TaskDto, date: &str,
    block_id: &str, outcome: &str, note: Option<&str>) -> AppResult<bool> {
    if task.deleted_at.is_none() && task.status != "deleted" { return Ok(false); }
    if outcome != "completed" {
        return Err(AppError::Domain("回收站任务只能记录已有安排的完成结果".into()));
    }
    let confirmed: bool = transaction.query_row("SELECT EXISTS(SELECT 1 FROM plan_blocks pb
        JOIN daily_plans dp ON dp.id = pb.daily_plan_id WHERE pb.id = ?1 AND pb.task_id = ?2
            AND dp.status = 'confirmed' AND dp.plan_date = ?3 AND COALESCE(pb.result_date, dp.plan_date) = ?3)",
        params![block_id, task.id, date], |row| row.get(0))?;
    if !confirmed { return Err(AppError::Domain("只能记录该任务原日期的已确认安排".into())); }
    allow_capture(transaction, date, block_id)?;
    let before = execution_snapshot(transaction, block_id)?;
    let review: Option<(String, Option<String>)> = transaction.query_row(
        "SELECT outcome, notes FROM review_entries WHERE plan_block_id = ?1", [block_id],
        |row| Ok((row.get(0)?, row.get(1)?))).optional()?;
    let normalized_note = normalize_review_text(note.map(str::to_owned), 500, "执行备注")?;
    let same_review = match &review {
        Some((outcome, saved_note)) => outcome == "completed"
            && normalize_review_text(saved_note.clone(), 500, "执行备注")?.as_deref() == normalized_note.as_deref(),
        None => true,
    };
    let previous_outcome = review.as_ref().map(|(outcome, _)| outcome.as_str()).unwrap_or(&before.execution_status);
    if date < shanghai_today().as_str() && previous_outcome == "completed" {
        return Err(AppError::Domain("历史完成记录不支持修改".into()));
    }
    if before.execution_status == "completed" && before.execution_captured_at.is_some()
        && normalized_note.as_deref() == before.execution_note.as_deref() && same_review { return Ok(true); }
    let audit_cursor = database_history::audit_cursor(transaction, &task.id)?;
    let before_capture = database_history::capture_snapshot(transaction, block_id)?;
    database_history::preserve_current(transaction, &task.id)?;
    freeze_block(transaction, block_id)?;
    let timestamp = now();
    transaction.execute("UPDATE plan_blocks SET execution_status = 'completed', execution_note = ?2,
        execution_captured_at = ?3, review_required = CASE WHEN ?4 THEN review_required ELSE 1 END,
        updated_at = ?3 WHERE id = ?1", params![block_id, normalized_note, timestamp, review.is_some()])?;
    transaction.execute("UPDATE review_entries SET outcome = 'completed', notes = ?2 WHERE plan_block_id = ?1",
        params![block_id, normalized_note])?;
    clear_review_draft(transaction, date, "task", block_id)?;
    database_history::record_capture_change(transaction, &task.id, date, &before_capture, audit_cursor, &timestamp)?;
    sync_recycled_completion(transaction, &task.id)?;
    Ok(true)
}

// A recycled multi-day task is "whole-task complete" once every confirmed block is
// complete. It stays in the recycle bin (status/deleted_at unchanged); completing all
// dates only upgrades the restore target so recovery lands on "done".
fn sync_recycled_completion(transaction: &Transaction<'_>, task_id: &str) -> AppResult<()> {
    let (count, incomplete): (i64, i64) = transaction.query_row(
        "SELECT COUNT(*), COALESCE(SUM(CASE WHEN COALESCE(review.outcome, pb.execution_status) = 'completed' THEN 0 ELSE 1 END), 0)
         FROM plan_blocks pb JOIN daily_plans dp ON dp.id = pb.daily_plan_id
         LEFT JOIN review_entries review ON review.plan_block_id = pb.id
         WHERE pb.task_id = ?1 AND dp.status = 'confirmed'",
        [task_id], |row| Ok((row.get(0)?, row.get(1)?)))?;
    let (start, due): (Option<String>, Option<String>) = transaction.query_row(
        "SELECT earliest_start_date, due_date FROM tasks WHERE id = ?1", [task_id],
        |row| Ok((row.get(0)?, row.get(1)?)))?;
    let unscheduled_date = match (start.as_deref(), due.as_deref()) {
        (Some(start), Some(due)) if start < due => transaction.query_row(
            "SELECT COUNT(DISTINCT dp.plan_date) < CAST(julianday(?3) - julianday(?2) AS INTEGER) + 1
             FROM plan_blocks pb JOIN daily_plans dp ON dp.id = pb.daily_plan_id
             WHERE pb.task_id = ?1 AND dp.status = 'confirmed' AND dp.plan_date >= ?2 AND dp.plan_date <= ?3",
            params![task_id, start, due], |row| row.get::<_, bool>(0))?,
        _ => false,
    };
    let completed = count > 0 && incomplete == 0 && !unscheduled_date;
    if completed {
        let current_target: String = transaction.query_row(
            "SELECT deleted_from_status FROM tasks WHERE id = ?1", [task_id],
            |row| row.get(0))?;
        if current_target != "done" {
            transaction.execute(
                "UPDATE tasks SET deleted_from_status = 'done', remaining_workload_minutes = 0,
                    updated_at = ?2 WHERE id = ?1 AND status = 'deleted'",
                params![task_id, now()])?;
            record_task_change(transaction, task_id, "status_changed",
                Some(&current_target), Some("done"), "manual", Some("汇总全部执行块结果"))?;
        }
    }
    Ok(())
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
    if active_cross_day(connection, task_id)? {
        return Ok(connection.query_row("SELECT pb.id FROM plan_blocks pb JOIN daily_plans dp ON dp.id = pb.daily_plan_id
            WHERE pb.task_id = ?1 AND dp.plan_date = ?2 AND dp.status = 'confirmed'
            ORDER BY pb.starts_at DESC, pb.id LIMIT 1", params![task_id, today], |row| row.get(0)).optional()?);
    }
    // A single-day task's current reservation is its completion target, not an
    // older execution fact or an unconfirmed planning copy of the same task.
    if status != "done" {
        let reservation = connection.query_row("SELECT pb.id FROM tasks task
            JOIN plan_blocks pb ON pb.task_id = task.id JOIN daily_plans dp ON dp.id = pb.daily_plan_id
            WHERE task.id = ?1 AND task.earliest_start_date = task.due_date AND dp.plan_date = task.due_date
                AND dp.status = 'confirmed' AND pb.starts_at = task.earliest_start_at AND pb.ends_at = task.due_at
            ORDER BY pb.id LIMIT 1", [task_id], |row| row.get::<_, String>(0)).optional()?;
        if reservation.is_some() { return Ok(reservation); }
    }
    if result_date.is_some() {
        let fresh = if status != "done" {
            connection.query_row("SELECT pb.id FROM plan_blocks pb JOIN daily_plans dp ON dp.id = pb.daily_plan_id
                WHERE pb.task_id = ?1 AND dp.status = 'confirmed' AND dp.plan_date = ?2 AND pb.id <> COALESCE(?3, '')
                AND (dp.plan_date > ?4 OR pb.result_date IS NULL) ORDER BY pb.starts_at DESC, pb.id LIMIT 1",
                params![task_id, today, saved, result_date], |row| row.get::<_, String>(0)).optional()?
        } else { None };
        Ok(fresh.or(saved))
    } else {
        Ok(connection.query_row("SELECT pb.id FROM plan_blocks pb JOIN daily_plans dp ON dp.id = pb.daily_plan_id
            WHERE pb.task_id = ?1 AND dp.status = 'confirmed' ORDER BY (dp.plan_date > ?2),
                CASE WHEN dp.plan_date <= ?2 THEN dp.plan_date END DESC, dp.plan_date, pb.starts_at, pb.id LIMIT 1",
            params![task_id, today], |row| row.get(0)).optional()?)
    }
}

pub(super) fn candidate_context(connection: &Connection, task_id: &str) -> AppResult<(Option<String>, Option<String>)> {
    let (status, date, end, saved, due): (String, Option<String>, Option<String>, Option<String>, Option<String>) = connection.query_row(
        "SELECT status, result_date, result_ends_at, result_block_id, due_at FROM tasks WHERE id = ?1", [task_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)))?;
    let candidate = completion_candidate(connection, task_id)?;
    let task = load_task_dto_in_transaction(connection, task_id)?;
    if can_backfill_completion(connection, &task)? {
        return Ok((historical_single_day(&task).or_else(|| historical_untimed_single_day(&task)), task.due_at));
    }
    if status == "done" || (!active_cross_day(connection, task_id)? && date.is_some() && candidate == saved) { return Ok((date, end)); }
    if let Some(block) = candidate {
        let (_, date, end) = block_context(connection, &block)?;
        return Ok((Some(date), Some(end)));
    }
    Ok((Some(shanghai_today()), if active_cross_day(connection, task_id)? { Some(now()) } else { due }))
}
