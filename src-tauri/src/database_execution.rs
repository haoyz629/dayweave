use super::*;

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaskExecutionResolutionInput {
    pub plan_block_id: String,
    pub expected_task_updated_at: String,
    pub outcome: ReviewOutcome,
    pub note: Option<String>,
    pub next_action: Option<String>,
    pub starts_at: Option<String>,
    pub ends_at: Option<String>,
    pub remaining_workload_minutes: Option<i64>,
}

impl Database {
    pub fn resolve_task_execution(&mut self, capture_date: &str, mut input: TaskExecutionResolutionInput) -> AppResult<TaskDto> {
        input.note = normalize_review_text(input.note, 500, "执行备注")?;
        let completed = input.outcome == ReviewOutcome::Completed;
        let historical = parse_plan_date(capture_date)? < parse_plan_date(&shanghai_today())?;
        let record_only = historical || (input.outcome == ReviewOutcome::NotStarted && input.next_action.is_none());
        if completed || record_only {
            if input.next_action.is_some() || input.starts_at.is_some() || input.ends_at.is_some() || input.remaining_workload_minutes.is_some() {
                return Err(AppError::Schema("直接完成或仅记录结果不能附带下一步安排或剩余估算".into()));
            }
        } else {
            match input.next_action.as_deref() {
                Some("schedule") => {
                    if input.starts_at.is_none() || input.ends_at.is_none() {
                        return Err(AppError::Schema("继续安排需要开始和结束时间".into()));
                    }
                }
                Some("wait" | "stop") => {
                    if input.starts_at.is_some() || input.ends_at.is_some() {
                        return Err(AppError::Schema("等待或停止不能附带安排时间".into()));
                    }
                }
                _ => return Err(AppError::Schema("未完成任务必须选择 schedule、wait 或 stop".into())),
            }
            if input.next_action.as_deref() == Some("stop") && input.remaining_workload_minutes.is_some() {
                return Err(AppError::Schema("停止任务不能附带剩余估算".into()));
            }
            crate::domain::validate_workload(input.remaining_workload_minutes, "剩余工作量", false)?;
            if input.remaining_workload_minutes.is_some_and(|minutes| minutes < MIN_TASK_BLOCK_MINUTES) {
                return Err(AppError::Schema("剩余工作量至少需要 15 分钟".into()));
            }
        }

        let transaction = self.connection.transaction()?;
        let (task_id, plan_date, original_start, original_end, final_record): (String, String, String, String, bool) = transaction.query_row(
            "SELECT pb.task_id, dp.plan_date, pb.starts_at, pb.ends_at,
                EXISTS(SELECT 1 FROM review_entries WHERE plan_block_id = pb.id)
             FROM plan_blocks pb JOIN daily_plans dp ON dp.id = pb.daily_plan_id WHERE pb.id = ?1",
            [&input.plan_block_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        ).optional()?.ok_or_else(|| AppError::NotFound(format!("执行块 {}", input.plan_block_id)))?;
        if plan_date != capture_date {
            return Err(AppError::Domain("执行日期必须与执行块所属日期一致".into()));
        }
        let task = load_task_dto_in_transaction(&transaction, &task_id)?;
        let in_window = database_results::allow_capture(&transaction, capture_date, &input.plan_block_id)?;
        if task.deleted_at.is_some() || task.status == "deleted" {
            return Err(AppError::Domain("回收站任务不能记录结果".into()));
        }
        if plan_date != shanghai_today() && input.next_action.is_some() {
            return Err(AppError::Domain("跨日宽限不能修改下一步安排或工作量".into()));
        }
        if !in_window && input.next_action.is_some() {
            return Err(AppError::Domain("历史记录不能改变当前任务或下一步安排".into()));
        }
        if task.updated_at != input.expected_task_updated_at {
            return Err(AppError::Domain("任务已经变化，请重新加载后再记录".into()));
        }
        if final_record && input.next_action.is_some() {
            return Err(AppError::Domain("该执行块已有最终结果，不能重复安排".into()));
        }
        if !in_window {
            database_results::freeze_block(&transaction, &input.plan_block_id)?;
            transaction.execute("UPDATE plan_blocks SET execution_status = ?2, execution_note = ?3,
                execution_captured_at = ?4, review_required = CASE WHEN ?5 THEN review_required ELSE 1 END, updated_at = ?4 WHERE id = ?1",
                params![input.plan_block_id, input.outcome.as_str(), input.note, now(), final_record])?;
            transaction.execute("UPDATE review_entries SET outcome = ?2, notes = ?3 WHERE plan_block_id = ?1",
                params![input.plan_block_id, input.outcome.as_str(), input.note])?;
            clear_review_draft(&transaction, capture_date, "task", &input.plan_block_id)?;
        } else if completed {
            complete_result_in_transaction(&transaction, &task_id, Some(&input.plan_block_id), input.note.as_deref(), true)?;
        } else if record_only {
            if task.status == "done" { reopen_in_transaction(&transaction, &task_id, &plan_date)?; }
            database_results::freeze_block(&transaction, &input.plan_block_id)?;
            let timestamp = now();
            transaction.execute("UPDATE plan_blocks SET execution_status = 'not_started', execution_note = ?2,
                execution_captured_at = ?3, review_required = 0, updated_at = ?3 WHERE id = ?1",
                params![input.plan_block_id, input.note, timestamp])?;
            transaction.execute("UPDATE review_entries SET outcome = 'not_started', notes = ?2 WHERE plan_block_id = ?1",
                params![input.plan_block_id, input.note])?;
            transaction.execute("UPDATE tasks SET updated_at = ?2 WHERE id = ?1", params![task_id, timestamp])?;
            clear_review_draft(&transaction, capture_date, "task", &input.plan_block_id)?;
        } else {
            if task.status == "done" { reopen_in_transaction(&transaction, &task_id, &plan_date)?; }
            database_results::freeze_block(&transaction, &input.plan_block_id)?;
            // Validate the entire follow-up before persisting any execution facts.
            let schedule = if input.next_action.as_deref() == Some("schedule") {
                let start_text = input.starts_at.as_deref().unwrap();
                let end_text = input.ends_at.as_deref().unwrap();
                let start = crate::domain::parse_shanghai_timestamp(start_text)?;
                let end = crate::domain::parse_shanghai_timestamp(end_text)?;
                if start.to_rfc3339() != start_text || end.to_rfc3339() != end_text
                    || start.date_naive() != end.date_naive() || start.date_naive().to_string() < shanghai_today()
                {
                    return Err(AppError::Domain("安排时间必须为同一天的标准 +08:00 时间，且不能位于历史日期".into()));
                }
                crate::domain::validate_complete_task_timestamps(&input.starts_at, &input.ends_at)?;
                let duration = end - start;
                let fallback = (crate::domain::parse_shanghai_timestamp(&original_end)?
                    - crate::domain::parse_shanghai_timestamp(&original_start)?).num_minutes();
                let remaining = input.remaining_workload_minutes.or(task.remaining_workload_minutes).unwrap_or(fallback);
                if duration < Duration::minutes(MIN_TASK_BLOCK_MINUTES) || duration > Duration::minutes(remaining.clamp(0, 525_600)) {
                    return Err(AppError::Domain("新安排至少 15 分钟且不能超过剩余工作量".into()));
                }
                Some(start.date_naive().to_string())
            } else { None };
            let timestamp = now();
            transaction.execute(
                "INSERT INTO review_entries (id, review_date, plan_block_id, task_id, outcome, actual_minutes,
                    notes, remaining_workload_minutes, followup_action, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, ?8, ?9, ?9)",
                params![Uuid::new_v4().to_string(), capture_date, input.plan_block_id, task_id,
                    input.outcome.as_str(), input.note, input.remaining_workload_minutes, input.next_action, timestamp],
            )?;
            transaction.execute(
                "UPDATE plan_blocks SET execution_status = ?2, execution_note = ?3, execution_captured_at = ?4,
                    actual_minutes = NULL, review_required = 0, updated_at = ?4 WHERE id = ?1",
                params![input.plan_block_id, input.outcome.as_str(), input.note, timestamp],
            )?;
            // The current block is now a protected fact, not a replaceable schedule.
            for block in load_task_schedule_blocks(&transaction, &task_id)?.iter().filter(|block| block.plan_date >= shanghai_today()) {
                transaction.execute("DELETE FROM plan_blocks WHERE id = ?1", [&block.block.id])?;
            }
            if let Some(remaining) = input.remaining_workload_minutes {
                if task.remaining_workload_minutes != Some(remaining) {
                    transaction.execute(
                        "INSERT INTO task_estimates (id, task_id, estimate_kind, old_minutes, new_minutes, source, reason, created_at)
                         VALUES (?1, ?2, 'remaining', ?3, ?4, 'manual', '执行后明确重新估算', ?5)",
                        params![Uuid::new_v4().to_string(), task_id, task.remaining_workload_minutes, remaining, timestamp],
                    )?;
                }
            }
            transaction.execute("UPDATE tasks SET status = 'open', remaining_workload_minutes = ?2, updated_at = ?3 WHERE id = ?1",
                params![task_id, input.remaining_workload_minutes.or(task.remaining_workload_minutes), timestamp])?;
            if let Some(date) = schedule {
                let plan_id: String = transaction.query_row(
                    "SELECT id FROM daily_plans WHERE plan_date = ?1 AND status = 'confirmed'", [&date], |row| row.get(0),
                ).optional()?.unwrap_or_else(|| Uuid::new_v4().to_string());
                transaction.execute("INSERT OR IGNORE INTO daily_plans (id, plan_date, status, source, created_at, confirmed_at)
                    VALUES (?1, ?2, 'confirmed', 'manual', ?3, ?3)", params![plan_id, date, timestamp])?;
                let start = input.starts_at.as_deref().unwrap();
                let end = input.ends_at.as_deref().unwrap();
                transaction.execute("INSERT INTO plan_blocks (id, daily_plan_id, task_id, starts_at, ends_at, source, review_required, created_at, updated_at)
                    VALUES (?1, ?2, ?3, ?4, ?5, 'manual', 0, ?6, ?6)",
                    params![Uuid::new_v4().to_string(), plan_id, task_id, start, end, timestamp])?;
                transaction.execute("UPDATE tasks SET status = 'scheduled', earliest_start_at = ?2, due_at = ?3,
                    earliest_start_date = ?4, due_date = ?4, earliest_start_time = ?5, due_time = ?6 WHERE id = ?1",
                    params![task_id, start, end, date, &start[11..16], &end[11..16]])?;
            } else if input.next_action.as_deref() == Some("stop") {
                soft_delete_task(&transaction, &task_id, "manual")?;
            }
            record_task_change(&transaction, &task_id, "execution_resolved", Some(input.outcome.as_str()),
                input.next_action.as_deref(), "manual", input.note.as_deref())?;
            clear_review_draft(&transaction, capture_date, "task", &input.plan_block_id)?;
        }
        transaction.commit()?;
        self.get_task(&task_id)
    }
}

// Shared by explicit completion and execution resolution, keeping completion undo atomic.
pub(super) fn complete_in_transaction(transaction: &Transaction<'_>, task_id: &str, plan_block_id: Option<&str>, note: Option<&str>) -> AppResult<()> {
    complete_result_in_transaction(transaction, task_id, plan_block_id, note, false)
}

fn complete_result_in_transaction(transaction: &Transaction<'_>, task_id: &str, plan_block_id: Option<&str>, note: Option<&str>, replace_note: bool) -> AppResult<()> {
    let before_task = load_task_dto_in_transaction(transaction, task_id)?;
    if before_task.deleted_at.is_some() || before_task.status == "deleted" {
        return Err(AppError::Domain("任务已删除".into()));
    }
    let block_id: Option<String> = if let Some(id) = plan_block_id {
        let (owner, _, _) = database_results::block_context(transaction, id)?;
        if owner != task_id { return Err(AppError::Domain("执行块不属于该任务".into())); }
        Some(id.into())
    } else { database_results::completion_candidate(transaction, task_id)? };
    database_results::completion_context(transaction, &before_task, block_id.as_deref())?;
    if before_task.status == "done" {
        if let Some(id) = block_id {
            database_results::require_block_window(transaction, &id)?;
            transaction.execute("UPDATE plan_blocks SET execution_status = 'completed', execution_note = CASE WHEN ?4 THEN ?2 ELSE COALESCE(?2, execution_note) END,
                execution_captured_at = ?3, updated_at = ?3 WHERE id = ?1", params![id, note, now(), replace_note])?;
            transaction.execute("UPDATE review_entries SET outcome = 'completed', notes = CASE WHEN ?3 THEN ?2 ELSE COALESCE(?2, notes) END WHERE plan_block_id = ?1", params![id, note, replace_note])?;
            let after = serde_json::to_string(&execution_snapshot(transaction, &id)?)?;
            transaction.execute("UPDATE task_completion_snapshots SET block_after_json = ?2 WHERE task_id = ?1", params![task_id, after])?;
        }
        transaction.execute("UPDATE tasks SET updated_at = ?2 WHERE id = ?1", params![task_id, now()])?;
        if let Some(note) = note { record_task_change(transaction, task_id, "completion_note_changed", None, Some(note), "manual", Some(note))?; }
        return Ok(());
    }
    let mut before_block = None;
    let mut before_review = None;
    if let Some(id) = &block_id {
        before_block = Some(execution_snapshot(transaction, id)?);
        before_review = transaction.query_row("SELECT id, outcome, notes FROM review_entries WHERE plan_block_id = ?1", [id],
            |row| Ok(ReviewResultSnapshot { id: row.get(0)?, outcome: row.get(1)?, notes: row.get(2)? })).optional()?;
        let result_note = if replace_note { note } else { note.or_else(|| before_review.as_ref().and_then(|review| review.notes.as_deref())) };
        transaction.execute("UPDATE plan_blocks SET execution_status = 'completed', execution_note = CASE WHEN ?4 THEN ?3 ELSE COALESCE(?3, execution_note) END,
            execution_captured_at = ?2, review_required = 0, updated_at = ?2 WHERE id = ?1", params![id, now(), result_note, replace_note])?;
        if before_review.is_some() {
            transaction.execute("UPDATE review_entries SET outcome = 'completed', notes = CASE WHEN ?3 THEN ?2 ELSE COALESCE(?2, notes) END WHERE plan_block_id = ?1", params![id, note, replace_note])?;
        }
        let (_, date, _) = database_results::block_context(transaction, id)?;
        clear_review_draft(transaction, &date, "task", id)?;
    }
    if before_task.remaining_workload_minutes != Some(0) {
        transaction.execute("INSERT INTO task_estimates (id, task_id, estimate_kind, old_minutes, new_minutes, source, reason, created_at)
            VALUES (?1, ?2, 'remaining', ?3, 0, 'manual', '用户明确完成整个任务', ?4)",
            params![Uuid::new_v4().to_string(), task_id, before_task.remaining_workload_minutes, now()])?;
    }
    transaction.execute("UPDATE tasks SET status = 'done', remaining_workload_minutes = 0, updated_at = ?2 WHERE id = ?1", params![task_id, now()])?;
    record_task_change(transaction, task_id, "status_changed", Some(&before_task.status), Some("done"), "manual", note.or(Some("明确完成整个任务")))?;
    let payload = FactUndo { task: Some(before_task), block: before_block, occurrence: None, review: before_review,
        after_facts: fact_fingerprint(transaction, "task_completion", task_id)? };
    let before_json = serde_json::to_string(&payload)?;
    let after_json = block_id.as_deref().map(|id| execution_snapshot(transaction, id)
        .and_then(|snapshot| serde_json::to_string(&snapshot).map_err(AppError::from))).transpose()?;
    transaction.execute("INSERT INTO task_completion_snapshots (task_id, before_json, block_after_json)
        VALUES (?1, ?2, ?3) ON CONFLICT(task_id) DO UPDATE SET before_json = excluded.before_json,
        block_after_json = excluded.block_after_json", params![task_id, before_json, after_json])?;
    record_undo_entry(transaction, "task_completed", "task_completion", task_id, &before_json, None)?;
    Ok(())
}

pub(super) fn has_followup(connection: &Connection, task_id: &str) -> AppResult<bool> {
    Ok(connection.query_row("SELECT EXISTS(SELECT 1 FROM review_entries WHERE task_id = ?1
        AND followup_action IN ('schedule','wait','stop'))", [task_id], |row| row.get(0))?)
}

pub(super) fn reopen_in_transaction(transaction: &Transaction<'_>, task_id: &str, _plan_date: &str) -> AppResult<()> {
    let current = load_task_dto_in_transaction(transaction, task_id)?;
    if current.status != "done" || current.deleted_at.is_some() {
        return Err(AppError::Domain("只有已完成任务可以取消完成".into()));
    }
    database_results::require_task_window(transaction, task_id)?;
    let snapshot: Option<(String, Option<String>)> = transaction.query_row(
        "SELECT before_json, block_after_json FROM task_completion_snapshots WHERE task_id = ?1", [task_id],
        |row| Ok((row.get(0)?, row.get(1)?))).optional()?;
    // Old completions already have a durable undo payload even after the toast expires.
    let snapshot = match snapshot {
        Some(snapshot) => Some(snapshot),
        None => transaction.query_row("SELECT before_json FROM undo_entries
            WHERE target_type = 'task_completion' AND target_id = ?1 ORDER BY created_at DESC, rowid DESC LIMIT 1",
            [task_id], |row| row.get::<_, String>(0)).optional()?.map(|json| (json, None)),
    };
    let mut remaining = current.remaining_workload_minutes.filter(|minutes| *minutes > 0)
        .or(current.total_workload_minutes).or(current.estimated_minutes);
    if let Some((json, after_json)) = snapshot {
        let payload: FactUndo = serde_json::from_str(&json)?;
        if let Some(before) = &payload.task { remaining = before.remaining_workload_minutes; }
        let old_facts_unchanged = after_json.is_none()
            && database_results::facts_match(&fact_fingerprint(transaction, "task_completion", task_id)?, &payload.after_facts);
        if let Some(block) = payload.block {
            let current_block = match execution_snapshot(transaction, &block.id) {
                Ok(snapshot) => Some(snapshot),
                Err(AppError::Database(rusqlite::Error::QueryReturnedNoRows)) => None,
                Err(error) => return Err(error),
            };
            let has_review: bool = transaction.query_row("SELECT EXISTS(SELECT 1 FROM review_entries WHERE plan_block_id = ?1)",
                [&block.id], |row| row.get(0))?;
            let matches_after = current_block.as_ref().map(|value| serde_json::to_string(value)).transpose()?
                .zip(after_json).is_some_and(|(current, after)| current == after);
            let restore_review = if let Some(review) = &payload.review {
                let saved: Option<(String, Option<String>)> = transaction.query_row("SELECT outcome, notes FROM review_entries WHERE id = ?1",
                    [&review.id], |row| Ok((row.get(0)?, row.get(1)?))).optional()?;
                matches_after && saved.is_some_and(|(outcome, note)| outcome == "completed"
                    && note == current_block.as_ref().and_then(|block| block.execution_note.clone()))
            } else { false };
            if restore_review {
                if let Some(review) = &payload.review {
                    transaction.execute("UPDATE review_entries SET outcome = ?2, notes = ?3 WHERE id = ?1", params![review.id, review.outcome, review.notes])?;
                }
            }
            if (!has_review || restore_review) && current_block.is_some() && (matches_after || old_facts_unchanged) {
                transaction.execute("UPDATE plan_blocks SET execution_status = ?2, actual_minutes = ?3, review_required = ?4,
                    execution_note = ?5, execution_captured_at = ?6, updated_at = ?7 WHERE id = ?1",
                    params![block.id, block.execution_status, block.actual_minutes, block.review_required,
                        block.execution_note, block.execution_captured_at, now()])?;
            }
        }
    }
    if remaining == Some(0) {
        remaining = current.total_workload_minutes.or(current.estimated_minutes).filter(|minutes| *minutes > 0);
    }
    if remaining != current.remaining_workload_minutes {
        transaction.execute("INSERT INTO task_estimates (id, task_id, estimate_kind, old_minutes, new_minutes, source, reason, created_at)
            VALUES (?1, ?2, 'remaining', ?3, ?4, 'manual', '取消整项完成', ?5)",
            params![Uuid::new_v4().to_string(), task_id, current.remaining_workload_minutes, remaining, now()])?;
    }
    transaction.execute("UPDATE tasks SET remaining_workload_minutes = ?2 WHERE id = ?1", params![task_id, remaining])?;
    let scheduled: bool = transaction.query_row("SELECT EXISTS(SELECT 1 FROM plan_blocks pb
        JOIN daily_plans dp ON dp.id = pb.daily_plan_id WHERE pb.task_id = ?1 AND dp.plan_date = ?2 AND dp.status = 'confirmed')",
        params![task_id, current.result_date.as_deref().unwrap_or(&shanghai_today())], |row| row.get(0))?;
    set_task_status(transaction, task_id, if scheduled { TaskStatus::Scheduled } else { TaskStatus::Open }, "manual")?;
    transaction.execute("UPDATE undo_entries SET status = 'conflicted' WHERE target_type = 'task_completion'
        AND target_id = ?1 AND status = 'available'", [task_id])?;
    Ok(())
}
