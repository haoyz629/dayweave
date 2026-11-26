use super::*;

#[derive(Debug, Clone, Serialize)]
pub struct TaskExecutionFactDto {
    pub plan_block_id: String,
    pub plan_date: String,
    pub ends_at: String,
    pub outcome: String,
    pub note: Option<String>,
}

pub(super) fn enrich_metadata(connection: &Connection, mut metadata: TaskMetadataDto) -> AppResult<TaskMetadataDto> {
    metadata.latest_execution = connection.query_row("SELECT pb.id, COALESCE(pb.result_date, dp.plan_date),
        COALESCE(review.outcome, pb.execution_status), COALESCE(review.notes, pb.execution_note), COALESCE(pb.result_ends_at, pb.ends_at)
        FROM plan_blocks pb JOIN daily_plans dp ON dp.id = pb.daily_plan_id
        LEFT JOIN review_entries review ON review.plan_block_id = pb.id
        WHERE pb.task_id = ?1 AND (pb.execution_captured_at IS NOT NULL OR review.id IS NOT NULL)
        ORDER BY julianday(COALESCE(review.updated_at, pb.execution_captured_at)) DESC, dp.plan_date DESC, pb.id LIMIT 1",
        [&metadata.task_id], |row| Ok(TaskExecutionFactDto { plan_block_id: row.get(0)?, plan_date: row.get(1)?,
            outcome: row.get(2)?, note: row.get(3)?, ends_at: row.get(4)? })).optional()?;
    if metadata.latest_execution.is_none() {
        let fallback: Option<(String, Option<String>, Option<String>, Option<String>)> = connection.query_row(
            "SELECT status, deleted_from_status, result_date, COALESCE(result_ends_at, due_at)
             FROM tasks WHERE id = ?1",
            [&metadata.task_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        ).optional()?;
        if let Some((status, deleted_from_status, Some(plan_date), end)) = fallback {
            if status == "done" || (status == "deleted" && deleted_from_status.as_deref() == Some("done")) {
                let mut note = None;
                for event in metadata.history.iter().rev() {
                    if matches!(event.kind.as_str(), "reopened" | "cleared" | "cleared_incomplete") {
                        break;
                    }
                    if matches!(event.kind.as_str(), "execution" | "note" | "status") {
                        if let Some(text) = event.note.clone().or_else(|| event.review_note.clone()) {
                            note = Some(text);
                            break;
                        }
                    }
                }
                metadata.latest_execution = Some(TaskExecutionFactDto {
                    plan_block_id: String::new(),
                    ends_at: end.unwrap_or_else(|| format!("{plan_date}T23:59:59+08:00")),
                    plan_date,
                    outcome: "completed".into(),
                    note,
                });
            }
        }
    }
    Ok(metadata)
}


// Shared insertion primitive; callers own the transaction and never nest one.
pub(super) fn insert_manual_draft(transaction: &Transaction<'_>, input: &TaskDraftInput, id: &str) -> AppResult<()> {
    validate_task_draft_input(input, false)?;
    database_tags::validate_selection(&input.tags, &[])?;
    database_tags::register_tags(transaction, &input.tags)?;
    let tags_json = serde_json::to_string(&normalize_tags(&input.tags)?)?;
    let recurrence_json = input.recurrence.as_ref().map(serde_json::to_string).transpose()?;
    let recurring_settings_json = input.recurring_settings.as_ref().map(serde_json::to_string).transpose()?;
    transaction.execute("INSERT INTO task_drafts (
        id, draft_kind, source_type, title, notes, priority, earliest_start_date, earliest_start_time, due_date, due_time,
        total_workload_minutes, remaining_workload_minutes, splittable, field_states_json, validation_status, version,
        confirmation_token, status, created_at, updated_at, tags_json, recurrence_json, item_type, recurring_settings_json)
        VALUES (?1, 'create', 'manual', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 1, ?11, ?12, 1, ?13, 'active', ?14, ?14, ?15, ?16, ?17, ?18)",
        params![id, input.title, input.notes, input.priority.map(Priority::as_str), input.earliest_start_date,
            input.earliest_start_time, input.due_date, input.due_time, input.total_workload_minutes, input.remaining_workload_minutes,
            input.field_states_json, draft_validation_status(input), Uuid::new_v4().to_string(), now(), tags_json, recurrence_json,
            input.item_type, recurring_settings_json])?;
    Ok(())
}
