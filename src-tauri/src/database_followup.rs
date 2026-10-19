use super::*;

#[derive(Debug, Clone, Serialize)]
pub struct TaskOriginDto {
    pub source_task_id: Option<String>,
    pub source_title: String,
    pub source_status: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskFollowupDto {
    pub task_id: String,
    pub title: String,
    pub status: String,
    pub starts_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskExecutionFactDto {
    pub plan_block_id: String,
    pub plan_date: String,
    pub outcome: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FollowupPreparation {
    Draft { draft: TaskDraftDto },
    Existing { task_id: String },
}

pub(super) fn draft_origin(connection: &Connection, id: &str) -> AppResult<Option<TaskOriginDto>> {
    Ok(connection.query_row("SELECT origin.source_task_id, COALESCE(source.title, origin.source_title), source.status
        FROM task_draft_origins origin LEFT JOIN tasks source ON source.id = origin.source_task_id WHERE origin.draft_id = ?1",
        [id], origin_from_row).optional()?)
}

fn origin_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TaskOriginDto> {
    Ok(TaskOriginDto { source_task_id: row.get(0)?, source_title: row.get(1)?, source_status: row.get(2)? })
}

pub(super) fn enrich_metadata(connection: &Connection, mut metadata: TaskMetadataDto) -> AppResult<TaskMetadataDto> {
    metadata.origin = connection.query_row("SELECT origin.source_task_id, COALESCE(source.title, origin.source_title), source.status
        FROM task_origins origin LEFT JOIN tasks source ON source.id = origin.source_task_id WHERE origin.task_id = ?1",
        [&metadata.task_id], origin_from_row).optional()?;
    let mut statement = connection.prepare("SELECT child.id, child.title, child.status, child.earliest_start_at
        FROM task_origins origin JOIN tasks child ON child.id = origin.task_id
        WHERE origin.source_task_id = ?1 ORDER BY origin.created_at, child.created_at, child.id")?;
    metadata.followups = statement.query_map([&metadata.task_id], |row| Ok(TaskFollowupDto {
        task_id: row.get(0)?, title: row.get(1)?, status: row.get(2)?, starts_at: row.get(3)?,
    }))?.collect::<Result<Vec<_>, _>>()?;
    metadata.latest_execution = connection.query_row("SELECT pb.id, dp.plan_date,
        COALESCE(review.outcome, pb.execution_status), COALESCE(review.notes, pb.execution_note)
        FROM plan_blocks pb JOIN daily_plans dp ON dp.id = pb.daily_plan_id
        LEFT JOIN review_entries review ON review.plan_block_id = pb.id
        WHERE pb.task_id = ?1 AND (pb.execution_captured_at IS NOT NULL OR review.id IS NOT NULL)
        ORDER BY julianday(COALESCE(review.updated_at, pb.execution_captured_at)) DESC, dp.plan_date DESC, pb.id LIMIT 1",
        [&metadata.task_id], |row| Ok(TaskExecutionFactDto { plan_block_id: row.get(0)?, plan_date: row.get(1)?,
            outcome: row.get(2)?, note: row.get(3)? })).optional()?;
    Ok(metadata)
}

pub(super) fn existing_child(connection: &Connection, source_id: &str) -> AppResult<Option<String>> {
    Ok(connection.query_row("SELECT child.id FROM task_origins origin JOIN tasks child ON child.id = origin.task_id
        WHERE origin.source_task_id = ?1 AND child.status <> 'deleted' AND child.deleted_at IS NULL
        ORDER BY origin.created_at, child.created_at, child.id LIMIT 1", [source_id], |row| row.get(0)).optional()?)
}
pub(super) fn ensure_status_editable(connection: &Connection, task_id: &str) -> AppResult<()> {
    if existing_child(connection, task_id)?.is_some() {
        return Err(AppError::Domain("该任务已有后续任务，删除后续任务后才能修改源任务状态".into()));
    }
    Ok(())
}


pub(super) fn validate_linked_draft(draft: &TaskDraftDto, input: Option<&TaskDraftInput>) -> AppResult<()> {
    if draft.origin.is_some() && (draft.draft_kind != "create" || draft.target_task_id.is_some()
        || draft.item_type != "task" || draft.recurrence.is_some() || draft.recurring_settings.is_some()
        || input.is_some_and(|input| input.item_type != "task" || input.recurrence.is_some() || input.recurring_settings.is_some()))
    {
        return Err(AppError::Domain("后续任务草稿只能创建独立普通任务，不能切换类型或更新已有任务".into()));
    }
    Ok(())
}

pub(super) fn confirm_origin(transaction: &Transaction<'_>, draft: &TaskDraftDto, task_id: &str) -> AppResult<()> {
    if let Some(origin) = &draft.origin {
        if let Some(source_id) = &origin.source_task_id {
            if existing_child(transaction, source_id)?.is_some() {
                return Err(AppError::Domain("该任务已有后续任务，请打开已有任务；草稿已保留".into()));
            }
        }
        // Retain the immutable preparation-time title snapshot, not editable task content.
        transaction.execute("INSERT INTO task_origins (task_id, source_task_id, source_title, created_at)
            SELECT ?2, source_task_id, source_title, ?3 FROM task_draft_origins WHERE draft_id = ?1",
            params![draft.id, task_id, now()])?;
    }
    Ok(())
}

impl Database {
    pub fn prepare_task_followup(&mut self, source_task_id: &str) -> AppResult<FollowupPreparation> {
        let transaction = self.connection.transaction()?;
        let source = load_task_dto_in_transaction(&transaction, source_task_id)?;
        let recurring: bool = transaction.query_row("SELECT EXISTS(SELECT 1 FROM recurrence_instances WHERE task_id = ?1)",
            [source_task_id], |row| row.get(0))?;
        if source.deleted_at.is_some() || !matches!(source.status.as_str(), "open" | "scheduled") || recurring {
            return Err(AppError::Domain("只有进行中的普通任务可以创建后续任务".into()));
        }
        if let Some(task_id) = existing_child(&transaction, source_task_id)? {
            transaction.commit()?;
            return Ok(FollowupPreparation::Existing { task_id });
        }
        let existing: Option<String> = transaction.query_row("SELECT draft.id FROM task_drafts draft
            JOIN task_draft_origins origin ON origin.draft_id = draft.id WHERE origin.source_task_id = ?1
            AND draft.status = 'active' AND draft.draft_kind = 'create' AND draft.item_type = 'task'
            ORDER BY draft.created_at, draft.id LIMIT 1", [source_task_id], |row| row.get(0)).optional()?;
        if let Some(id) = existing {
            let draft = load_task_draft_in_transaction(&transaction, &id)?;
            validate_linked_draft(&draft, None)?;
            transaction.commit()?;
            return Ok(FollowupPreparation::Draft { draft });
        }
        let tomorrow = parse_plan_date(&shanghai_today())?.succ_opt()
            .ok_or_else(|| AppError::Domain("日期超出范围".into()))?.to_string();
        let input = TaskDraftInput { item_type: "task".into(), recurring_settings: None, title: source.title.clone(),
            notes: None, priority: source.priority.as_deref().map(parse_priority).transpose()?, earliest_start_date: Some(tomorrow.clone()), earliest_start_time: Some("09:00".into()),
            due_date: Some(tomorrow), due_time: Some("10:00".into()), total_workload_minutes: Some(60), remaining_workload_minutes: Some(60),
            field_states_json: "{}".into(), tags: source.tags.clone(), recurrence: None };
        let id = Uuid::new_v4().to_string();
        insert_manual_draft(&transaction, &input, &id)?;
        transaction.execute("INSERT INTO task_draft_origins (draft_id, source_task_id, source_title, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, source_task_id, source.title, now()])?;
        let draft = load_task_draft_in_transaction(&transaction, &id)?;
        transaction.commit()?;
        Ok(FollowupPreparation::Draft { draft })
    }
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
