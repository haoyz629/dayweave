use std::path::Path;

use chrono::{DateTime, Datelike, Duration, FixedOffset, NaiveDate, NaiveTime, TimeZone, Timelike, Utc};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

use crate::{
    domain::{AiOperation, AiProposal, Priority, ReviewOutcome, TaskSource, TaskStatus, MIN_TASK_BLOCK_MINUTES},
    error::{AppError, AppResult},
};
use crate::holiday_calendar::{self, CalendarState, Snapshot as HolidaySnapshot, UpdateJob, Downloaded};

#[path = "database_execution.rs"]
mod database_execution;
pub use database_execution::TaskExecutionResolutionInput;
#[path = "database_followup.rs"]
mod database_followup;
pub use database_followup::TaskExecutionFactDto;
#[path = "database_history.rs"]
mod database_history;
pub use database_history::TaskHistoryEventDto;
#[path = "database_results.rs"]
mod database_results;
#[path = "database_tags.rs"]
mod database_tags;
pub use database_tags::TaskTagDefinition;
#[path = "database_priority.rs"]
mod database_priority;

#[path = "database_recurring.rs"]
mod database_recurring;
#[path = "database_recurring_execution.rs"]
mod database_recurring_execution;
pub use database_recurring_execution::RecurringExecutionEventDto;

#[path = "database_reminder.rs"]
mod database_reminder;
pub use database_reminder::DueReminderSnooze;
pub struct Database {
    connection: Connection,
    holiday_calendar: CalendarState,
}

#[derive(Debug, Serialize)]
pub struct ProposalPreview {
    pub ai_run_id: String,
    pub confirmation_token: String,
    pub proposal: AiProposal,
}

#[derive(Debug, Serialize)]
pub struct ApplyResult {
    pub affected_task_ids: Vec<String>,
    pub plan_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskDto {
    pub id: String,
    pub title: String,
    pub notes: Option<String>,
    pub priority: Option<String>,
    pub earliest_start_at: Option<String>,
    pub due_at: Option<String>,
    pub estimated_minutes: Option<i64>,
    pub earliest_start_date: Option<String>,
    pub earliest_start_time: Option<String>,
    pub due_date: Option<String>,
    pub due_time: Option<String>,
    pub total_workload_minutes: Option<i64>,
    pub remaining_workload_minutes: Option<i64>,
    pub actual_minutes: i64,
    pub source_type: String,
    pub migration_review_required: bool,
    pub splittable: bool,
    pub status: String,
    pub deleted_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub reserved_minutes: i64,
    pub scheduled_dates: Vec<String>,
    pub tags: Vec<String>,
    #[serde(default)]
    pub execution_locked: bool,
    #[serde(default)]
    pub result_date: Option<String>,
    #[serde(default)]
    pub result_ends_at: Option<String>,
    #[serde(default)]
    pub is_incomplete: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaskDraftInput {
    #[serde(default = "default_draft_item_type")]
    pub item_type: String,
    #[serde(default)]
    pub recurring_settings: Option<RecurringDraftSettings>,
    pub title: String,
    pub notes: Option<String>,
    pub priority: Option<Priority>,
    pub earliest_start_date: Option<String>,
    pub earliest_start_time: Option<String>,
    pub due_date: Option<String>,
    pub due_time: Option<String>,
    pub total_workload_minutes: Option<i64>,
    pub remaining_workload_minutes: Option<i64>,
    pub field_states_json: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub recurrence: Option<RecurrenceInput>,
}

fn default_draft_item_type() -> String { "task".into() }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecurringDraftSettings {
    pub frequency: String,
    pub interval_value: i64,
    pub weekdays: Vec<u32>,
    pub month_day: Option<u32>,
    pub starts_on: String,
    pub ends_on: Option<String>,
    pub display_time: Option<String>,
    pub display_duration_minutes: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "item_type", content = "item")]
pub enum ConfirmedCreation {
    #[serde(rename = "task")]
    Task(TaskDto),
    #[serde(rename = "recurring")]
    Recurring(RecurringItemDto),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RecurrenceInput {
    pub frequency: String,
    pub interval_value: i64,
    #[serde(default)]
    pub weekdays: Vec<u32>,
    pub month_day: Option<u32>,
    pub starts_on: String,
    pub ends_on: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RecurringItemInput {
    pub title: String,
    pub notes: Option<String>,
    pub frequency: String,
    pub interval_value: i64,
    #[serde(default)]
    pub weekdays: Vec<u32>,
    pub month_day: Option<u32>,
    pub starts_on: String,
    pub ends_on: Option<String>,
    pub display_time: Option<String>,
    pub display_duration_minutes: Option<i64>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RecurringItemDto {
    pub id: String,
    pub source_type: String,
    pub title: String,
    pub notes: Option<String>,
    pub frequency: String,
    pub interval_value: i64,
    pub weekdays: Vec<u32>,
    pub month_day: Option<u32>,
    pub starts_on: String,
    pub ends_on: Option<String>,
    pub display_time: Option<String>,
    pub display_duration_minutes: Option<i64>,
    pub tags: Vec<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RecurringOccurrenceDto {
    pub id: String,
    pub recurring_item_id: String,
    pub title: String,
    pub notes: Option<String>,
    pub occurrence_date: String,
    pub display_time: Option<String>,
    pub display_duration_minutes: Option<i64>,
    pub tags: Vec<String>,
    pub outcome: Option<String>,
    pub review_notes: Option<String>,
    pub reviewed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub schedule_rule: Option<RecurringItemInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecurringOccurrenceReviewInput {
    pub outcome: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskMetadataDto {
    pub task_id: String,
    pub tags: Vec<String>,
    pub recurrence: Option<RecurrenceInput>,
    pub latest_execution: Option<TaskExecutionFactDto>,
    pub completion_date: Option<String>,
    pub completion_ends_at: Option<String>,
    pub completion_backfill_allowed: bool,
    pub completion_recorded_at: Option<String>,
    pub history: Vec<TaskHistoryEventDto>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct UndoEntryDto {
    pub id: String,
    pub action_kind: String,
    pub target_type: String,
    pub target_id: String,
    pub expires_at: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskBlockNotificationDto {
    pub block_id: String,
    pub task_id: String,
    pub task_title: String,
    pub task_notes: Option<String>,
    pub task_priority: Option<String>,
    pub task_tags: Vec<String>,
    pub starts_at: String,
    pub ends_at: String,
    pub event_at: String,
    pub is_end: bool,
    #[serde(default)]
    pub schedule_revision: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct PlanUndoBlock {
    id: String,
    task_id: String,
    starts_at: String,
    ends_at: String,
    source: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct PlanUndoTaskState {
    id: String,
    status: String,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PlanUndoPayload {
    plan_date: String,
    plan_source: String,
    created_new_plan: bool,
    before_blocks: Vec<PlanUndoBlock>,
    before_tasks: Vec<PlanUndoTaskState>,
    after_blocks: Vec<PlanUndoBlock>,
    after_tasks: Vec<PlanUndoTaskState>,
    #[serde(default)]
    before_single_day_tasks: Vec<TaskDto>,
    #[serde(default)]
    single_day_schedule_undo: Vec<TaskScheduleUndo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct TaskScheduleBlock {
    plan_id: String,
    plan_date: String,
    #[serde(flatten)]
    block: PlanUndoBlock,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TaskScheduleUndo {
    task: Option<TaskDto>,
    before_blocks: Vec<TaskScheduleBlock>,
    after_blocks: Vec<TaskScheduleBlock>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanBlockTimeUpdate {
    pub plan_date: String,
    pub block_id: String,
    pub expected_starts_at: String,
    pub expected_ends_at: String,
    pub starts_at: String,
    pub ends_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanTaskInclude {
    pub plan_date: String,
    pub task_id: String,
    pub expected_updated_at: String,
    pub expected_reserved_minutes: i64,
    pub blocks: Vec<RulePlanBlock>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanBlockRemove {
    pub plan_date: String,
    pub block_id: String,
    pub expected_starts_at: String,
    pub expected_ends_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AiConnectionSettingsInput {
    pub api_type: String,
    pub endpoint: String,
    pub model: String,
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AiConnectionSettingsDto {
    pub api_type: String,
    pub endpoint: String,
    pub model: String,
    pub api_key_configured: bool,
}

#[derive(Debug, Clone)]
pub struct StoredAiConnectionSettings {
    pub api_type: String,
    pub endpoint: String,
    pub model: String,
    pub api_key: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AiConversationDto {
    pub id: String,
    pub title: String,
    pub status: String,
    pub message_count: i64,
    pub draft_count: i64,
    pub created_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AiMessageDto {
    pub id: String,
    pub conversation_id: String,
    pub run_id: Option<String>,
    pub role: String,
    pub content: String,
    pub stream_status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AiRunDto {
    pub id: String,
    pub conversation_id: String,
    pub run_status: String,
    pub assistant_message: Option<String>,
    pub error_message: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub stopped_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AiRunContext {
    pub run: AiRunDto,
    pub messages: Vec<AiMessageDto>,
    pub task_candidates: Vec<AiTaskCandidateDto>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AiTaskCandidateDto {
    pub id: String,
    pub title: String,
    pub status: String,
    pub priority: Option<String>,
    pub due_date: Option<String>,
    pub due_time: Option<String>,
    pub earliest_start_date: Option<String>,
    pub earliest_start_time: Option<String>,
    pub remaining_workload_minutes: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct AiDraftCreationInput {
    pub draft_kind: String,
    pub target_task_id: Option<String>,
    pub input: TaskDraftInput,
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskDraftDto {
    pub item_type: String,
    pub recurring_settings: Option<RecurringDraftSettings>,
    pub confirmed_recurring_item_id: Option<String>,
    pub id: String,
    pub draft_kind: String,
    pub target_task_id: Option<String>,
    pub source_type: String,
    pub conversation_id: Option<String>,
    pub title: String,
    pub notes: Option<String>,
    pub priority: Option<String>,
    pub earliest_start_date: Option<String>,
    pub earliest_start_time: Option<String>,
    pub due_date: Option<String>,
    pub due_time: Option<String>,
    pub total_workload_minutes: Option<i64>,
    pub remaining_workload_minutes: Option<i64>,
    pub splittable: bool,
    pub field_states_json: String,
    pub validation_status: String,
    pub version: i64,
    pub confirmation_token: String,
    pub status: String,
    pub confirmed_task_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub confirmed_at: Option<String>,
    pub tags: Vec<String>,
    pub recurrence: Option<RecurrenceInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManualTaskUpdate {
    pub title: String,
    pub notes: Option<String>,
    pub priority: Option<Priority>,
    pub earliest_start_at: Option<String>,
    pub due_at: Option<String>,
    pub estimated_minutes: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CalendarEventDto {
    pub id: String,
    pub title: String,
    pub starts_at: String,
    pub ends_at: String,
    pub is_all_day: bool,
    #[allow(dead_code)] // SQLite compatibility only; deliberately omitted from the UI API.
    #[serde(skip_serializing)]
    pub blocks_scheduling: bool,
    pub deleted_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManualCalendarEventInput {
    pub title: String,
    pub starts_at: String,
    pub ends_at: String,
    pub is_all_day: bool,
    #[serde(default)]
    pub blocks_scheduling: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AvailabilitySettings {
    pub weekdays: Vec<u32>,
    pub workday_start: String,
    pub workday_end: String,
    #[serde(default = "default_makeup_workdays_as_workdays")]
    pub makeup_workdays_as_workdays: bool,
    /// Legacy persistence fields are intentionally omitted from the UI/API response.
    /// They remain readable so existing databases can migrate without data loss.
    #[serde(default, skip_serializing)]
    pub lunch_start: Option<String>,
    #[serde(default, skip_serializing)]
    pub lunch_end: Option<String>,
    #[serde(default, skip_serializing)]
    pub lunch_reason: String,
    #[serde(default, skip_serializing)]
    pub buffer_minutes: i64,
}

fn default_makeup_workdays_as_workdays() -> bool { true }

impl Default for AvailabilitySettings {
    fn default() -> Self {
        Self {
            weekdays: vec![1, 2, 3, 4, 5],
            workday_start: "09:00".into(),
            workday_end: "18:00".into(),
            makeup_workdays_as_workdays: true,
            lunch_start: None,
            lunch_end: None,
            lunch_reason: String::new(),
            buffer_minutes: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RulePlanBlock {
    pub task_id: String,
    pub task_title: String,
    pub starts_at: String,
    pub ends_at: String,
    pub estimated_minutes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UnscheduledTask {
    pub task_id: String,
    pub task_title: String,
    pub reason: String,
    pub estimated_minutes: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RulePlanPreview {
    pub preview_id: String,
    pub plan_date: String,
    pub base_plan_id: Option<String>,
    pub blocks: Vec<RulePlanBlock>,
    pub unscheduled: Vec<UnscheduledTask>,
    pub generated_at: String,
    pub version: i64,
    pub confirmation_token: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct RulePlanDraftDiscardResult {
    pub restored_task_count: usize,
    pub conflicted_task_titles: Vec<String>,
}

#[derive(Debug)]
struct StoredRulePlanDraft {
    preview: RulePlanPreview,
    facts_json: String,
    status: String,
}

fn restore_rule_plan_draft_boundaries(
    transaction: &Transaction<'_>,
    preview_id: &str,
    timestamp: &str,
    change_source: &str,
    change_reason: &str,
) -> AppResult<RulePlanDraftDiscardResult> {
    let boundary_changes = {
        let mut statement = transaction.prepare(
            "SELECT task_id, original_earliest_start_at, original_due_at,
                    applied_earliest_start_at, applied_due_at
             FROM daily_plan_draft_task_boundaries
             WHERE draft_id = ?1
             ORDER BY task_id",
        )?;
        let rows = statement.query_map([preview_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };

    let mut restored_task_count = 0usize;
    let mut conflicted_task_titles = Vec::new();
    for (task_id, original_earliest, original_due, applied_earliest, applied_due) in boundary_changes {
        let current = load_task_dto_in_transaction(transaction, &task_id)?;
        if current.execution_locked || current.earliest_start_at != applied_earliest || current.due_at != applied_due {
            conflicted_task_titles.push(current.title);
            continue;
        }
        if current.earliest_start_at != original_earliest {
            record_task_change(
                transaction,
                &task_id,
                "earliest_start_changed",
                current.earliest_start_at.as_deref(),
                original_earliest.as_deref(),
                change_source,
                Some(change_reason),
            )?;
        }
        if current.due_at != original_due {
            record_task_change(
                transaction,
                &task_id,
                "due_changed",
                current.due_at.as_deref(),
                original_due.as_deref(),
                change_source,
                Some(change_reason),
            )?;
        }
        let (earliest_start_date, earliest_start_time) =
            split_legacy_timestamp(original_earliest.as_deref());
        let (due_date, due_time) = split_legacy_timestamp(original_due.as_deref());
        transaction.execute(
            "UPDATE tasks
             SET earliest_start_at = ?2, due_at = ?3,
                 earliest_start_date = ?4, earliest_start_time = ?5,
                 due_date = ?6, due_time = ?7, updated_at = ?8
             WHERE id = ?1",
            params![
                task_id,
                original_earliest,
                original_due,
                earliest_start_date,
                earliest_start_time,
                due_date,
                due_time,
                timestamp,
            ],
        )?;
        restored_task_count += 1;
    }

    transaction.execute(
        "DELETE FROM daily_plan_draft_task_boundaries WHERE draft_id = ?1",
        [preview_id],
    )?;
    Ok(RulePlanDraftDiscardResult { restored_task_count, conflicted_task_titles })
}

#[derive(Debug, Clone, Serialize)]
pub struct PlanBlockDto {
    pub id: String,
    pub daily_plan_id: String,
    pub task_id: String,
    pub task_title: String,
    pub task_status: String,
    pub starts_at: String,
    pub ends_at: String,
    pub result_date: Option<String>,
    pub result_ends_at: Option<String>,
    pub source: String,
    pub execution_status: String,
    pub actual_minutes: Option<i64>,
    pub review_required: bool,
    pub execution_note: Option<String>,
    pub execution_captured_at: Option<String>,
    pub remaining_workload_minutes: Option<i64>,
    pub review: Option<ReviewEntryDto>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExecutionCaptureInput {
    pub plan_block_id: String,
    pub outcome: Option<ReviewOutcome>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReviewEntryInput {
    pub plan_block_id: String,
    pub outcome: ReviewOutcome,
    pub actual_minutes: Option<i64>,
    pub defer_reason: Option<String>,
    pub notes: Option<String>,
    pub remaining_workload_minutes: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReviewEntryDto {
    pub id: String,
    pub review_date: String,
    pub plan_block_id: Option<String>,
    pub task_id: String,
    pub outcome: String,
    pub actual_minutes: Option<i64>,
    pub defer_reason: Option<String>,
    pub notes: Option<String>,
    pub remaining_workload_minutes: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
    pub followup_action: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DayScheduleDto {
    pub plan_id: Option<String>,
    pub plan_status: Option<String>,
    pub plan_source: Option<String>,
    pub fixed_events: Vec<CalendarEventDto>,
    pub task_blocks: Vec<PlanBlockDto>,
}

#[derive(Debug)]
struct TaskRow {
    title: String,
    priority: Option<String>,
    estimated_minutes: Option<i64>,
    earliest_start_at: Option<String>,
    due_at: Option<String>,
    splittable: bool,
    status: TaskStatus,
}

#[derive(Debug)]
struct TaskBoundaryExpansion {
    task_id: String,
    old_earliest_start_at: Option<String>,
    new_earliest_start_at: Option<String>,
    old_due_at: Option<String>,
    new_due_at: Option<String>,
}

#[derive(Debug, Clone)]
struct RuleCandidate {
    task_id: String,
    task_title: String,
    estimated_minutes: Option<i64>,
    total_workload_minutes: Option<i64>,
    reserved_minutes: i64,
    earliest_start_at: Option<String>,
    due_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewFormDraft {
    pub review_date: String,
    pub item_type: String,
    pub item_id: String,
    pub payload_json: String,
    pub revision: i64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ExecutionSnapshot {
    id: String,
    execution_status: String,
    actual_minutes: Option<i64>,
    review_required: bool,
    execution_note: Option<String>,
    execution_captured_at: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct ReviewResultSnapshot {
    id: String,
    outcome: String,
    notes: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct FactUndo {
    task: Option<TaskDto>,
    block: Option<ExecutionSnapshot>,
    occurrence: Option<RecurringOccurrenceDto>,
    #[serde(default)]
    review: Option<ReviewResultSnapshot>,
    after_facts: String,
}

fn execution_snapshot(connection: &Connection, id: &str) -> AppResult<ExecutionSnapshot> {
    Ok(connection.query_row("SELECT id, execution_status, actual_minutes, review_required, execution_note, execution_captured_at FROM plan_blocks WHERE id = ?1", [id], |row| Ok(ExecutionSnapshot {
        id: row.get(0)?, execution_status: row.get(1)?, actual_minutes: row.get(2)?,
        review_required: row.get(3)?, execution_note: row.get(4)?, execution_captured_at: row.get(5)?,
    }))?)
}

// Compare persisted facts, including unchanged historical blocks and reviews; restore only our columns.
fn fact_rows(connection: &Connection, sql: &str, id: &str) -> AppResult<Vec<Vec<String>>> {
    let mut statement = connection.prepare(sql)?;
    let columns = statement.column_count();
    let rows = statement.query_map([id], |row| {
        (0..columns).map(|column| row.get_ref(column).map(|value| format!("{value:?}"))).collect::<Result<Vec<_>, _>>()
    })?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn fact_fingerprint(connection: &Connection, kind: &str, id: &str) -> AppResult<String> {
    let queries: &[&str] = if kind == "task_completion" || kind == "execution_capture" {
        &[
            "SELECT * FROM tasks WHERE id = ?1",
            "SELECT pb.*, dp.plan_date, dp.status FROM plan_blocks pb JOIN daily_plans dp ON dp.id = pb.daily_plan_id WHERE pb.task_id = ?1 ORDER BY pb.id",
            "SELECT * FROM review_entries WHERE task_id = ?1 ORDER BY id",
            "SELECT * FROM task_estimates WHERE task_id = ?1 ORDER BY id",
            "SELECT * FROM task_changes WHERE task_id = ?1 ORDER BY id",
            "SELECT * FROM task_tags WHERE task_id = ?1 ORDER BY tag_id",
        ]
    } else {
        &[
            "SELECT * FROM recurring_occurrences WHERE id = ?1",
            "SELECT * FROM recurring_items WHERE id = (SELECT recurring_item_id FROM recurring_occurrences WHERE id = ?1)",
            "SELECT * FROM recurring_execution_events WHERE occurrence_id = ?1 ORDER BY id",
        ]
    };
    let facts = queries.iter().map(|sql| fact_rows(connection, sql, id)).collect::<AppResult<Vec<_>>>()?;
    Ok(serde_json::to_string(&facts)?)
}

fn validate_review_date(date: &str) -> AppResult<bool> {
    let date = parse_plan_date(date)?;
    let today = parse_plan_date(&shanghai_today())?;
    let age = (today - date).num_days();
    if !(0..=6).contains(&age) {
        return Err(AppError::Domain("只能记录中国标准时间今天及此前 6 天；未来和更早日期只读".into()));
    }
    Ok(age == 0)
}

fn validate_review_target(connection: &Connection, date: &str, kind: &str, id: &str) -> AppResult<()> {
    let today = validate_review_date(date)?;
    let writable: bool = match kind {
        "task" => connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM plan_blocks pb JOIN daily_plans dp ON dp.id = pb.daily_plan_id JOIN tasks t ON t.id = pb.task_id
             WHERE pb.id = ?1 AND dp.plan_date = ?2 AND t.status <> 'deleted' AND t.deleted_at IS NULL
             AND NOT EXISTS(SELECT 1 FROM review_entries WHERE plan_block_id = pb.id))",
            params![id, date], |row| row.get(0))?,
        "recurring" => connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM recurring_occurrences o JOIN recurring_items i ON i.id = o.recurring_item_id
             WHERE o.id = ?1 AND o.occurrence_date = ?2 AND (?3 OR o.outcome IS NULL))",
            params![id, date, today], |row| row.get(0))?,
        _ => return Err(AppError::Schema("无效的记录条目类型".into())),
    };
    if !writable { return Err(AppError::Domain("记录对象不存在、已删除、日期不符或已有最终事实".into())); }
    Ok(())
}

fn clear_review_draft(connection: &Connection, date: &str, kind: &str, id: &str) -> AppResult<()> {
    // Monotonic tombstone prevents a delayed autosave from reviving submitted input.
    connection.execute("INSERT INTO review_form_drafts (review_date, item_type, item_id, payload_json, revision, updated_at)
        VALUES (?1, ?2, ?3, NULL, 1, ?4) ON CONFLICT(review_date,item_type,item_id)
        DO UPDATE SET payload_json = NULL, revision = revision + 1, updated_at = excluded.updated_at",
        params![date, kind, id, now()])?;
    Ok(())
}

fn preserve_review_supplement_after_capture(connection: &Connection, date: &str, id: &str, previous_note: Option<&str>) -> AppResult<()> {
    let previous: Option<String> = connection.query_row(
        "SELECT payload_json FROM review_form_drafts WHERE review_date = ?1 AND item_type = 'task' AND item_id = ?2",
        params![date, id], |row| row.get::<_, Option<String>>(0),
    ).optional()?.flatten();
    let mut supplement = serde_json::Map::new();
    if let Some(payload) = previous {
        if let Ok(serde_json::Value::Object(values)) = serde_json::from_str(&payload) {
            for field in ["actual_minutes", "defer_reason", "notes", "remaining_workload_minutes"] {
                if let Some(value) = values.get(field).filter(|value| value.is_string()) {
                    if field != "notes" || value.as_str() != Some(previous_note.unwrap_or("")) {
                        supplement.insert(field.into(), value.clone());
                    }
                }
            }
        }
    }
    clear_review_draft(connection, date, "task", id)?;
    if !supplement.is_empty() {
        connection.execute("UPDATE review_form_drafts SET payload_json = ?3 WHERE review_date = ?1 AND item_type = 'task' AND item_id = ?2",
            params![date, id, serde_json::to_string(&supplement)?])?;
    }
    Ok(())
}

fn load_occurrence(connection: &Connection, id: &str) -> AppResult<RecurringOccurrenceDto> {
    database_recurring::load_snapshot(connection, id)
}

impl Database {
    pub fn get_holiday_calendar(&self) -> HolidaySnapshot {
        self.holiday_calendar.snapshot.clone()
    }

    pub fn begin_holiday_update(&mut self, years: Vec<i32>, force: bool) -> AppResult<Option<UpdateJob>> {
        self.holiday_calendar.begin(&self.connection, years, force, Utc::now())
    }

    pub fn finish_holiday_update(&mut self, result: AppResult<Downloaded>) -> HolidaySnapshot {
        self.holiday_calendar.finish(&mut self.connection, result, Utc::now())
    }

    pub fn open(path: impl AsRef<Path>) -> AppResult<Self> {
        let connection = Connection::open(path)?;
        connection.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
        let mut database = Self { connection, holiday_calendar: CalendarState::bundled() };
        database.migrate()?;
        database.holiday_calendar = CalendarState::load(&database.connection)?;
        Ok(database)
    }

    #[cfg(test)]
    pub fn in_memory() -> AppResult<Self> {
        let connection = Connection::open_in_memory()?;
        connection.execute_batch("PRAGMA foreign_keys = ON;")?;
        let mut database = Self { connection, holiday_calendar: CalendarState::bundled() };
        database.migrate()?;
        database.holiday_calendar = CalendarState::load(&database.connection)?;
        Ok(database)
    }

    pub fn migrate(&mut self) -> AppResult<()> {
        self.connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            );",
        )?;
        let current: i64 = self.connection.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )?;
        for (version, sql) in MIGRATIONS {
            if *version <= current { continue; }
            if *version == 32 {
                database_priority::migrate(&mut self.connection, *version)?;
                continue;
            }
            let transaction = self.connection.transaction()?;
            let review_schema: Vec<(String, String)> = if *version == 22 {
                let mut statement = transaction.prepare("SELECT name, sql FROM sqlite_master WHERE tbl_name = 'review_entries' AND type IN ('index','trigger') AND sql IS NOT NULL")?;
                let rows = statement.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?.collect::<Result<Vec<_>, _>>()?;
                rows
            } else { Vec::new() };
            transaction.execute_batch(sql)?;
            if *version == 26 { database_results::backfill_completion_context(&transaction)?; }
            if *version == 27 { database_recurring::backfill(&transaction)?; }
            for (name, definition) in review_schema {
                let exists: bool = transaction.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name = ?1)", [&name], |row| row.get(0))?;
                if !exists { transaction.execute_batch(&definition)?; }
            }
            transaction.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
                params![version, now()],
            )?;
            transaction.commit()?;
        }
        Ok(())
    }

    #[cfg(test)]
    pub fn create_manual_task(&mut self, title: impl Into<String>) -> AppResult<String> {
        let title = title.into();
        crate::domain::validate_title(&title)?;
        let id = Uuid::new_v4().to_string();
        let timestamp = now();
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "INSERT INTO tasks (id, title, splittable, status, created_at, updated_at)
             VALUES (?1, ?2, 1, 'open', ?3, ?3)",
            params![id, title, timestamp],
        )?;
        record_task_change(&transaction, &id, "created", None, Some("open"), "manual", None)?;
        transaction.commit()?;
        Ok(id)
    }

    pub fn create_manual_task_draft(&mut self, input: TaskDraftInput) -> AppResult<TaskDraftDto> {
        self.create_task_draft_with_id(input, Uuid::new_v4().to_string())
    }

    pub fn import_legacy_recurring_draft(&mut self, input: TaskDraftInput) -> AppResult<TaskDraftDto> {
        if input.item_type != "recurring" { return Err(AppError::Schema("旧草稿类型无效".into())); }
        self.create_task_draft_with_id(input, "legacy-local-recurring-draft".into())
    }

    fn create_task_draft_with_id(&mut self, input: TaskDraftInput, id: String) -> AppResult<TaskDraftDto> {
        validate_task_draft_input(&input, false)?;
        let transaction = self.connection.transaction()?;
        if transaction.query_row("SELECT EXISTS(SELECT 1 FROM task_drafts WHERE id = ?1)", [&id], |row| row.get::<_, bool>(0))? {
            return load_task_draft_in_transaction(&transaction, &id);
        }
        database_followup::insert_manual_draft(&transaction, &input, &id)?;
        let draft = load_task_draft_in_transaction(&transaction, &id)?;
        transaction.commit()?;
        Ok(draft)
    }

    pub fn save_task_draft(
        &mut self,
        draft_id: &str,
        expected_version: i64,
        input: TaskDraftInput,
    ) -> AppResult<TaskDraftDto> {
        if expected_version < 1 {
            return Err(AppError::Domain("草稿版本无效".into()));
        }
        validate_task_draft_input(&input, false)?;
        let tags_json = serde_json::to_string(&normalize_tags(&input.tags)?)?;
        let recurrence_json = input.recurrence.as_ref().map(serde_json::to_string).transpose()?;
        let recurring_settings_json = input.recurring_settings.as_ref().map(serde_json::to_string).transpose()?;
        let next_confirmation_token = Uuid::new_v4().to_string();
        let validation_status = draft_validation_status(&input);
        let transaction = self.connection.transaction()?;
        let existing = load_task_draft_in_transaction(&transaction, draft_id)?;
        database_tags::validate_selection(&input.tags, &existing.tags)?;
        database_tags::register_tags(&transaction, &input.tags)?;
        if existing.draft_kind == "update" && input.item_type != "task" {
            return Err(AppError::Domain("修改已有任务的草稿不能切换类型".into()));
        }
        let changed = transaction.execute(
            "UPDATE task_drafts
             SET title = ?3, notes = ?4, priority = ?5,
                 earliest_start_date = ?6, earliest_start_time = ?7,
                 due_date = ?8, due_time = ?9,
                 total_workload_minutes = ?10, remaining_workload_minutes = ?11,
                 splittable = ?12, field_states_json = ?13,
                 validation_status = ?14, version = version + 1,
                 confirmation_token = ?15, updated_at = ?16,
                 tags_json = ?17, recurrence_json = ?18, item_type = ?19, recurring_settings_json = ?20
             WHERE id = ?1 AND version = ?2 AND status = 'active'",
            params![
                draft_id,
                expected_version,
                input.title,
                input.notes,
                input.priority.map(Priority::as_str),
                input.earliest_start_date,
                input.earliest_start_time,
                input.due_date,
                input.due_time,
                input.total_workload_minutes,
                input.remaining_workload_minutes,
                1,
                input.field_states_json,
                validation_status,
                next_confirmation_token,
                now(),
                tags_json,
                recurrence_json,
                input.item_type,
                recurring_settings_json,
            ],
        )?;
        if changed != 1 {
            return Err(AppError::Domain("草稿已被更新、确认或放弃，请刷新后重试".into()));
        }
        let draft = load_task_draft_in_transaction(&transaction, draft_id)?;
        transaction.commit()?;
        Ok(draft)
    }

    pub fn list_task_drafts(&self, include_discarded: bool) -> AppResult<Vec<TaskDraftDto>> {
        let mut statement = self.connection.prepare(
            "SELECT id, draft_kind, target_task_id, source_type, conversation_id,
                    title, notes, priority, earliest_start_date, earliest_start_time,
                    due_date, due_time, total_workload_minutes, remaining_workload_minutes,
                    splittable, field_states_json, validation_status, version,
                    confirmation_token, status, confirmed_task_id, created_at, updated_at, confirmed_at,
                    tags_json, recurrence_json, item_type, recurring_settings_json, confirmed_recurring_item_id
             FROM task_drafts
             WHERE status = 'active' OR (?1 = 1 AND status = 'discarded')
             ORDER BY updated_at DESC",
        )?;
        let rows = statement.query_map([include_discarded as i64], task_draft_dto_from_row)?;
        let drafts = rows.collect::<Result<Vec<_>, _>>()?;
        Ok(drafts)
    }

    pub fn confirm_task_draft(
        &mut self,
        draft_id: &str,
        confirmation_token: &str,
    ) -> AppResult<TaskDto> {
        let transaction = self.connection.transaction()?;
        let draft = load_task_draft_in_transaction(&transaction, draft_id)?;
        if draft.confirmation_token != confirmation_token {
            return Err(AppError::InvalidConfirmation);
        }
        if draft.item_type != "task" { return Err(AppError::Domain("请按草稿所选类型确认创建".into())); }
        if draft.status == "confirmed" {
            let task_id = draft.confirmed_task_id.ok_or(AppError::InvalidConfirmation)?;
            let task = load_task_dto_in_transaction(&transaction, &task_id)?;
            transaction.commit()?;
            return Ok(task);
        }
        if draft.status != "active" {
            return Err(AppError::Domain("已放弃的草稿不能确认".into()));
        }
        let input = TaskDraftInput {
            item_type: draft.item_type.clone(),
            recurring_settings: draft.recurring_settings.clone(),
            title: draft.title.clone(),
            notes: draft.notes.clone(),
            priority: draft.priority.as_deref().map(parse_priority).transpose()?,
            earliest_start_date: draft.earliest_start_date.clone(),
            earliest_start_time: draft.earliest_start_time.clone(),
            due_date: draft.due_date.clone(),
            due_time: draft.due_time.clone(),
            total_workload_minutes: draft.total_workload_minutes,
            remaining_workload_minutes: draft.remaining_workload_minutes,
            field_states_json: draft.field_states_json.clone(),
            tags: draft.tags.clone(),
            recurrence: draft.recurrence.clone(),
        };
        validate_task_draft_input(&input, true)?;
        validate_confirmable_task_input(&input)?;
        if input.recurrence.is_some() {
            return Err(AppError::Domain("重复内容请使用独立的“重复事项”类型创建；普通任务不会再批量生成重复实例".into()));
        }

        if draft.draft_kind == "update" {
            let task_id = draft.target_task_id.clone().ok_or_else(|| AppError::Schema("修改草稿缺少目标任务".into()))?;
            let before = load_task_dto_in_transaction(&transaction, &task_id)?;
            let before_blocks = load_task_schedule_blocks(&transaction, &task_id)?;
            let current_drafts = current_plan_draft_dates(&transaction)?;
            ensure_task_content_editable(&before)?;
            ensure_task_not_moved_into_history(&before, input.earliest_start_date.as_deref(), input.due_date.as_deref())?;
            let earliest_start_at = legacy_timestamp(input.earliest_start_date.as_deref(), input.earliest_start_time.as_deref());
            let due_at = legacy_timestamp(input.due_date.as_deref(), input.due_time.as_deref());
            let timestamp = now();
            transaction.execute(
                "UPDATE tasks SET title = ?2, notes = ?3, priority = ?4,
                    earliest_start_at = ?5, due_at = ?6, estimated_minutes = ?7,
                    earliest_start_date = ?8, earliest_start_time = ?9,
                    due_date = ?10, due_time = ?11, total_workload_minutes = ?12,
                    remaining_workload_minutes = ?13, migration_review_required = 0,
                    updated_at = ?14 WHERE id = ?1",
                params![
                    task_id, input.title.trim(), input.notes, input.priority.map(Priority::as_str),
                    earliest_start_at, due_at, input.total_workload_minutes,
                    input.earliest_start_date, input.earliest_start_time, input.due_date, input.due_time,
                    input.total_workload_minutes, input.remaining_workload_minutes.or(input.total_workload_minutes), timestamp,
                ],
            )?;
            apply_task_tags(&transaction, &task_id, &input.tags)?;
            record_task_change(
                &transaction, &task_id, "updated_from_ai_draft", Some(&before.updated_at),
                Some(&timestamp), "ai", Some(&format!("task_draft:{draft_id}")),
            )?;
            transaction.execute(
                "UPDATE task_drafts SET status = 'confirmed', confirmed_task_id = ?2,
                        confirmed_at = ?3, updated_at = ?3 WHERE id = ?1 AND status = 'active'",
                params![draft_id, task_id, timestamp],
            )?;
            sync_single_day_task_schedule(&transaction, &task_id, Some(&before), &current_drafts)?;
            let task = load_task_dto_in_transaction(&transaction, &task_id)?;
            record_undo_entry(
                &transaction, "task_updated", "task", &task_id,
                &task_schedule_undo_json(&transaction, &task_id, Some(before), before_blocks)?, Some(&task.updated_at),
            )?;
            transaction.commit()?;
            return Ok(task);
        }
        if draft.draft_kind != "create" {
            return Err(AppError::Domain("未知任务草稿类型".into()));
        }
        let historical = validate_new_task_history(
            input.earliest_start_date.as_deref(), input.due_date.as_deref())?;

        let task_id = Uuid::new_v4().to_string();
        let current_drafts = current_plan_draft_dates(&transaction)?;
        let status = TaskStatus::Open;
        let earliest_start_at = legacy_timestamp(
            input.earliest_start_date.as_deref(),
            input.earliest_start_time.as_deref(),
        );
        let due_at = legacy_timestamp(input.due_date.as_deref(), input.due_time.as_deref());
        let timestamp = now();
        transaction.execute(
            "INSERT INTO tasks (
                id, title, notes, priority, earliest_start_at, due_at, estimated_minutes,
                earliest_start_date, earliest_start_time, due_date, due_time,
                total_workload_minutes, remaining_workload_minutes, actual_minutes,
                source_type, migration_review_required, splittable, status, created_at, updated_at
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                ?12, ?13, 0, ?14, 0, ?15, ?16, ?17, ?17
             )",
            params![
                task_id,
                input.title.trim(),
                input.notes,
                input.priority.map(Priority::as_str),
                earliest_start_at,
                due_at,
                input.total_workload_minutes,
                input.earliest_start_date,
                input.earliest_start_time,
                input.due_date,
                input.due_time,
                input.total_workload_minutes,
                input.remaining_workload_minutes.or(input.total_workload_minutes),
                draft.source_type,
                1,
                status.as_str(),
                timestamp,
            ],
        )?;
        let change_source = if draft.source_type == TaskSource::AiAssistant.as_str() { "ai" } else { "manual" };
        record_task_change(
            &transaction,
            &task_id,
            "created_from_draft",
            None,
            Some(status.as_str()),
            change_source,
            Some(&format!("task_draft:{draft_id}")),
        )?;
        record_initial_estimates(
            &transaction,
            &task_id,
            input.total_workload_minutes,
            input.remaining_workload_minutes.or(input.total_workload_minutes),
            draft.source_type.as_str(),
        )?;
        apply_task_tags_with_previous(&transaction, &task_id, &input.tags, &draft.tags)?;
        transaction.execute(
            "UPDATE task_drafts
             SET status = 'confirmed', confirmed_task_id = ?2, confirmed_at = ?3, updated_at = ?3
             WHERE id = ?1 AND status = 'active'",
            params![draft_id, task_id, timestamp],
        )?;
        if historical {
            database_execution::complete_historical_creation(&transaction, &task_id)?;
        } else {
            sync_single_day_task_schedule(&transaction, &task_id, None, &current_drafts)?;
            schedule_new_cross_day_task(&transaction, &task_id, &current_drafts)?;
        }
        let task = load_task_dto_in_transaction(&transaction, &task_id)?;
        if !historical {
            record_undo_entry(
                &transaction, "task_created", "task", &task_id,
                &task_schedule_undo_json(&transaction, &task_id, None, Vec::new())?, Some(&task.updated_at),
            )?;
        }
        transaction.commit()?;
        Ok(task)
    }

    pub fn confirm_creation_draft(&mut self, draft_id: &str, confirmation_token: &str) -> AppResult<ConfirmedCreation> {
        let transaction = self.connection.transaction()?;
        let draft = load_task_draft_in_transaction(&transaction, draft_id)?;
        if draft.confirmation_token != confirmation_token { return Err(AppError::InvalidConfirmation); }
        if draft.item_type == "task" {
            transaction.commit()?;
            return self.confirm_task_draft(draft_id, confirmation_token).map(ConfirmedCreation::Task);
        }
        if draft.draft_kind != "create" { return Err(AppError::Domain("修改已有任务的草稿不能创建重复事项".into())); }
        if draft.status == "confirmed" {
            let id = draft.confirmed_recurring_item_id.ok_or(AppError::InvalidConfirmation)?;
            let item = load_recurring_item_in_transaction(&transaction, &id)?;
            transaction.commit()?;
            return Ok(ConfirmedCreation::Recurring(item));
        }
        if draft.status != "active" { return Err(AppError::Domain("已放弃的草稿不能确认".into())); }
        let input = normalize_recurring_item_input(recurring_input_for_draft(&draft.title, &draft.notes, &draft.tags, draft.recurring_settings.as_ref())?)?;
        let item = insert_recurring_item(&transaction, &input, &draft.source_type)?;
        transaction.execute(
            "UPDATE task_drafts SET status = 'confirmed', confirmed_recurring_item_id = ?2, confirmed_at = ?3, updated_at = ?3 WHERE id = ?1 AND status = 'active'",
            params![draft_id, item.id, now()],
        )?;
        transaction.commit()?;
        Ok(ConfirmedCreation::Recurring(item))
    }

    pub fn discard_task_draft(&mut self, draft_id: &str, expected_version: i64) -> AppResult<()> {
        let transaction = self.connection.transaction()?;
        let changed = transaction.execute(
            "UPDATE task_drafts
             SET status = 'discarded', version = version + 1, updated_at = ?3
             WHERE id = ?1 AND version = ?2 AND status = 'active'",
            params![draft_id, expected_version, now()],
        )?;
        if changed != 1 {
            return Err(AppError::Domain("草稿已被更新、确认或放弃，请刷新后重试".into()));
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn list_tasks(&self, include_deleted: bool, search: Option<&str>) -> AppResult<Vec<TaskDto>> {
        let search_pattern = search
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| format!("%{value}%"));
        let mut statement = self.connection.prepare(
            "SELECT task.id, task.title, task.notes, task.priority, task.earliest_start_at, task.due_at, task.estimated_minutes,
                    earliest_start_date, earliest_start_time, due_date, due_time,
                    total_workload_minutes, remaining_workload_minutes, actual_minutes,
                    source_type, migration_review_required,
                    splittable, status, deleted_at, created_at, task.updated_at,
                    COALESCE((
                        SELECT SUM(CAST(ROUND((julianday(pb.ends_at) - julianday(pb.starts_at)) * 1440) AS INTEGER))
                        FROM plan_blocks pb
                        JOIN daily_plans dp ON dp.id = pb.daily_plan_id
                        WHERE pb.task_id = task.id
                          AND dp.status = 'confirmed'
                          AND NOT EXISTS (SELECT 1 FROM review_entries review WHERE review.plan_block_id = pb.id)
                    ), 0),
                    COALESCE((
                        SELECT json_group_array(scheduled_date) FROM (
                            SELECT DISTINCT substr(pb.starts_at, 1, 10) AS scheduled_date
                            FROM plan_blocks pb
                            JOIN daily_plans dp ON dp.id = pb.daily_plan_id
                            WHERE pb.task_id = task.id AND dp.status = 'confirmed'
                            ORDER BY scheduled_date
                        )
                    ), '[]'),
                    COALESCE((
                        SELECT json_group_array(name) FROM (
                            SELECT tag.name AS name FROM tags tag
                            JOIN task_tags relation ON relation.tag_id = tag.id
                            WHERE relation.task_id = task.id ORDER BY tag.name COLLATE NOCASE
                        )
                    ), '[]'),
                        COALESCE(substr(task.earliest_start_at, 1, 10) = substr(task.due_at, 1, 10), 0)
                        AND ((task.actual_minutes > 0 AND NOT EXISTS(SELECT 1 FROM review_entries permission
                            WHERE permission.task_id = task.id AND permission.followup_action IN ('schedule','wait','stop'))) OR EXISTS(
                            SELECT 1 FROM plan_blocks fact WHERE fact.task_id = task.id
                            AND NOT EXISTS(SELECT 1 FROM review_entries resolved WHERE resolved.plan_block_id = fact.id
                                AND resolved.followup_action IN ('schedule','wait','stop'))
                            AND (fact.execution_status <> 'planned' OR fact.execution_captured_at IS NOT NULL
                                OR COALESCE(fact.actual_minutes, 0) > 0
                                OR EXISTS(SELECT 1 FROM review_entries review WHERE review.plan_block_id = fact.id))
                        ))
                        , task.result_date, task.result_ends_at
                        , task.status IN ('open', 'scheduled') AND task.deleted_at IS NULL AND COALESCE((
                            SELECT COALESCE(review.outcome, fact.execution_status) IN ('not_started', 'partial', 'blocked', 'cancelled')
                                AND NOT EXISTS (
                                    SELECT 1 FROM plan_blocks pending JOIN daily_plans future ON future.id = pending.daily_plan_id
                                    WHERE pending.task_id = task.id AND future.status = 'confirmed' AND future.plan_date >= ?3
                                        AND pending.starts_at > fact.starts_at AND pending.execution_status = 'planned'
                                        AND pending.execution_captured_at IS NULL AND COALESCE(pending.actual_minutes, 0) = 0
                                        AND NOT EXISTS (SELECT 1 FROM review_entries resolved WHERE resolved.plan_block_id = pending.id)
                                )
                            FROM plan_blocks fact JOIN daily_plans recorded ON recorded.id = fact.daily_plan_id
                            LEFT JOIN review_entries review ON review.plan_block_id = fact.id
                            WHERE fact.task_id = task.id AND recorded.status = 'confirmed'
                                AND COALESCE(review.outcome, fact.execution_status) <> 'planned'
                            ORDER BY fact.starts_at DESC, fact.id LIMIT 1
                        ), 0)
             FROM tasks task
             WHERE (?1 = 1 OR status <> 'deleted')
               AND (?2 IS NULL OR title LIKE ?2 COLLATE NOCASE OR COALESCE(notes, '') LIKE ?2 COLLATE NOCASE
                    OR EXISTS(SELECT 1 FROM task_tags relation JOIN tags tag ON tag.id = relation.tag_id
                              WHERE relation.task_id = task.id AND tag.name LIKE ?2 COLLATE NOCASE))
             ORDER BY CASE status
                        WHEN 'scheduled' THEN 0 WHEN 'open' THEN 1
                        WHEN 'done' THEN 2 ELSE 3 END,
                      updated_at DESC",
        )?;
        let rows = statement.query_map(params![include_deleted as i64, search_pattern, shanghai_today()], task_dto_from_row)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
    }

    pub fn create_recurring_item(&mut self, input: RecurringItemInput) -> AppResult<RecurringItemDto> {
        let input = normalize_recurring_item_input(input)?;
        let transaction = self.connection.transaction()?;
        database_tags::validate_selection(&input.tags, &[])?;
        let item = insert_recurring_item(&transaction, &input, TaskSource::Manual.as_str())?;
        transaction.commit()?;
        Ok(item)
    }

    pub fn list_recurring_items(
        &self,
        include_ended: bool,
        include_deleted: bool,
    ) -> AppResult<Vec<RecurringItemDto>> {
        let mut statement = self.connection.prepare(
            "SELECT id, title, notes, frequency, interval_value, weekdays_json, month_day,
                    starts_on, ends_on, display_time, display_duration_minutes, tags_json, status, created_at, updated_at, deleted_at, source_type
             FROM recurring_items
             WHERE (?1 = 1 OR status <> 'ended')
               AND (?2 = 1 OR deleted_at IS NULL)
             ORDER BY deleted_at IS NOT NULL,
                      CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
                      updated_at DESC",
        )?;
        let rows = statement.query_map(
            params![include_ended as i64, include_deleted as i64],
            recurring_item_dto_from_row,
        )?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
    }

    pub fn update_recurring_item(&mut self, item_id: &str, input: RecurringItemInput) -> AppResult<RecurringItemDto> {
        self.update_recurring_item_versioned(item_id, input)
    }

    pub fn set_recurring_item_status(&mut self, item_id: &str, status: &str) -> AppResult<RecurringItemDto> {
        if !matches!(status, "active" | "paused" | "ended") {
            return Err(AppError::Schema("重复事项状态必须为 active、paused 或 ended".into()));
        }
        let transaction = self.connection.transaction()?;
        let current = load_recurring_item_in_transaction(&transaction, item_id)?;
        if current.deleted_at.is_some() {
            return Err(AppError::Domain("回收站中的重复事项不能改变状态".into()));
        }
        if current.status == "ended" {
            return Err(AppError::Domain("已结束的重复事项只能移入回收站".into()));
        }
        transaction.execute(
            "UPDATE recurring_items SET status = ?2, updated_at = ?3 WHERE id = ?1",
            params![item_id, status, now()],
        )?;
        database_recurring::record_status(&transaction, item_id, status)?;
        let item = load_recurring_item_in_transaction(&transaction, item_id)?;
        transaction.commit()?;
        Ok(item)
    }

    pub fn soft_delete_recurring_item(&mut self, item_id: &str, confirmed: bool) -> AppResult<()> {
        if !confirmed { return Err(AppError::Domain("移入回收站需要明确确认".into())); }
        let transaction = self.connection.transaction()?;
        let item = load_recurring_item_in_transaction(&transaction, item_id)?;
        if item.deleted_at.is_some() {
            return Err(AppError::Domain("重复事项已在回收站中".into()));
        }
        if !matches!(item.status.as_str(), "paused" | "ended") {
            return Err(AppError::Domain("请先暂停重复事项，再移入回收站".into()));
        }
        if item.status != "ended" {
            database_recurring::record_status(&transaction, item_id, "ended")?;
        }
        let timestamp = now();
        transaction.execute(
            "UPDATE recurring_items SET status = 'ended', deleted_at = ?2, updated_at = ?2 WHERE id = ?1",
            params![item_id, timestamp],
        )?;
        database_recurring_execution::record_lifecycle(&transaction, &item, "soft_deleted", &timestamp)?;
        transaction.commit()?;
        Ok(())
    }

    pub fn restore_recurring_item(&mut self, item_id: &str) -> AppResult<()> {
        let transaction = self.connection.transaction()?;
        let item = load_recurring_item_in_transaction(&transaction, item_id)?;
        if item.deleted_at.is_none() {
            return Err(AppError::Domain("只有回收站中的重复事项可以恢复".into()));
        }
        let timestamp = now();
        transaction.execute(
            "UPDATE recurring_items SET deleted_at = NULL, updated_at = ?2 WHERE id = ?1",
            params![item_id, timestamp],
        )?;
        database_recurring_execution::record_lifecycle(&transaction, &item, "restored", &timestamp)?;
        transaction.commit()?;
        Ok(())
    }

    pub fn permanently_delete_recurring_item(&mut self, item_id: &str, confirmed: bool) -> AppResult<()> {
        if !confirmed { return Err(AppError::Domain("永久删除需要明确确认".into())); }
        let transaction = self.connection.transaction()?;
        let deleted: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM recurring_items WHERE id = ?1 AND deleted_at IS NOT NULL)",
            [item_id],
            |row| row.get(0),
        )?;
        if !deleted { return Err(AppError::Domain("永久删除只能在回收站中执行".into())); }
        transaction.execute("DELETE FROM recurring_items WHERE id = ?1", [item_id])?;
        transaction.commit()?;
        Ok(())
    }

    pub fn list_recurring_occurrences(&mut self, occurrence_date: &str) -> AppResult<Vec<RecurringOccurrenceDto>> {
        self.list_recurring_occurrences_range(occurrence_date, occurrence_date)
    }

    pub fn save_recurring_occurrence_review(
        &mut self,
        occurrence_id: &str,
        input: RecurringOccurrenceReviewInput,
    ) -> AppResult<RecurringOccurrenceDto> {
        if let Some(outcome) = input.outcome.as_deref() {
            if !matches!(outcome, "completed" | "partial" | "not_completed") {
                return Err(AppError::Schema("重复事项结果必须为完成、部分完成或未完成".into()));
            }
        }
        let notes = normalize_review_text(input.notes, 2000, "复盘备注")?;
        let transaction = self.connection.transaction()?;
        let occurrence_date: String = transaction.query_row(
            "SELECT occurrence_date FROM recurring_occurrences WHERE id = ?1", [occurrence_id], |row| row.get(0),
        ).optional()?.ok_or_else(|| AppError::NotFound(format!("重复事项发生记录 {occurrence_id}")))?;
        validate_review_target(&transaction, &occurrence_date, "recurring", occurrence_id)?;
        let before = load_occurrence(&transaction, occurrence_id)?;
        // A note-only save keeps the current outcome and appends a neutral execution record.
        let target_outcome = input.outcome.clone().or_else(|| before.outcome.clone());
        if before.outcome == target_outcome && before.review_notes == notes {
            clear_review_draft(&transaction, &occurrence_date, "recurring", occurrence_id)?;
            transaction.commit()?;
            return Ok(before);
        }
        let timestamp = now();
        transaction.execute(
            "UPDATE recurring_occurrences
             SET outcome = ?2, review_notes = ?3, reviewed_at = ?4, updated_at = ?4, is_exception = 1
             WHERE id = ?1",
            params![occurrence_id, target_outcome, notes, timestamp],
        )?;
        database_recurring_execution::record(&transaction, occurrence_id, &timestamp)?;
        let occurrence = load_occurrence(&transaction, occurrence_id)?;
        clear_review_draft(&transaction, &occurrence_date, "recurring", occurrence_id)?;
        let payload = FactUndo { task: None, block: None, occurrence: Some(before), review: None,
            after_facts: fact_fingerprint(&transaction, "recurring_review", occurrence_id)? };
        record_undo_entry(&transaction, "recurring_review_saved", "recurring_review", occurrence_id, &serde_json::to_string(&payload)?, None)?;
        transaction.commit()?;
        Ok(occurrence)
    }

    pub fn get_task(&self, task_id: &str) -> AppResult<TaskDto> {
        load_task_dto_in_transaction(&self.connection, task_id)
    }

    pub fn get_task_metadata(&self, task_id: &str) -> AppResult<TaskMetadataDto> {
        let task = self.get_task(task_id)?;
        let mut statement = self.connection.prepare(
            "SELECT tag.name FROM tags tag
             JOIN task_tags relation ON relation.tag_id = tag.id
             WHERE relation.task_id = ?1 ORDER BY tag.name COLLATE NOCASE",
        )?;
        let tags = statement.query_map([task_id], |row| row.get(0))?
            .collect::<Result<Vec<String>, _>>()?;
        let recurrence = self.connection.query_row(
            "SELECT rule.frequency, rule.interval_value, rule.weekdays_json, rule.month_day,
                    rule.starts_on, rule.ends_on
             FROM recurrence_instances instance
             JOIN recurrence_rules rule ON rule.id = instance.recurrence_rule_id
             WHERE instance.task_id = ?1",
            [task_id],
            |row| {
                let weekdays_json: Option<String> = row.get(2)?;
                let weekdays = weekdays_json
                    .map(|value| serde_json::from_str(&value))
                    .transpose()
                    .map_err(|error| rusqlite::Error::FromSqlConversionFailure(2, rusqlite::types::Type::Text, Box::new(error)))?
                    .unwrap_or_default();
                Ok(RecurrenceInput {
                    frequency: row.get(0)?, interval_value: row.get(1)?, weekdays,
                    month_day: row.get(3)?, starts_on: row.get(4)?, ends_on: row.get(5)?,
                })
            },
        ).optional()?;
        let (completion_date, completion_ends_at) = database_results::candidate_context(&self.connection, task_id)?;
        let completion_backfill_allowed = database_results::can_backfill_completion(&self.connection, &task)?;
        let completion_recorded_at = database_results::historical_completion_recorded_at(&self.connection, task_id)?;
        database_followup::enrich_metadata(&self.connection, TaskMetadataDto { task_id: task_id.to_string(), tags, recurrence,
            latest_execution: None, completion_date, completion_ends_at, completion_backfill_allowed, completion_recorded_at,
            history: database_history::load(&self.connection, task_id)? })
    }

    pub fn set_task_tags(&mut self, task_id: &str, tags: Vec<String>) -> AppResult<TaskMetadataDto> {
        let transaction = self.connection.transaction()?;
        ensure_task_content_editable(&load_task_dto_in_transaction(&transaction, task_id)?)?;
        apply_task_tags(&transaction, task_id, &tags)?;
        record_task_change(
            &transaction, task_id, "tags_updated", None,
            Some(&serde_json::to_string(&normalize_tags(&tags)?)?), "manual", None,
        )?;
        transaction.commit()?;
        self.get_task_metadata(task_id)
    }

    pub fn update_recurring_task(
        &mut self,
        task_id: &str,
        input: TaskDraftInput,
        scope: &str,
    ) -> AppResult<TaskDto> {
        if !matches!(scope, "this" | "future") {
            return Err(AppError::Schema("重复任务修改范围必须为 this 或 future".into()));
        }
        validate_task_draft_input(&input, true)?;
        let transaction = self.connection.transaction()?;
        let before = load_task_dto_in_transaction(&transaction, task_id)?;
        ensure_task_content_editable(&before)?;
        let current_recurrence: Option<(String, String)> = transaction.query_row(
            "SELECT recurrence_rule_id, occurrence_date FROM recurrence_instances WHERE task_id = ?1",
            [task_id], |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional()?;
        if current_recurrence.is_none() {
            return Err(AppError::Domain("该任务不是重复任务实例".into()));
        }
        let (rule_id, occurrence_date) = current_recurrence.unwrap();
        let timestamp = now();
        update_task_from_draft_input(&transaction, task_id, &input, &timestamp)?;
        apply_task_tags(&transaction, task_id, &input.tags)?;

        if scope == "future" {
            if input.recurrence.as_ref().is_some_and(|recurrence| recurrence.starts_on != occurrence_date) {
                return Err(AppError::Domain("后继重复规则必须从当前实例日期开始".into()));
            }
            let future_tasks = {
                let mut statement = transaction.prepare(
                    "SELECT instance.task_id FROM recurrence_instances instance
                     JOIN tasks task ON task.id = instance.task_id
                     WHERE instance.recurrence_rule_id = ?1 AND instance.occurrence_date > ?2
                     ORDER BY instance.occurrence_date",
                )?;
                let tasks = statement.query_map(params![rule_id, occurrence_date], |row| row.get::<_, String>(0))?
                    .collect::<Result<Vec<_>, _>>()?;
                tasks
            };
            for future_task_id in &future_tasks {
                ensure_task_content_editable(&load_task_dto_in_transaction(&transaction, future_task_id)?)?;
                let locked: bool = transaction.query_row(
                    "SELECT EXISTS(
                        SELECT 1 FROM plan_blocks block
                        LEFT JOIN review_entries review ON review.plan_block_id = block.id
                        WHERE block.task_id = ?1 AND (block.execution_status <> 'planned' OR review.id IS NOT NULL)
                    )",
                    [future_task_id], |row| row.get(0),
                )?;
                if locked {
                    return Err(AppError::Domain("未来实例已有执行或复盘，不能批量覆盖".into()));
                }
                let has_plan: bool = transaction.query_row(
                    "SELECT EXISTS(SELECT 1 FROM plan_blocks WHERE task_id = ?1)",
                    [future_task_id], |row| row.get(0),
                )?;
                if has_plan {
                    return Err(AppError::Domain("未来实例已进入日计划，请先调整对应计划".into()));
                }
            }
            transaction.execute(
                "UPDATE recurrence_rules SET status = 'superseded', updated_at = ?2 WHERE id = ?1 AND status = 'active'",
                params![rule_id, timestamp],
            )?;
            transaction.execute("DELETE FROM recurrence_instances WHERE task_id = ?1", [task_id])?;
            for future_task_id in &future_tasks {
                soft_delete_task(&transaction, future_task_id, "recurrence_superseded")?;
            }
            if let Some(recurrence) = &input.recurrence {
                create_recurrence_series_with_parent(&transaction, task_id, recurrence, Some(&rule_id), &self.holiday_calendar.snapshot)?;
            }
        }
        let updated = load_task_dto_in_transaction(&transaction, task_id)?;
        record_task_change(
            &transaction, task_id,
            if scope == "future" { "recurrence_future_updated" } else { "recurrence_instance_updated" },
            Some(&before.updated_at), Some(&updated.updated_at), "manual", Some(scope),
        )?;
        transaction.commit()?;
        self.get_task(task_id)
    }

    pub fn list_tags(&self) -> AppResult<Vec<String>> {
        let mut statement = self.connection.prepare("SELECT name FROM tags ORDER BY name COLLATE NOCASE")?;
        let tags = statement.query_map([], |row| row.get(0))?
            .collect::<Result<Vec<String>, _>>()?;
        Ok(tags)
    }

    pub fn latest_undo(&self) -> AppResult<Option<UndoEntryDto>> {
        let timestamp = now();
        self.connection.query_row(
            "SELECT id, action_kind, target_type, target_id, expires_at, status
             FROM undo_entries
             WHERE status = 'available' AND expires_at >= ?1
             ORDER BY created_at DESC LIMIT 1",
            [timestamp],
            undo_entry_from_row,
        ).optional().map_err(AppError::from)
    }

    pub fn apply_undo(&mut self, undo_id: &str) -> AppResult<UndoEntryDto> {
        let transaction = self.connection.transaction()?;
        let (action_kind, target_type, target_id, before_json, expected_updated_at, expires_at, status):
            (String, String, String, String, Option<String>, String, String) = transaction.query_row(
                "SELECT action_kind, target_type, target_id, before_json, expected_updated_at, expires_at, status
                 FROM undo_entries WHERE id = ?1",
                [undo_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?)),
            ).optional()?.ok_or_else(|| AppError::NotFound(format!("撤销记录 {undo_id}")))?;
        if status != "available" { return Err(AppError::Domain("这项操作已经撤销或失效".into())); }
        if expires_at < now() { return Err(AppError::Domain("撤销时间已超过 10 秒".into())); }
        if matches!(target_type.as_str(), "task_completion" | "execution_capture") {
            let payload: FactUndo = serde_json::from_str(&before_json)?;
            if target_type == "task_completion" {
                database_results::require_task_reopenable(&transaction, &target_id)?;
            } else if let Some(block) = payload.block {
                database_results::require_block_window(&transaction, &block.id)?;
                database_results::require_block_outcome_change(&transaction, &block.id, &block.execution_status)?;
            }
        }
        match target_type.as_str() {
            "task_completion" | "execution_capture" | "recurring_review" => {
                let payload: FactUndo = serde_json::from_str(&before_json)?;
                if !database_results::facts_match(&fact_fingerprint(&transaction, &target_type, &target_id)?, &payload.after_facts) {
                    return Err(AppError::Domain("目标已有后续修改、执行、复盘或删除，无法安全撤销".into()));
                }
                if matches!(target_type.as_str(), "task_completion" | "execution_capture") {
                    // Archive only after the fingerprint check, before undo overwrites the result.
                    database_history::preserve_current(&transaction, &target_id)?;
                }
                if let Some(task) = payload.task {
                    let current = load_task_dto_in_transaction(&transaction, &task.id)?;
                    transaction.execute("UPDATE tasks SET status = ?2, remaining_workload_minutes = ?3, updated_at = ?4 WHERE id = ?1",
                        params![task.id, task.status, task.remaining_workload_minutes, now()])?;
                    if current.remaining_workload_minutes != task.remaining_workload_minutes {
                        transaction.execute("INSERT INTO task_estimates (id, task_id, estimate_kind, old_minutes, new_minutes, source, reason, created_at)
                            VALUES (?1, ?2, 'remaining', ?3, ?4, 'manual', '撤销整项完成', ?5)",
                            params![Uuid::new_v4().to_string(), task.id, current.remaining_workload_minutes, task.remaining_workload_minutes, now()])?;
                    }
                    record_task_change(&transaction, &task.id, "undo_task_completed", Some(&current.status), Some(&task.status), "undo", Some(undo_id))?;
                }
                if let Some(block) = payload.block {
                    let cancelled_completion = execution_snapshot(&transaction, &block.id)?.execution_status == "completed";
                    transaction.execute("UPDATE plan_blocks SET execution_status = ?2, actual_minutes = ?3, review_required = ?4,
                        execution_note = ?5, execution_captured_at = ?6, updated_at = ?7 WHERE id = ?1",
                        params![block.id, block.execution_status, block.actual_minutes, block.review_required,
                            block.execution_note, block.execution_captured_at, now()])?;
                    if target_type == "execution_capture" {
                        let (_, date, _) = database_results::block_context(&transaction, &block.id)?;
                        database_history::record_cleared(&transaction, &target_id, &date, cancelled_completion)?;
                    }
                }
                if let Some(review) = payload.review {
                    transaction.execute("UPDATE review_entries SET outcome = ?2, notes = ?3 WHERE id = ?1",
                        params![review.id, review.outcome, review.notes])?;
                }
                if let Some(occurrence) = payload.occurrence {
                    if occurrence.occurrence_date != shanghai_today() {
                        return Err(AppError::Domain("只能撤销今天的重复事项结果；过去记录只读".into()));
                    }
                    validate_review_target(&transaction, &occurrence.occurrence_date, "recurring", &occurrence.id)?;
                    transaction.execute("UPDATE recurring_occurrences SET outcome = ?2, review_notes = ?3, reviewed_at = ?4, updated_at = ?5 WHERE id = ?1",
                        params![occurrence.id, occurrence.outcome, occurrence.review_notes, occurrence.reviewed_at, now()])?;
                    database_recurring_execution::record(&transaction, &occurrence.id, &now())?;
                    clear_review_draft(&transaction, &occurrence.occurrence_date, "recurring", &occurrence.id)?;
                }
                if target_type == "execution_capture" {
                    let payload: FactUndo = serde_json::from_str(&before_json)?;
                    if let Some(block) = payload.block {
                        database_execution::sync_block_result(&transaction, &block.id)?;
                    }
                }
            }
            "task" => {
                let current_updated_at: String = transaction.query_row(
                    "SELECT updated_at FROM tasks WHERE id = ?1", [&target_id], |row| row.get(0),
                ).optional()?.ok_or_else(|| AppError::Domain("目标任务已不存在，无法安全撤销".into()))?;
                if expected_updated_at.as_deref() != Some(current_updated_at.as_str()) {
                    return Err(AppError::Domain("目标任务已发生后续修改，已拒绝不安全撤销".into()));
                }
                let schedule_undo = serde_json::from_str::<TaskScheduleUndo>(&before_json).ok();
                if load_task_dto_in_transaction(&transaction, &target_id)?.execution_locked {
                    return Err(AppError::Domain("该单日任务已有执行或复盘记录，无法撤销内容或安排".into()));
                }
                let current_drafts = current_plan_draft_dates(&transaction)?;
                if let Some(payload) = &schedule_undo {
                    if load_task_schedule_blocks(&transaction, &target_id)? != payload.after_blocks {
                        return Err(AppError::Domain("任务安排已有执行、复盘或后续修改，无法撤销".into()));
                    }
                }
                match action_kind.as_str() {
                    "task_created" => soft_delete_task(&transaction, &target_id, "undo")?,
                    "task_updated" => {
                        let before: TaskDto = if let Some(payload) = &schedule_undo {
                            payload.task.clone().ok_or_else(|| AppError::Domain("任务撤销快照不完整".into()))?
                        } else { serde_json::from_str(&before_json)? };
                        let restored_at = now();
                        transaction.execute(
                            "UPDATE tasks SET title = ?2, notes = ?3, priority = ?4,
                                earliest_start_at = ?5, due_at = ?6, estimated_minutes = ?7,
                                earliest_start_date = ?8, earliest_start_time = ?9,
                                due_date = ?10, due_time = ?11, total_workload_minutes = ?12,
                                remaining_workload_minutes = ?13, migration_review_required = ?14,
                                updated_at = ?15, status = ?16 WHERE id = ?1",
                            params![
                                target_id, before.title, before.notes, before.priority,
                                before.earliest_start_at, before.due_at, before.estimated_minutes,
                                before.earliest_start_date, before.earliest_start_time,
                                before.due_date, before.due_time, before.total_workload_minutes,
                                before.remaining_workload_minutes, before.migration_review_required as i64,
                                restored_at, before.status,
                            ],
                        )?;
                        apply_task_tags_with_previous(&transaction, &target_id, &before.tags, &before.tags)?;
                        record_task_change(
                            &transaction, &target_id, "undo_task_updated", Some(&current_updated_at),
                            Some(&restored_at), "undo", Some(undo_id),
                        )?;
                    }
                    _ => return Err(AppError::Domain("未知任务撤销操作".into())),
                }
                if let Some(payload) = schedule_undo {
                    for block in &payload.after_blocks {
                        transaction.execute("DELETE FROM plan_blocks WHERE id = ?1", [&block.block.id])?;
                    }
                    for snapshot in payload.before_blocks {
                        let block = snapshot.block;
                        transaction.execute(
                            "INSERT INTO plan_blocks (id, daily_plan_id, task_id, starts_at, ends_at, source, review_required, created_at, updated_at)
                             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?8)",
                            params![block.id, snapshot.plan_id, target_id, block.starts_at, block.ends_at,
                                block.source, block.created_at, block.updated_at],
                        )?;
                    }
                    refresh_task_in_plan_drafts(&transaction, &target_id, &current_drafts)?;
                }
            }
            "daily_plan" => {
                if !matches!(action_kind.as_str(), "plan_created" | "plan_updated") {
                    return Err(AppError::Domain("未知计划撤销操作".into()));
                }
                let payload: PlanUndoPayload = serde_json::from_str(&before_json)?;
                let plan_exists: bool = transaction.query_row(
                    "SELECT EXISTS(SELECT 1 FROM daily_plans WHERE id = ?1 AND plan_date = ?2 AND status = 'confirmed')",
                    params![target_id, payload.plan_date], |row| row.get(0),
                )?;
                if !plan_exists {
                    return Err(AppError::Domain("目标计划已变化，无法安全撤销".into()));
                }
                let current_blocks = load_replaceable_plan_blocks(&transaction, &target_id)?;
                let task_ids = payload.after_tasks.iter().map(|task| task.id.clone()).collect::<Vec<_>>();
                let current_tasks = load_plan_task_states(&transaction, &task_ids)?;
                if current_blocks != payload.after_blocks || current_tasks != payload.after_tasks {
                    return Err(AppError::Domain("计划已有执行、复盘或后续修改，已拒绝不安全撤销".into()));
                }
                for snapshot in &payload.single_day_schedule_undo {
                    let task_id = &snapshot.task.as_ref().ok_or_else(|| AppError::Domain("计划撤销快照不完整".into()))?.id;
                    if load_task_dto_in_transaction(&transaction, task_id)?.execution_locked
                        || load_task_schedule_blocks(&transaction, task_id)? != snapshot.after_blocks
                    {
                        return Err(AppError::Domain("任务安排已有执行、复盘或后续修改，无法安全撤销".into()));
                    }
                }
                for block in &payload.after_blocks {
                    transaction.execute("DELETE FROM plan_blocks WHERE id = ?1", [&block.id])?;
                }
                if payload.created_new_plan {
                    transaction.execute("DELETE FROM daily_plans WHERE id = ?1", [&target_id])?;
                } else {
                    for block in &payload.before_blocks {
                        transaction.execute(
                            "INSERT INTO plan_blocks
                                (id, daily_plan_id, task_id, starts_at, ends_at, source,
                                 execution_status, review_required, created_at, updated_at)
                             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'planned', 1, ?7, ?8)",
                            params![block.id, target_id, block.task_id, block.starts_at, block.ends_at,
                                block.source, block.created_at, block.updated_at],
                        )?;
                    }
                }
                for snapshot in &payload.single_day_schedule_undo {
                    for old in snapshot.before_blocks.iter().filter(|old| old.plan_id != target_id) {
                        let block = &old.block;
                        transaction.execute(
                            "INSERT INTO plan_blocks (id, daily_plan_id, task_id, starts_at, ends_at, source, review_required, created_at, updated_at)
                             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?8)",
                            params![block.id, old.plan_id, block.task_id, block.starts_at, block.ends_at,
                                block.source, block.created_at, block.updated_at],
                        )?;
                    }
                }
                let restored_at = now();
                for task in &payload.before_tasks {
                    let current = payload.after_tasks.iter().find(|item| item.id == task.id)
                        .ok_or_else(|| AppError::Domain("计划撤销快照不完整".into()))?;
                    if current.status != task.status {
                        transaction.execute(
                            "UPDATE tasks SET status = ?2, updated_at = ?3 WHERE id = ?1",
                            params![task.id, task.status, restored_at],
                        )?;
                        record_task_change(
                            &transaction, &task.id, "undo_plan_status", Some(&current.status),
                            Some(&task.status), "undo", Some(undo_id),
                        )?;
                    }
                }
                for task in &payload.before_single_day_tasks {
                    restore_single_day_task_time_snapshot(&transaction, task)?;
                }
            }
            _ => return Err(AppError::Domain("当前版本不支持撤销这类操作".into())),
        }
        transaction.execute(
            "UPDATE undo_entries SET status = 'applied', applied_at = ?2 WHERE id = ?1",
            params![undo_id, now()],
        )?;
        let result = transaction.query_row(
            "SELECT id, action_kind, target_type, target_id, expires_at, status
             FROM undo_entries WHERE id = ?1", [undo_id], undo_entry_from_row,
        )?;
        transaction.commit()?;
        Ok(result)
    }

    pub fn get_ui_setting(&self, key: &str) -> AppResult<Option<String>> {
        if !key.starts_with("ui.") {
            return Err(AppError::Domain("只允许读取界面设置".into()));
        }
        self.connection
            .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| row.get(0))
            .optional()
            .map_err(AppError::from)
    }

    pub fn set_ui_setting(&mut self, key: &str, value: &str) -> AppResult<()> {
        if !key.starts_with("ui.") {
            return Err(AppError::Domain("只允许写入界面设置".into()));
        }
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![key, value, now()],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn claim_due_task_block_notifications(&mut self, lead_minutes: i64) -> AppResult<Vec<TaskBlockNotificationDto>> {
        self.claim_due_task_block_notifications_at(lead_minutes, &now())
    }

    fn claim_due_task_block_notifications_at(
        &mut self,
        lead_minutes: i64,
        current_time: &str,
    ) -> AppResult<Vec<TaskBlockNotificationDto>> {
        let lead_minutes = lead_minutes.clamp(0, 60);
        if lead_minutes == 0 { return Ok(Vec::new()); }
        let current = DateTime::parse_from_rfc3339(current_time)
            .map_err(|_| AppError::Schema("提醒基准时间无效".into()))?;
        let cutoff = (current + Duration::minutes(lead_minutes)).to_rfc3339();
        let transaction = self.connection.transaction()?;
        let candidates = {
            let mut statement = transaction.prepare(
                "SELECT block.id, task.id, task.title, task.notes, task.priority,
                        (SELECT group_concat(name, ' · ') FROM (SELECT tag.name AS name FROM task_tags relation JOIN tags tag ON tag.id = relation.tag_id WHERE relation.task_id = task.id ORDER BY tag.name)),
                        block.starts_at, block.ends_at, block.starts_at, 0, plan.plan_date, (SELECT revision FROM task_block_reminder_revisions WHERE block_id = block.id)
                 FROM plan_blocks block JOIN daily_plans plan ON plan.id = block.daily_plan_id JOIN tasks task ON task.id = block.task_id
                 WHERE plan.status = 'confirmed' AND block.execution_status = 'planned' AND task.status NOT IN ('done','deleted')
                   AND julianday(block.starts_at) > julianday(?1) AND julianday(block.starts_at) <= julianday(?2)
                 UNION ALL
                 SELECT block.id, task.id, task.title, task.notes, task.priority,
                        (SELECT group_concat(name, ' · ') FROM (SELECT tag.name AS name FROM task_tags relation JOIN tags tag ON tag.id = relation.tag_id WHERE relation.task_id = task.id ORDER BY tag.name)),
                        block.starts_at, block.ends_at, block.ends_at, 1, plan.plan_date, (SELECT revision FROM task_block_reminder_revisions WHERE block_id = block.id)
                 FROM plan_blocks block JOIN daily_plans plan ON plan.id = block.daily_plan_id JOIN tasks task ON task.id = block.task_id
                 WHERE plan.status = 'confirmed' AND block.execution_status = 'planned' AND task.status NOT IN ('done','deleted')
                   AND julianday(block.starts_at) <= julianday(?1) AND julianday(block.ends_at) > julianday(?1) AND julianday(block.ends_at) <= julianday(?2)",
            )?;
            let rows = statement.query_map(params![current_time, cutoff], |row| Ok((
                TaskBlockNotificationDto {
                    block_id: row.get(0)?, task_id: row.get(1)?, task_title: row.get(2)?, task_notes: row.get(3)?,
                    task_priority: row.get(4)?, task_tags: row.get::<_, Option<String>>(5)?.unwrap_or_default().split(" · ").filter(|tag| !tag.is_empty()).map(str::to_owned).collect(),
                    starts_at: row.get(6)?, ends_at: row.get(7)?, event_at: row.get(8)?, is_end: row.get(9)?, schedule_revision: row.get(11)?,
                },
                row.get::<_, String>(10)?,
            )))?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        let mut claimed = Vec::new();
        for (candidate, plan_date) in candidates {
            let notification_type = format!("task_block:{}:{}:{}", candidate.block_id, if candidate.is_end { "end" } else { "start" }, candidate.event_at);
            let changed = transaction.execute(
                "INSERT OR IGNORE INTO notification_states
                    (id, notification_type, notification_date, status, created_at, updated_at)
                 VALUES (?1, ?2, ?3, 'sent', ?4, ?4)",
                params![Uuid::new_v4().to_string(), notification_type, plan_date, now()],
            )?;
            if changed == 1 { claimed.push(candidate); }
        }
        transaction.commit()?;
        Ok(claimed)
    }

    pub fn get_ai_connection_settings(&self) -> AppResult<AiConnectionSettingsDto> {
        let stored = self.read_ai_connection_settings(true)?;
        Ok(AiConnectionSettingsDto {
            api_type: stored.api_type,
            endpoint: stored.endpoint,
            model: stored.model,
            api_key_configured: !stored.api_key.is_empty(),
        })
    }

    pub fn load_ai_connection_settings(&self) -> AppResult<StoredAiConnectionSettings> {
        let stored = self.read_ai_connection_settings(true)?;
        if stored.api_key.is_empty() {
            return Err(AppError::Domain("尚未配置 API Key".into()));
        }
        Ok(stored)
    }

    fn read_ai_connection_settings(&self, include_key: bool) -> AppResult<StoredAiConnectionSettings> {
        let read = |key: &str| -> AppResult<Option<String>> {
            self.connection.query_row(
                "SELECT value FROM settings WHERE key = ?1", [key], |row| row.get(0),
            ).optional().map_err(AppError::from)
        };
        let api_type = read("ai.api_type")?.unwrap_or_else(|| "chat_completions".into());
        let endpoint = read("ai.endpoint")?.unwrap_or_else(|| "https://api.openai.com/v1".into());
        let model = read("ai.model")?.unwrap_or_else(|| "gpt-5-mini".into());
        let api_key = if include_key { read("ai.api_key")?.unwrap_or_default() } else { String::new() };
        Ok(StoredAiConnectionSettings { api_type, endpoint, model, api_key })
    }

    pub fn save_ai_connection_settings(
        &mut self,
        input: AiConnectionSettingsInput,
    ) -> AppResult<AiConnectionSettingsDto> {
        let api_type = input.api_type.trim();
        if !matches!(api_type, "chat_completions" | "responses") {
            return Err(AppError::Domain("AI API 类型无效".into()));
        }
        let endpoint = input.endpoint.trim().trim_end_matches('/');
        if !(endpoint.starts_with("https://") || endpoint.starts_with("http://127.0.0.1") || endpoint.starts_with("http://localhost")) {
            return Err(AppError::Domain("AI 连接地址必须使用 HTTPS；仅本机地址允许 HTTP".into()));
        }
        let model = input.model.trim();
        if model.is_empty() || model.chars().count() > 100 {
            return Err(AppError::Domain("模型名称不能为空且不能超过 100 个字符".into()));
        }
        let api_key = input.api_key.map(|value| value.trim().to_owned());
        if api_key.as_ref().is_some_and(|value| value.is_empty()) {
            return Err(AppError::Domain("API Key 不能为空；若要保留现有 Key，请不要填写新值".into()));
        }
        let transaction = self.connection.transaction()?;
        for (key, value) in [
            ("ai.api_type", api_type.to_owned()),
            ("ai.endpoint", endpoint.to_owned()),
            ("ai.model", model.to_owned()),
        ] {
            upsert_setting(&transaction, key, &value)?;
        }
        if let Some(api_key) = api_key { upsert_setting(&transaction, "ai.api_key", &api_key)?; }
        transaction.commit()?;
        self.get_ai_connection_settings()
    }

    pub fn create_ai_conversation(&mut self, title: Option<String>) -> AppResult<AiConversationDto> {
        let title = normalize_conversation_title(title.as_deref().unwrap_or("新对话"))?;
        let id = Uuid::new_v4().to_string();
        let timestamp = now();
        self.connection.execute(
            "INSERT INTO ai_conversations (id, title, status, created_at, updated_at)
             VALUES (?1, ?2, 'active', ?3, ?3)",
            params![id, title, timestamp],
        )?;
        self.get_ai_conversation(&id)
    }

    pub fn list_ai_conversations(
        &self,
        include_archived: bool,
        search: Option<&str>,
    ) -> AppResult<Vec<AiConversationDto>> {
        let pattern = search.map(str::trim).filter(|value| !value.is_empty()).map(|value| format!("%{value}%"));
        let mut statement = self.connection.prepare(
            "SELECT conversation.id, conversation.title, conversation.status,
                    (SELECT COUNT(*) FROM ai_messages message WHERE message.conversation_id = conversation.id),
                    (SELECT COUNT(*) FROM task_drafts draft WHERE draft.conversation_id = conversation.id AND draft.status = 'active'),
                    conversation.created_at, conversation.updated_at, conversation.archived_at
             FROM ai_conversations conversation
             WHERE (?1 = 1 OR conversation.status = 'active')
               AND (?2 IS NULL OR conversation.title LIKE ?2 OR EXISTS(
                   SELECT 1 FROM ai_messages message
                   WHERE message.conversation_id = conversation.id AND message.content LIKE ?2
               ))
             ORDER BY conversation.updated_at DESC",
        )?;
        let rows = statement.query_map(params![include_archived as i64, pattern], ai_conversation_from_row)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
    }

    pub fn rename_ai_conversation(&mut self, conversation_id: &str, title: &str) -> AppResult<AiConversationDto> {
        let title = normalize_conversation_title(title)?;
        let changed = self.connection.execute(
            "UPDATE ai_conversations SET title = ?2, updated_at = ?3 WHERE id = ?1",
            params![conversation_id, title, now()],
        )?;
        if changed != 1 { return Err(AppError::NotFound(format!("对话 {conversation_id}"))); }
        self.get_ai_conversation(conversation_id)
    }

    pub fn set_ai_conversation_archived(&mut self, conversation_id: &str, archived: bool) -> AppResult<AiConversationDto> {
        let timestamp = now();
        let changed = self.connection.execute(
            "UPDATE ai_conversations
             SET status = ?2, archived_at = ?3, updated_at = ?4 WHERE id = ?1",
            params![conversation_id, if archived { "archived" } else { "active" }, if archived { Some(timestamp.clone()) } else { None }, timestamp],
        )?;
        if changed != 1 { return Err(AppError::NotFound(format!("对话 {conversation_id}"))); }
        self.get_ai_conversation(conversation_id)
    }

    pub fn permanently_delete_ai_conversation(&mut self, conversation_id: &str, confirmed: bool) -> AppResult<()> {
        if !confirmed { return Err(AppError::InvalidConfirmation); }
        let active_drafts: i64 = self.connection.query_row(
            "SELECT COUNT(*) FROM task_drafts WHERE conversation_id = ?1 AND status = 'active'",
            [conversation_id], |row| row.get(0),
        )?;
        if active_drafts > 0 {
            return Err(AppError::Domain("该对话仍有关联的待确认草稿，请先确认或放弃草稿".into()));
        }
        let changed = self.connection.execute("DELETE FROM ai_conversations WHERE id = ?1", [conversation_id])?;
        if changed != 1 { return Err(AppError::NotFound(format!("对话 {conversation_id}"))); }
        Ok(())
    }

    pub fn list_ai_messages(&self, conversation_id: &str, limit: i64) -> AppResult<Vec<AiMessageDto>> {
        let limit = limit.clamp(1, 200);
        let mut statement = self.connection.prepare(
            "SELECT id, conversation_id, run_id, role, content, stream_status, created_at, updated_at
             FROM (SELECT * FROM ai_messages WHERE conversation_id = ?1 ORDER BY created_at DESC LIMIT ?2)
             ORDER BY created_at ASC",
        )?;
        let rows = statement.query_map(params![conversation_id, limit], ai_message_from_row)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
    }

    pub fn start_ai_run(&mut self, conversation_id: &str, prompt: &str) -> AppResult<AiRunContext> {
        let prompt = prompt.trim();
        if prompt.is_empty() || prompt.chars().count() > 8_000 {
            return Err(AppError::Domain("消息必须为 1 至 8000 个字符".into()));
        }
        let transaction = self.connection.transaction()?;
        let (status, title): (String, String) = transaction.query_row(
            "SELECT status, title FROM ai_conversations WHERE id = ?1", [conversation_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional()?.ok_or_else(|| AppError::NotFound(format!("对话 {conversation_id}")))?;
        if status != "active" { return Err(AppError::Domain("已归档对话不能继续发送消息，请先恢复".into())); }
        let running: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM ai_runs WHERE conversation_id = ?1 AND run_status IN ('pending','streaming'))",
            [conversation_id], |row| row.get(0),
        )?;
        if running { return Err(AppError::Domain("当前对话已有正在进行的分析".into())); }
        let timestamp = now();
        let run_id = Uuid::new_v4().to_string();
        transaction.execute(
            "INSERT INTO ai_runs (id, operation_type, structured_result_json, validation_status, conversation_id, run_status, created_at, updated_at)
             VALUES (?1, 'assistant_task_drafts', '{}', 'failed', ?2, 'streaming', ?3, ?3)",
            params![run_id, conversation_id, timestamp],
        )?;
        transaction.execute(
            "INSERT INTO ai_messages (id, conversation_id, run_id, role, content, stream_status, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'user', ?4, 'complete', ?5, ?5)",
            params![Uuid::new_v4().to_string(), conversation_id, run_id, prompt, timestamp],
        )?;
        if title == "新对话" {
            let automatic_title: String = prompt.chars().take(24).collect();
            transaction.execute(
                "UPDATE ai_conversations SET title = ?2, updated_at = ?3 WHERE id = ?1",
                params![conversation_id, automatic_title, timestamp],
            )?;
        } else {
            transaction.execute("UPDATE ai_conversations SET updated_at = ?2 WHERE id = ?1", params![conversation_id, timestamp])?;
        }
        let run = load_ai_run_in_transaction(&transaction, &run_id)?;
        let messages = load_ai_messages_in_transaction(&transaction, conversation_id, 80)?;
        transaction.commit()?;
        let task_candidates = if prompt_needs_task_candidates(prompt) { self.list_ai_task_candidates(20)? } else { Vec::new() };
        Ok(AiRunContext { run, messages, task_candidates })
    }

    pub fn stop_ai_run(&mut self, run_id: &str) -> AppResult<AiRunDto> {
        let timestamp = now();
        let changed = self.connection.execute(
            "UPDATE ai_runs SET run_status = 'stopped', stopped_at = ?2, updated_at = ?2
             WHERE id = ?1 AND run_status IN ('pending','streaming')",
            params![run_id, timestamp],
        )?;
        if changed != 1 {
            let current = self.get_ai_run(run_id)?;
            if current.run_status == "stopped" { return Ok(current); }
            return Err(AppError::Domain("这次分析已经结束，不能再次停止".into()));
        }
        self.get_ai_run(run_id)
    }

    pub fn get_ai_run_context(&self, run_id: &str) -> AppResult<AiRunContext> {
        let run = self.get_ai_run(run_id)?;
        let messages = {
            let mut statement = self.connection.prepare(
                "SELECT id, conversation_id, run_id, role, content, stream_status, created_at, updated_at
                 FROM (SELECT * FROM ai_messages WHERE conversation_id = ?1 ORDER BY created_at DESC LIMIT 80)
                 ORDER BY created_at ASC",
            )?;
            let rows = statement.query_map([&run.conversation_id], ai_message_from_row)?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        let latest_prompt = messages.iter().rev().find(|message| message.role == "user").map(|message| message.content.as_str()).unwrap_or("");
        let task_candidates = if prompt_needs_task_candidates(latest_prompt) { self.list_ai_task_candidates(20)? } else { Vec::new() };
        Ok(AiRunContext { run, messages, task_candidates })
    }

    pub fn fail_ai_run(&mut self, run_id: &str, error_message: &str) -> AppResult<AiRunDto> {
        let message: String = error_message.chars().take(800).collect();
        self.connection.execute(
            "UPDATE ai_runs SET run_status = 'failed', validation_status = 'failed', error_message = ?2, updated_at = ?3
             WHERE id = ?1 AND run_status IN ('pending','streaming')",
            params![run_id, message, now()],
        )?;
        self.get_ai_run(run_id)
    }

    pub fn complete_ai_run_with_drafts(
        &mut self,
        run_id: &str,
        assistant_message: &str,
        drafts: Vec<AiDraftCreationInput>,
        structured_result_json: &str,
    ) -> AppResult<(AiRunDto, Vec<TaskDraftDto>)> {
        let assistant_message = assistant_message.trim();
        if assistant_message.is_empty() { return Err(AppError::Schema("模型回复不能为空".into())); }
        if drafts.len() > 10 { return Err(AppError::Schema("一次最多生成 10 条任务草稿".into())); }
        for draft in &drafts {
            if !matches!(draft.draft_kind.as_str(), "create" | "update") {
                return Err(AppError::Schema("AI 草稿类型无效".into()));
            }
            if draft.draft_kind == "update" && draft.target_task_id.as_deref().is_none_or(str::is_empty) {
                return Err(AppError::Schema("修改草稿必须绑定目标任务".into()));
            }
            if draft.draft_kind == "update" && draft.input.item_type != "task" {
                return Err(AppError::Domain("修改已有任务的草稿不能切换类型".into()));
            }
            validate_task_draft_input(&draft.input, false)?;
        }
        let transaction = self.connection.transaction()?;
        let run = load_ai_run_in_transaction(&transaction, run_id)?;
        if !matches!(run.run_status.as_str(), "pending" | "streaming") {
            return Err(AppError::Domain("这次分析已停止或失效，迟到结果不会写入草稿".into()));
        }
        let timestamp = now();
        let mut created_drafts = Vec::with_capacity(drafts.len());
        for draft in drafts {
            let input = draft.input;
            let draft_id = Uuid::new_v4().to_string();
            let tags_json = serde_json::to_string(&normalize_tags(&input.tags)?)?;
            database_tags::validate_selection(&input.tags, &[])?;
            database_tags::register_tags(&transaction, &input.tags)?;
            let recurrence_json = input.recurrence.as_ref().map(serde_json::to_string).transpose()?;
            let recurring_settings_json = input.recurring_settings.as_ref().map(serde_json::to_string).transpose()?;
            let confirmation_token = Uuid::new_v4().to_string();
            transaction.execute(
                "INSERT INTO task_drafts (
                    id, draft_kind, target_task_id, source_type, conversation_id, ai_run_id, title, notes, priority,
                    earliest_start_date, earliest_start_time, due_date, due_time,
                    total_workload_minutes, remaining_workload_minutes, splittable,
                    field_states_json, validation_status, version, confirmation_token,
                    status, created_at, updated_at, tags_json, recurrence_json, item_type, recurring_settings_json
                 ) VALUES (
                    ?1, ?2, ?3, 'ai_assistant', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                    ?13, ?14, 1, ?15, ?16, 1, ?17, 'active', ?18, ?18, ?19, ?20, ?21, ?22
                 )",
                params![
                    draft_id, draft.draft_kind, draft.target_task_id, run.conversation_id, run_id, input.title, input.notes,
                    input.priority.map(Priority::as_str), input.earliest_start_date,
                    input.earliest_start_time, input.due_date, input.due_time,
                    input.total_workload_minutes, input.remaining_workload_minutes,
                    input.field_states_json, draft_validation_status(&input), confirmation_token,
                    timestamp, tags_json, recurrence_json, input.item_type, recurring_settings_json,
                ],
            )?;
            created_drafts.push(load_task_draft_in_transaction(&transaction, &draft_id)?);
        }
        transaction.execute(
            "INSERT INTO ai_messages (id, conversation_id, run_id, role, content, stream_status, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'assistant', ?4, 'complete', ?5, ?5)",
            params![Uuid::new_v4().to_string(), run.conversation_id, run_id, assistant_message, timestamp],
        )?;
        transaction.execute(
            "UPDATE ai_runs SET structured_result_json = ?2, validation_status = 'validated',
                    run_status = 'completed', assistant_message = ?3, updated_at = ?4
             WHERE id = ?1 AND run_status IN ('pending','streaming')",
            params![run_id, structured_result_json, assistant_message, timestamp],
        )?;
        transaction.execute(
            "UPDATE ai_conversations SET updated_at = ?2 WHERE id = ?1",
            params![run.conversation_id, timestamp],
        )?;
        let completed = load_ai_run_in_transaction(&transaction, run_id)?;
        transaction.commit()?;
        Ok((completed, created_drafts))
    }

    pub fn get_ai_run(&self, run_id: &str) -> AppResult<AiRunDto> {
        self.connection.query_row(
            "SELECT id, conversation_id, run_status, assistant_message, error_message, created_at, updated_at, stopped_at
             FROM ai_runs WHERE id = ?1", [run_id], ai_run_from_row,
        ).optional()?.ok_or_else(|| AppError::NotFound(format!("AI 运行 {run_id}")))
    }

    fn get_ai_conversation(&self, conversation_id: &str) -> AppResult<AiConversationDto> {
        self.connection.query_row(
            "SELECT conversation.id, conversation.title, conversation.status,
                    (SELECT COUNT(*) FROM ai_messages message WHERE message.conversation_id = conversation.id),
                    (SELECT COUNT(*) FROM task_drafts draft WHERE draft.conversation_id = conversation.id AND draft.status = 'active'),
                    conversation.created_at, conversation.updated_at, conversation.archived_at
             FROM ai_conversations conversation WHERE conversation.id = ?1",
            [conversation_id], ai_conversation_from_row,
        ).optional()?.ok_or_else(|| AppError::NotFound(format!("对话 {conversation_id}")))
    }

    fn list_ai_task_candidates(&self, limit: i64) -> AppResult<Vec<AiTaskCandidateDto>> {
        let mut statement = self.connection.prepare(
            "SELECT id, title, status, priority, due_date, due_time,
                    earliest_start_date, earliest_start_time, remaining_workload_minutes FROM tasks
             WHERE deleted_at IS NULL AND status IN ('open','scheduled')
             ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
                      due_date IS NULL, due_date, updated_at DESC LIMIT ?1",
        )?;
        let rows = statement.query_map([limit], |row| Ok(AiTaskCandidateDto {
            id: row.get(0)?, title: row.get(1)?, status: row.get(2)?, priority: row.get(3)?, due_date: row.get(4)?,
            due_time: row.get(5)?, earliest_start_date: row.get(6)?, earliest_start_time: row.get(7)?,
            remaining_workload_minutes: row.get(8)?,
        }))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
    }

    pub fn update_manual_task(&mut self, task_id: &str, update: ManualTaskUpdate) -> AppResult<TaskDto> {
        self.update_manual_task_with_tags(task_id, update, None)
    }

    pub fn update_manual_task_with_tags(&mut self, task_id: &str, update: ManualTaskUpdate, tags: Option<Vec<String>>) -> AppResult<TaskDto> {
        crate::domain::validate_title(&update.title)?;
        crate::domain::validate_workload(update.estimated_minutes, "总工作量", false)?;
        let tags = tags.map(|values| normalize_tags(&values)).transpose()?;
        let transaction = self.connection.transaction()?;
        let updated_at = now();
        let existing = load_task_dto_in_transaction(&transaction, task_id)?;
        let before_blocks = load_task_schedule_blocks(&transaction, task_id)?;
        let current_drafts = current_plan_draft_dates(&transaction)?;
        ensure_task_content_editable(&existing)?;
        crate::domain::validate_complete_task_timestamps(&update.earliest_start_at, &update.due_at)?;
        if existing.title != update.title {
            record_task_change(&transaction, task_id, "title_changed", Some(&existing.title), Some(&update.title), "manual", None)?;
        }
        record_optional_change(&transaction, task_id, "notes_changed", existing.notes.as_deref(), update.notes.as_deref())?;
        let priority = update.priority.map(Priority::as_str).map(str::to_owned);
        record_optional_change(&transaction, task_id, "priority_changed", existing.priority.as_deref(), priority.as_deref())?;
        record_optional_change(&transaction, task_id, "earliest_start_changed", existing.earliest_start_at.as_deref(), update.earliest_start_at.as_deref())?;
        record_optional_change(&transaction, task_id, "due_changed", existing.due_at.as_deref(), update.due_at.as_deref())?;
        let old_estimate = existing.estimated_minutes.map(|value| value.to_string());
        let new_estimate = update.estimated_minutes.map(|value| value.to_string());
        record_optional_change(&transaction, task_id, "estimate_changed", old_estimate.as_deref(), new_estimate.as_deref())?;
        let (earliest_start_date, earliest_start_time) = split_legacy_timestamp(update.earliest_start_at.as_deref());
        let (due_date, due_time) = split_legacy_timestamp(update.due_at.as_deref());
        ensure_task_not_moved_into_history(&existing, earliest_start_date.as_deref(), due_date.as_deref())?;
        let remaining_workload_minutes = if existing.migration_review_required
            || existing.remaining_workload_minutes == existing.estimated_minutes
        {
            update.estimated_minutes
        } else {
            existing.remaining_workload_minutes
        };
        if existing.total_workload_minutes != update.estimated_minutes {
            transaction.execute(
                "INSERT INTO task_estimates
                    (id, task_id, estimate_kind, old_minutes, new_minutes, source, reason, created_at)
                 VALUES (?1, ?2, 'total', ?3, ?4, 'manual', '旧版任务编辑器显式更新', ?5)",
                params![
                    Uuid::new_v4().to_string(), task_id, existing.total_workload_minutes,
                    update.estimated_minutes, now()
                ],
            )?;
        }
        transaction.execute(
            "UPDATE tasks
             SET title = ?2, notes = ?3, priority = ?4, earliest_start_at = ?5, due_at = ?6,
                 estimated_minutes = ?7, splittable = ?8, updated_at = ?9,
                 earliest_start_date = ?10, earliest_start_time = ?11,
                 due_date = ?12, due_time = ?13,
                 total_workload_minutes = ?7, remaining_workload_minutes = ?14,
                 migration_review_required = 0
             WHERE id = ?1",
            params![
                task_id,
                update.title,
                update.notes,
                priority,
                update.earliest_start_at,
                update.due_at,
                update.estimated_minutes,
                1,
                updated_at,
                earliest_start_date,
                earliest_start_time,
                due_date,
                due_time,
                remaining_workload_minutes,
            ],
        )?;
        if let Some(tags) = &tags {
            apply_task_tags(&transaction, task_id, tags)?;
            record_task_change(&transaction, task_id, "tags_updated",
                Some(&serde_json::to_string(&existing.tags)?), Some(&serde_json::to_string(tags)?), "manual", None)?;
        }
        sync_single_day_task_schedule(&transaction, task_id, Some(&existing), &current_drafts)?;
        let committed = load_task_dto_in_transaction(&transaction, task_id)?;
        record_undo_entry(
            &transaction, "task_updated", "task", task_id,
            &task_schedule_undo_json(&transaction, task_id, Some(existing), before_blocks)?, Some(&committed.updated_at),
        )?;
        transaction.commit()?;
        self.get_task(task_id)
    }

    pub fn transition_manual_task(&mut self, task_id: &str, target: TaskStatus) -> AppResult<TaskDto> {
        if target == TaskStatus::Done { return self.complete_task(task_id, None); }
        if matches!(target, TaskStatus::Scheduled | TaskStatus::Deleted) {
            return Err(AppError::Domain("该状态必须通过专用操作变更".into()));
        }
        if target == TaskStatus::Open && self.get_task(task_id)?.status == "done" {
            return self.reopen_manual_task(task_id, &shanghai_today());
        }
        let transaction = self.connection.transaction()?;
        set_task_status(&transaction, task_id, target, "manual")?;
        transaction.commit()?;
        self.get_task(task_id)
    }

    pub fn reopen_manual_task(&mut self, task_id: &str, plan_date: &str) -> AppResult<TaskDto> {
        parse_plan_date(plan_date)?;
        let transaction = self.connection.transaction()?;
        database_execution::reopen_in_transaction(&transaction, task_id, plan_date)?;
        transaction.commit()?;
        self.get_task(task_id)
    }

    pub fn soft_delete_manual_task(&mut self, task_id: &str, confirmed: bool) -> AppResult<()> {
        if !confirmed { return Err(AppError::Domain("移入回收站前需要确认".into())); }
        let transaction = self.connection.transaction()?;
        soft_delete_task(&transaction, task_id, "manual")?;
        transaction.commit()?;
        Ok(())
    }

    pub fn create_fixed_event(&mut self, input: ManualCalendarEventInput) -> AppResult<CalendarEventDto> {
        let input = normalize_calendar_event_input(input)?;
        let id = Uuid::new_v4().to_string();
        let timestamp = now();
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "INSERT INTO calendar_events (id, title, starts_at, ends_at, is_all_day, blocks_scheduling, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![
                id, input.title.trim(), input.starts_at, input.ends_at,
                input.is_all_day as i64, false, timestamp
            ],
        )?;
        transaction.commit()?;
        self.get_calendar_event(&id)
    }

    pub fn update_fixed_event(&mut self, event_id: &str, input: ManualCalendarEventInput) -> AppResult<CalendarEventDto> {
        let input = normalize_calendar_event_input(input)?;
        let transaction = self.connection.transaction()?;
        let exists: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM calendar_events WHERE id = ?1 AND deleted_at IS NULL)",
            [event_id],
            |row| row.get(0),
        )?;
        if !exists { return Err(AppError::NotFound(format!("固定日程 {event_id}"))); }
        transaction.execute(
            "UPDATE calendar_events
             SET title = ?2, starts_at = ?3, ends_at = ?4, is_all_day = ?5,
                 blocks_scheduling = ?6, updated_at = ?7
             WHERE id = ?1",
            params![
                event_id, input.title.trim(), input.starts_at, input.ends_at,
                input.is_all_day as i64, false, now()
            ],
        )?;
        transaction.commit()?;
        self.get_calendar_event(event_id)
    }

    pub fn soft_delete_fixed_event(&mut self, event_id: &str, confirmed: bool) -> AppResult<()> {
        if !confirmed { return Err(AppError::Domain("移除固定日程前需要确认".into())); }
        let transaction = self.connection.transaction()?;
        let affected = transaction.execute(
            "UPDATE calendar_events SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
            params![event_id, now()],
        )?;
        if affected == 0 { return Err(AppError::NotFound(format!("固定日程 {event_id}"))); }
        transaction.commit()?;
        Ok(())
    }

    pub fn list_calendar_events(&self, range_start: &str, range_end: &str) -> AppResult<Vec<CalendarEventDto>> {
        validate_range(range_start, range_end)?;
        let mut statement = self.connection.prepare(
            "SELECT id, title, starts_at, ends_at, is_all_day, blocks_scheduling, deleted_at, created_at, updated_at
             FROM calendar_events
             WHERE deleted_at IS NULL AND starts_at < ?2 AND ends_at > ?1
             ORDER BY starts_at, ends_at, title",
        )?;
        let rows = statement.query_map(params![range_start, range_end], calendar_event_dto_from_row)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
    }

    fn get_calendar_event(&self, event_id: &str) -> AppResult<CalendarEventDto> {
        self.connection.query_row(
            "SELECT id, title, starts_at, ends_at, is_all_day, blocks_scheduling, deleted_at, created_at, updated_at
             FROM calendar_events WHERE id = ?1",
            [event_id], calendar_event_dto_from_row,
        ).optional()?.ok_or_else(|| AppError::NotFound(format!("固定日程 {event_id}")))
    }

    pub fn get_availability_settings(&self) -> AppResult<AvailabilitySettings> {
        let stored: Option<(String, String, String, Option<String>, Option<String>, String, i64, bool)> = self.connection.query_row(
            "SELECT weekdays_json, workday_start, workday_end, lunch_start, lunch_end, lunch_reason, buffer_minutes, makeup_workdays_as_workdays
             FROM availability_settings WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?)),
        ).optional()?;
        match stored {
            Some((weekdays, workday_start, workday_end, lunch_start, lunch_end, lunch_reason, buffer_minutes, makeup_workdays_as_workdays)) => {
                let settings = AvailabilitySettings {
                    weekdays: serde_json::from_str(&weekdays)?, workday_start, workday_end,
                    lunch_start, lunch_end, lunch_reason, buffer_minutes, makeup_workdays_as_workdays,
                };
                validate_availability_settings(&settings)?;
                Ok(settings)
            }
            None => Ok(AvailabilitySettings::default()),
        }
    }

    pub fn save_availability_settings(&mut self, settings: AvailabilitySettings) -> AppResult<AvailabilitySettings> {
        validate_availability_settings(&settings)?;
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "INSERT INTO availability_settings
                (id, weekdays_json, workday_start, workday_end, lunch_start, lunch_end, lunch_reason, buffer_minutes, updated_at, makeup_workdays_as_workdays)
             VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
                weekdays_json = excluded.weekdays_json, workday_start = excluded.workday_start,
                workday_end = excluded.workday_end,
                makeup_workdays_as_workdays = excluded.makeup_workdays_as_workdays,
                updated_at = excluded.updated_at",
            params![
                serde_json::to_string(&settings.weekdays)?, settings.workday_start, settings.workday_end,
                settings.lunch_start, settings.lunch_end, settings.lunch_reason, settings.buffer_minutes, now(), settings.makeup_workdays_as_workdays
            ],
        )?;
        transaction.commit()?;
        self.get_availability_settings()
    }

    fn rule_plan_facts_json(&self, plan_date: &str) -> AppResult<String> {
        rule_plan_facts_json_from_connection(&self.connection, plan_date)
    }

    fn store_rule_plan_draft(
        &mut self,
        plan_date: &str,
        blocks: Vec<RulePlanBlock>,
        mut unscheduled: Vec<UnscheduledTask>,
        base_plan_id: Option<String>,
    ) -> AppResult<RulePlanPreview> {
        remove_automatic_duplicates_already_in_plan(&blocks, &mut unscheduled);
        let facts_json = self.rule_plan_facts_json(plan_date)?;
        let existing: Option<(String, i64)> = self.connection.query_row(
            "SELECT id, version FROM daily_plan_drafts WHERE plan_date = ?1 AND status = 'active'",
            [plan_date],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional()?;
        let preview_id = existing.as_ref().map(|value| value.0.clone()).unwrap_or_else(|| Uuid::new_v4().to_string());
        let version = existing.map_or(1, |value| value.1 + 1);
        let confirmation_token = Uuid::new_v4().to_string();
        let timestamp = now();
        let blocks_json = serde_json::to_string(&blocks)?;
        let unscheduled_json = serde_json::to_string(&unscheduled)?;
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "INSERT INTO daily_plan_drafts (
                id, plan_date, source, blocks_json, unscheduled_json, facts_json,
                version, confirmation_token, status, created_at, updated_at, base_plan_id
             ) VALUES (?1, ?2, 'rule_based', ?3, ?4, ?5, ?6, ?7, 'active', ?8, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
                blocks_json = excluded.blocks_json,
                unscheduled_json = excluded.unscheduled_json,
                facts_json = excluded.facts_json,
                base_plan_id = excluded.base_plan_id,
                version = excluded.version,
                confirmation_token = excluded.confirmation_token,
                status = 'active',
                updated_at = excluded.updated_at",
            params![preview_id, plan_date, blocks_json, unscheduled_json, facts_json, version, confirmation_token, timestamp, base_plan_id],
        )?;
        transaction.commit()?;
        Ok(RulePlanPreview {
            preview_id,
            plan_date: plan_date.into(),
            base_plan_id,
            blocks,
            unscheduled,
            generated_at: timestamp,
            version,
            confirmation_token,
        })
    }

    pub fn get_rule_plan_draft(&self, plan_date: &str) -> AppResult<Option<RulePlanPreview>> {
        parse_plan_date(plan_date)?;
        Ok(load_rule_plan_draft_for_date(&self.connection, plan_date)?.map(|stored| {
            let mut preview = stored.preview;
            remove_automatic_duplicates_already_in_plan(&preview.blocks, &mut preview.unscheduled);
            preview
        }))
    }

    fn rule_plan_candidates(&self, plan_date: &str, ignored_plan_id: Option<&str>) -> AppResult<Vec<RuleCandidate>> {
        let mut statement = self.connection.prepare(
            "SELECT task.id, task.title,
                    COALESCE(task.remaining_workload_minutes, task.estimated_minutes),
                    COALESCE(task.total_workload_minutes, task.estimated_minutes),
                    COALESCE((
                        SELECT SUM(CAST(ROUND((julianday(pb.ends_at) - julianday(pb.starts_at)) * 1440) AS INTEGER))
                        FROM plan_blocks pb
                        JOIN daily_plans dp ON dp.id = pb.daily_plan_id
                        WHERE pb.task_id = task.id
                          AND dp.status = 'confirmed'
                          AND NOT EXISTS (
                              SELECT 1 FROM review_entries review WHERE review.plan_block_id = pb.id
                          )
                          AND (?1 IS NULL OR dp.id <> ?1 OR pb.execution_status <> 'planned')
                    ), 0),
                    task.earliest_start_at, task.due_at
             FROM tasks task
             WHERE task.status IN ('open', 'scheduled')
               AND task.earliest_start_at IS NOT NULL
               AND task.due_at IS NOT NULL
               AND substr(task.earliest_start_at, 1, 10) <= ?2
               AND substr(task.due_at, 1, 10) >= ?2
             ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
                      CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, due_at, created_at",
        )?;
        let mut candidates = statement.query_map(params![ignored_plan_id, plan_date], |row| Ok(RuleCandidate {
            task_id: row.get(0)?, task_title: row.get(1)?, estimated_minutes: row.get(2)?,
            total_workload_minutes: row.get(3)?, reserved_minutes: row.get(4)?,
            earliest_start_at: row.get(5)?, due_at: row.get(6)?,
        }))?.collect::<Result<Vec<_>, _>>()?;
        drop(statement);
        let mut editable = Vec::new();
        for mut task in candidates.drain(..) {
            if self.get_task(&task.task_id)?.execution_locked { continue; }
            if single_day_range(task.earliest_start_at.as_deref(), task.due_at.as_deref())?
                .is_some_and(|(date, _)| date == plan_date)
                && can_sync_single_day_task(&self.connection, &task.task_id,
                    task.earliest_start_at.as_deref(), task.due_at.as_deref())?
            {
                task.reserved_minutes = 0;
            }
            editable.push(task);
        }
        editable.retain(|task| task.estimated_minutes.map_or(true, |minutes| minutes > task.reserved_minutes));
        Ok(editable)
    }

    fn build_rule_plan_draft(
        &mut self,
        plan_date: &str,
        base_plan_id: Option<String>,
    ) -> AppResult<RulePlanPreview> {
        let date = parse_plan_date(plan_date)?;
        let settings = self.get_availability_settings()?;
        let candidates = self.rule_plan_candidates(plan_date, base_plan_id.as_deref())?;
        let mut unscheduled = Vec::new();
        let day_start = shanghai_timestamp(date, NaiveTime::from_hms_opt(0, 0, 0).unwrap())?;
        let day_end = shanghai_timestamp(
            date.succ_opt().ok_or_else(|| AppError::Domain("计划日期超出范围".into()))?,
            NaiveTime::from_hms_opt(0, 0, 0).unwrap(),
        )?;
        let preferred_start = shanghai_timestamp(date, parse_clock(&settings.workday_start)?)?;
        let preferred_end = shanghai_timestamp(date, parse_clock(&settings.workday_end)?)?;

        let mut blocks = Vec::new();
        for mut task in candidates {
            if let Some((date, minutes)) = single_day_range(task.earliest_start_at.as_deref(), task.due_at.as_deref())? {
                if date >= shanghai_today() && date == plan_date && can_sync_single_day_task(&self.connection,
                    &task.task_id, task.earliest_start_at.as_deref(), task.due_at.as_deref())? {
                    if minutes < MIN_TASK_BLOCK_MINUTES {
                        unscheduled.push(UnscheduledTask { task_id: task.task_id, task_title: task.task_title,
                            reason: "单日任务至少需要 15 分钟".into(), estimated_minutes: Some(minutes) });
                    } else {
                        blocks.push(RulePlanBlock { task_id: task.task_id, task_title: task.task_title,
                            starts_at: task.earliest_start_at.unwrap(), ends_at: task.due_at.unwrap(), estimated_minutes: minutes });
                    }
                    continue;
                }
            }
            if task.estimated_minutes.is_none() {
                unscheduled.push(UnscheduledTask {
                    task_id: task.task_id, task_title: task.task_title,
                    reason: "尚未填写预计时长".into(), estimated_minutes: None,
                });
                continue;
            }
            let schedulable_minutes = task.estimated_minutes.unwrap_or_default() - task.reserved_minutes;
            if schedulable_minutes <= 0 { continue; }
            task.estimated_minutes = Some(schedulable_minutes);
            let preferred_task_minutes = preferred_daily_task_minutes(
                task.total_workload_minutes,
                task.earliest_start_at.as_deref(),
                task.due_at.as_deref(),
            )?.map_or(schedulable_minutes, |daily| daily.min(schedulable_minutes));
            if schedulable_minutes < MIN_TASK_BLOCK_MINUTES {
                unscheduled.push(UnscheduledTask {
                    task_id: task.task_id, task_title: task.task_title,
                    reason: format!(
                        "剩余工作量不足 {MIN_TASK_BLOCK_MINUTES} 分钟；普通任务块至少需要 {MIN_TASK_BLOCK_MINUTES} 分钟"
                    ),
                    estimated_minutes: task.estimated_minutes,
                });
                continue;
            }
            let earliest = task.earliest_start_at.as_deref()
                .map(crate::domain::parse_shanghai_timestamp).transpose()?;
            let due = task.due_at.as_deref()
                .map(crate::domain::parse_shanghai_timestamp).transpose()?;
            if earliest.is_some_and(|value| value >= day_end) {
                unscheduled.push(UnscheduledTask {
                    task_id: task.task_id, task_title: task.task_title,
                    reason: "任务尚未到最早可开始日期，请选择有效日期或调整任务时间范围".into(),
                    estimated_minutes: task.estimated_minutes,
                });
                continue;
            }
            if due.is_some_and(|value| value <= day_start) {
                unscheduled.push(UnscheduledTask {
                    task_id: task.task_id, task_title: task.task_title,
                    reason: "任务已超过截止时间，请调整任务时间范围后再安排".into(),
                    estimated_minutes: task.estimated_minutes,
                });
                continue;
            }
            // Work hours are a preferred starting point, not capacity. Each task may
            // share that preferred period with any event or other task.
            let starts_at = earliest.unwrap_or(preferred_start).max(day_start);
            let end_limit = due.unwrap_or(day_end).min(day_end);
            let preferred_starts_at = if starts_at <= preferred_end && preferred_start < end_limit {
                starts_at.max(preferred_start)
            } else {
                starts_at
            };
            if preferred_starts_at >= end_limit {
                unscheduled.push(UnscheduledTask {
                    task_id: task.task_id, task_title: task.task_title,
                    reason: "任务时间范围不允许在当天安排".into(),
                    estimated_minutes: task.estimated_minutes,
                });
                continue;
            }
            if (end_limit - preferred_starts_at).num_minutes() < MIN_TASK_BLOCK_MINUTES {
                unscheduled.push(UnscheduledTask {
                    task_id: task.task_id, task_title: task.task_title,
                    reason: format!(
                        "当天允许时间不足 {MIN_TASK_BLOCK_MINUTES} 分钟；普通任务块至少需要 {MIN_TASK_BLOCK_MINUTES} 分钟"
                    ),
                    estimated_minutes: task.estimated_minutes,
                });
                continue;
            }
            let ends_at = (preferred_starts_at + Duration::minutes(preferred_task_minutes)).min(end_limit);
            if ends_at <= preferred_starts_at {
                unscheduled.push(UnscheduledTask {
                    task_id: task.task_id, task_title: task.task_title,
                    reason: "任务时间范围不允许在当天安排".into(),
                    estimated_minutes: task.estimated_minutes,
                });
                continue;
            }
            blocks.push(RulePlanBlock {
                task_id: task.task_id, task_title: task.task_title,
                starts_at: preferred_starts_at.to_rfc3339(), ends_at: ends_at.to_rfc3339(),
                estimated_minutes: (ends_at - preferred_starts_at).num_minutes(),
            });
        }
        self.store_rule_plan_draft(plan_date, blocks, unscheduled, base_plan_id)
    }

    pub fn preview_rule_based_plan(&mut self, plan_date: &str) -> AppResult<RulePlanPreview> {
        parse_plan_date(plan_date)?;
        let already_confirmed: bool = self.connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM daily_plans WHERE plan_date = ?1 AND status = 'confirmed')",
            [plan_date], |row| row.get(0),
        )?;
        if already_confirmed { return Err(AppError::Domain("当天已有已确认计划，请先在日历中调整现有时间块".into())); }
        self.build_rule_plan_draft(plan_date, None)
    }

    pub fn regenerate_confirmed_plan_adjustment(&mut self, plan_date: &str) -> AppResult<RulePlanPreview> {
        parse_plan_date(plan_date)?;
        let plan_id: String = self.connection.query_row(
            "SELECT id FROM daily_plans WHERE plan_date = ?1 AND status = 'confirmed'",
            [plan_date],
            |row| row.get(0),
        ).optional()?.ok_or_else(|| AppError::Domain("这一天还没有已确认计划".into()))?;
        let active_draft_id: Option<String> = self.connection.query_row(
            "SELECT id FROM daily_plan_drafts
             WHERE plan_date = ?1 AND status = 'active'",
            [plan_date],
            |row| row.get(0),
        ).optional()?;
        if let Some(preview_id) = active_draft_id {
            let timestamp = now();
            let transaction = self.connection.transaction()?;
            restore_rule_plan_draft_boundaries(
                &transaction,
                &preview_id,
                &timestamp,
                "plan_draft_regenerate",
                "重新安排前恢复任务时间",
            )?;
            transaction.commit()?;
        }
        self.build_rule_plan_draft(plan_date, Some(plan_id))
    }

    pub fn start_manual_plan_draft(&mut self, plan_date: &str) -> AppResult<RulePlanPreview> {
        parse_plan_date(plan_date)?;
        if let Some(preview) = self.get_rule_plan_draft(plan_date)? {
            return Ok(preview);
        }
        let has_confirmed_plan: bool = self.connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM daily_plans WHERE plan_date = ?1 AND status = 'confirmed')",
            [plan_date],
            |row| row.get(0),
        )?;
        if has_confirmed_plan {
            return self.start_confirmed_plan_adjustment(plan_date);
        }
        let unscheduled = self.rule_plan_candidates(plan_date, None)?.into_iter().map(|candidate| {
            let estimated_minutes = match candidate.estimated_minutes {
                Some(minutes) => {
                    let remaining = minutes - candidate.reserved_minutes;
                    Some(preferred_daily_task_minutes(
                        candidate.total_workload_minutes,
                        candidate.earliest_start_at.as_deref(),
                        candidate.due_at.as_deref(),
                    )?.map_or(remaining, |daily| daily.min(remaining)))
                }
                None => None,
            };
            Ok(UnscheduledTask {
                task_id: candidate.task_id,
                task_title: candidate.task_title,
                reason: if estimated_minutes.is_some() { "尚未排入当前计划" } else { "尚未填写预计时长" }.into(),
                estimated_minutes,
            })
        }).collect::<AppResult<Vec<_>>>()?;
        self.store_rule_plan_draft(plan_date, Vec::new(), unscheduled, None)
    }

    pub fn start_confirmed_plan_adjustment(&mut self, plan_date: &str) -> AppResult<RulePlanPreview> {
        let date = parse_plan_date(plan_date)?;
        let plan_id: String = self.connection.query_row(
            "SELECT id FROM daily_plans WHERE plan_date = ?1 AND status = 'confirmed'",
            [plan_date],
            |row| row.get(0),
        ).optional()?.ok_or_else(|| AppError::Domain("这一天还没有已确认计划".into()))?;
        let mut statement = self.connection.prepare(
            "SELECT pb.task_id, task.title, pb.starts_at, pb.ends_at
             FROM plan_blocks pb
             JOIN tasks task ON task.id = pb.task_id
             WHERE pb.daily_plan_id = ?1
               AND task.status <> 'deleted'
               AND pb.execution_status = 'planned'
               AND NOT EXISTS(SELECT 1 FROM review_entries review WHERE review.plan_block_id = pb.id)
             ORDER BY pb.starts_at",
        )?;
        let rows = statement.query_map([&plan_id], |row| Ok((
            row.get::<_, String>(0)?, row.get::<_, String>(1)?,
            row.get::<_, String>(2)?, row.get::<_, String>(3)?,
        )))?.collect::<Result<Vec<_>, _>>()?;
        drop(statement);
        let mut blocks = Vec::new();
        for (task_id, task_title, starts_at, ends_at) in rows {
            if self.get_task(&task_id)?.execution_locked { continue; }
            let start = crate::domain::parse_shanghai_timestamp(&starts_at)?;
            let end = crate::domain::parse_shanghai_timestamp(&ends_at)?;
            blocks.push(RulePlanBlock {
                task_id,
                task_title,
                starts_at,
                ends_at,
                estimated_minutes: (end - start).num_minutes(),
            });
        }

        let candidates = self.rule_plan_candidates(plan_date, None)?;
        let planned_task_ids = blocks.iter()
            .map(|block| block.task_id.as_str())
            .collect::<HashSet<_>>();

        let day_start = shanghai_timestamp(date, NaiveTime::from_hms_opt(0, 0, 0).unwrap())?;
        let day_end = shanghai_timestamp(
            date.succ_opt().ok_or_else(|| AppError::Domain("计划日期超出范围".into()))?,
            NaiveTime::from_hms_opt(0, 0, 0).unwrap(),
        )?;
        let unscheduled = candidates.into_iter()
            .filter(|candidate| !planned_task_ids.contains(candidate.task_id.as_str()))
            .map(|candidate| {
                let estimated_minutes = match candidate.estimated_minutes {
                    Some(minutes) => {
                        let schedulable_minutes = minutes - candidate.reserved_minutes;
                        Some(preferred_daily_task_minutes(
                            candidate.total_workload_minutes,
                            candidate.earliest_start_at.as_deref(),
                            candidate.due_at.as_deref(),
                        )?.map_or(schedulable_minutes, |daily| daily.min(schedulable_minutes)))
                    }
                    None => None,
                };
                let reason = if estimated_minutes.is_none() {
                    "尚未填写预计时长"
                } else if candidate.earliest_start_at.as_deref()
                    .map(crate::domain::parse_shanghai_timestamp).transpose()?
                    .is_some_and(|earliest| earliest >= day_end)
                {
                    "任务尚未到最早可开始日期，请选择有效日期或调整任务时间范围"
                } else if candidate.due_at.as_deref()
                    .map(crate::domain::parse_shanghai_timestamp).transpose()?
                    .is_some_and(|due| due <= day_start)
                {
                    "任务已超过截止时间，请调整任务时间范围后再安排"
                } else {
                    "尚未排入当前计划"
                };
                Ok(UnscheduledTask {
                    task_id: candidate.task_id,
                    task_title: candidate.task_title,
                    reason: reason.into(),
                    estimated_minutes,
                })
            }).collect::<AppResult<Vec<_>>>()?;

        self.store_rule_plan_draft(plan_date, blocks, unscheduled, Some(plan_id))
    }

    fn normalize_rule_plan_blocks(
        &self,
        plan_date: &str,
        blocks: Vec<RulePlanBlock>,
        _ignored_plan_id: Option<&str>,
    ) -> AppResult<Vec<RulePlanBlock>> {
        let date = parse_plan_date(plan_date)?;
        let day_start = shanghai_timestamp(date, NaiveTime::from_hms_opt(0, 0, 0).unwrap())?;
        let day_end = shanghai_timestamp(
            date.succ_opt().ok_or_else(|| AppError::Domain("计划日期超出范围".into()))?,
            NaiveTime::from_hms_opt(0, 0, 0).unwrap(),
        )?;
        let mut normalized = Vec::with_capacity(blocks.len());
        for mut block in blocks {
            ensure_task_content_editable(&self.get_task(&block.task_id)?)?;
            let task = self.load_task(&block.task_id)?;
            if !matches!(task.status, TaskStatus::Open | TaskStatus::Scheduled) {
                return Err(AppError::Domain(format!("{} 已不再是可安排任务，请重新生成草案", task.title)));
            }
            let starts_at = crate::domain::parse_shanghai_timestamp(&block.starts_at)?;
            let ends_at = crate::domain::parse_shanghai_timestamp(&block.ends_at)?;
            if ends_at <= starts_at { return Err(AppError::Domain("结束时间必须晚于开始时间".into())); }
            let block_minutes = (ends_at - starts_at).num_minutes();
            if block_minutes < MIN_TASK_BLOCK_MINUTES {
                return Err(AppError::Domain(format!(
                    "普通任务块至少需要 {MIN_TASK_BLOCK_MINUTES} 分钟"
                )));
            }
            if starts_at < day_start || ends_at > day_end {
                return Err(AppError::Domain("时间块必须完整位于计划日期内".into()));
            }
            let earliest = task.earliest_start_at.as_deref()
                .map(crate::domain::parse_shanghai_timestamp).transpose()?;
            let due = task.due_at.as_deref()
                .map(crate::domain::parse_shanghai_timestamp).transpose()?;
            let single_day = can_sync_single_day_task(&self.connection, &block.task_id,
                task.earliest_start_at.as_deref(), task.due_at.as_deref())?;
            if !single_day && earliest.is_some_and(|value| starts_at < value) {
                return Err(AppError::Domain(format!("{} 不能早于任务的最早开始时间", task.title)));
            }
            if !single_day && due.is_some_and(|value| ends_at > value) {
                return Err(AppError::Domain(format!("{} 不能晚于任务的截止时间", task.title)));
            }
            block.task_title = task.title;
            block.estimated_minutes = block_minutes;
            normalized.push(block);
        }
        Ok(normalized)
    }

    fn normalize_rule_plan_draft_update(
        &self,
        plan_date: &str,
        blocks: Vec<RulePlanBlock>,
    ) -> AppResult<(Vec<RulePlanBlock>, Vec<TaskBoundaryExpansion>)> {
        let date = parse_plan_date(plan_date)?;
        let day_start = shanghai_timestamp(date, NaiveTime::from_hms_opt(0, 0, 0).unwrap())?;
        let day_end = shanghai_timestamp(
            date.succ_opt().ok_or_else(|| AppError::Domain("计划日期超出范围".into()))?,
            NaiveTime::from_hms_opt(0, 0, 0).unwrap(),
        )?;
        let mut normalized = Vec::with_capacity(blocks.len());
        let mut expansions = HashMap::<String, TaskBoundaryExpansion>::new();
        for mut block in blocks {
            ensure_task_content_editable(&self.get_task(&block.task_id)?)?;
            let task = self.load_task(&block.task_id)?;
            if !matches!(task.status, TaskStatus::Open | TaskStatus::Scheduled) {
                return Err(AppError::Domain(format!("{} 已不再是可安排任务，请重新生成草案", task.title)));
            }
            let starts_at = crate::domain::parse_shanghai_timestamp(&block.starts_at)?;
            let ends_at = crate::domain::parse_shanghai_timestamp(&block.ends_at)?;
            if ends_at <= starts_at { return Err(AppError::Domain("结束时间必须晚于开始时间".into())); }
            let block_minutes = (ends_at - starts_at).num_minutes();
            if block_minutes < MIN_TASK_BLOCK_MINUTES {
                return Err(AppError::Domain(format!(
                    "普通任务块至少需要 {MIN_TASK_BLOCK_MINUTES} 分钟"
                )));
            }
            if starts_at < day_start || ends_at > day_end {
                return Err(AppError::Domain("时间块必须完整位于计划日期内".into()));
            }

            let earliest = task.earliest_start_at.as_deref()
                .map(crate::domain::parse_shanghai_timestamp).transpose()?;
            let due = task.due_at.as_deref()
                .map(crate::domain::parse_shanghai_timestamp).transpose()?;
            let single_day = can_sync_single_day_task(&self.connection, &block.task_id,
                task.earliest_start_at.as_deref(), task.due_at.as_deref())?;
            if !single_day && (earliest.is_some_and(|value| starts_at < value)
                || due.is_some_and(|value| ends_at > value))
            {
                let expansion = expansions.entry(block.task_id.clone()).or_insert_with(|| TaskBoundaryExpansion {
                    task_id: block.task_id.clone(),
                    old_earliest_start_at: task.earliest_start_at.clone(),
                    new_earliest_start_at: task.earliest_start_at.clone(),
                    old_due_at: task.due_at.clone(),
                    new_due_at: task.due_at.clone(),
                });
                if earliest.is_some_and(|value| starts_at < value)
                    && expansion.new_earliest_start_at.as_deref()
                        .map(crate::domain::parse_shanghai_timestamp).transpose()?
                        .is_some_and(|value| starts_at < value)
                {
                    expansion.new_earliest_start_at = Some(block.starts_at.clone());
                }
                if due.is_some_and(|value| ends_at > value)
                    && expansion.new_due_at.as_deref()
                        .map(crate::domain::parse_shanghai_timestamp).transpose()?
                        .is_some_and(|value| ends_at > value)
                {
                    expansion.new_due_at = Some(block.ends_at.clone());
                }
            }
            block.task_title = task.title;
            block.estimated_minutes = block_minutes;
            normalized.push(block);
        }
        let mut expansions = expansions.into_values().collect::<Vec<_>>();
        expansions.sort_by(|left, right| left.task_id.cmp(&right.task_id));
        Ok((normalized, expansions))
    }

    pub fn update_rule_plan_draft(
        &mut self,
        preview_id: &str,
        expected_version: i64,
        blocks: Vec<RulePlanBlock>,
        mut unscheduled: Vec<UnscheduledTask>,
    ) -> AppResult<RulePlanPreview> {
        let stored = load_rule_plan_draft_by_id(&self.connection, preview_id)?
            .ok_or_else(|| AppError::NotFound(format!("日计划草案 {preview_id}")))?;
        if stored.status != "active" || stored.preview.version != expected_version {
            return Err(AppError::Domain("草案已被更新、确认或放弃，请重新读取".into()));
        }
        if self.rule_plan_facts_json(&stored.preview.plan_date)? != stored.facts_json {
            return Err(AppError::Domain("任务或日计划已经变化，请重新生成计划草案".into()));
        }
        let previous_ids = stored.preview.blocks.iter().map(|block| block.task_id.as_str())
            .chain(stored.preview.unscheduled.iter().map(|item| item.task_id.as_str()))
            .collect::<HashSet<_>>();
        let next_ids = blocks.iter().map(|block| block.task_id.as_str())
            .chain(unscheduled.iter().map(|item| item.task_id.as_str()))
            .collect::<HashSet<_>>();
        if previous_ids != next_ids {
            return Err(AppError::Domain("草案更新必须保留原有任务；可将任务移到未排入列表".into()));
        }
        let unscheduled_ids = unscheduled.iter().map(|item| item.task_id.as_str()).collect::<HashSet<_>>();
        if unscheduled_ids.len() != unscheduled.len() {
            return Err(AppError::Domain("同一任务只能有一条未排入记录".into()));
        }
        let (blocks, boundary_expansions) = self.normalize_rule_plan_draft_update(
            &stored.preview.plan_date,
            blocks,
        )?;
        remove_automatic_duplicates_already_in_plan(&blocks, &mut unscheduled);
        for item in &mut unscheduled {
            let task = self.load_task(&item.task_id)?;
            if !matches!(task.status, TaskStatus::Open | TaskStatus::Scheduled) {
                return Err(AppError::Domain(format!("{} 已不再是可安排任务，请重新生成草案", task.title)));
            }
            item.task_title = task.title;
            if item.reason.trim().is_empty() { item.reason = "手动移出今日".into(); }
        }
        let confirmation_token = Uuid::new_v4().to_string();
        let timestamp = now();
        let blocks_json = serde_json::to_string(&blocks)?;
        let unscheduled_json = serde_json::to_string(&unscheduled)?;
        let transaction = self.connection.transaction()?;
        for expansion in boundary_expansions {
            let current = load_task_dto_in_transaction(&transaction, &expansion.task_id)?;
            if current.earliest_start_at != expansion.old_earliest_start_at
                || current.due_at != expansion.old_due_at
            {
                return Err(AppError::Domain("任务时间已经变化，请重新打开草案后再调整".into()));
            }
            if expansion.old_earliest_start_at != expansion.new_earliest_start_at {
                record_task_change(
                    &transaction,
                    &expansion.task_id,
                    "earliest_start_changed",
                    expansion.old_earliest_start_at.as_deref(),
                    expansion.new_earliest_start_at.as_deref(),
                    "plan_draft",
                    Some("调整计划草案时间"),
                )?;
            }
            if expansion.old_due_at != expansion.new_due_at {
                record_task_change(
                    &transaction,
                    &expansion.task_id,
                    "due_changed",
                    expansion.old_due_at.as_deref(),
                    expansion.new_due_at.as_deref(),
                    "plan_draft",
                    Some("调整计划草案时间"),
                )?;
            }
            transaction.execute(
                "INSERT INTO daily_plan_draft_task_boundaries (
                    draft_id, task_id, original_earliest_start_at, original_due_at,
                    applied_earliest_start_at, applied_due_at, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
                 ON CONFLICT(draft_id, task_id) DO UPDATE SET
                    applied_earliest_start_at = excluded.applied_earliest_start_at,
                    applied_due_at = excluded.applied_due_at,
                    updated_at = excluded.updated_at",
                params![
                    preview_id,
                    expansion.task_id,
                    expansion.old_earliest_start_at,
                    expansion.old_due_at,
                    expansion.new_earliest_start_at,
                    expansion.new_due_at,
                    timestamp,
                ],
            )?;
            let (earliest_start_date, earliest_start_time) =
                split_legacy_timestamp(expansion.new_earliest_start_at.as_deref());
            let (due_date, due_time) = split_legacy_timestamp(expansion.new_due_at.as_deref());
            transaction.execute(
                "UPDATE tasks
                 SET earliest_start_at = ?2, due_at = ?3,
                     earliest_start_date = ?4, earliest_start_time = ?5,
                     due_date = ?6, due_time = ?7, updated_at = ?8
                 WHERE id = ?1",
                params![
                    expansion.task_id,
                    expansion.new_earliest_start_at,
                    expansion.new_due_at,
                    earliest_start_date,
                    earliest_start_time,
                    due_date,
                    due_time,
                    timestamp,
                ],
            )?;
        }
        let facts_json = rule_plan_facts_json_from_connection(&transaction, &stored.preview.plan_date)?;
        let changed = transaction.execute(
            "UPDATE daily_plan_drafts
             SET blocks_json = ?3, unscheduled_json = ?4, version = version + 1,
                 confirmation_token = ?5, facts_json = ?6, updated_at = ?7
             WHERE id = ?1 AND version = ?2 AND status = 'active'",
            params![
                preview_id,
                expected_version,
                blocks_json,
                unscheduled_json,
                confirmation_token,
                facts_json,
                timestamp,
            ],
        )?;
        if changed != 1 { return Err(AppError::Domain("草案已被更新、确认或放弃，请重新读取".into())); }
        transaction.commit()?;
        Ok(load_rule_plan_draft_by_id(&self.connection, preview_id)?
            .ok_or_else(|| AppError::NotFound(format!("日计划草案 {preview_id}")))?.preview)
    }

    pub fn discard_rule_plan_draft(
        &mut self,
        preview_id: &str,
        expected_version: i64,
    ) -> AppResult<RulePlanDraftDiscardResult> {
        let stored = load_rule_plan_draft_by_id(&self.connection, preview_id)?
            .ok_or_else(|| AppError::NotFound(format!("日计划草案 {preview_id}")))?;
        if stored.status != "active" || stored.preview.version != expected_version {
            return Err(AppError::Domain("草案已被更新、确认或放弃，请重新读取".into()));
        }

        let timestamp = now();
        let transaction = self.connection.transaction()?;
        let result = restore_rule_plan_draft_boundaries(
            &transaction,
            preview_id,
            &timestamp,
            "plan_draft_discard",
            "放弃计划草案",
        )?;

        let changed = transaction.execute(
            "UPDATE daily_plan_drafts SET status = 'discarded', version = version + 1, updated_at = ?3
             WHERE id = ?1 AND version = ?2 AND status = 'active'",
            params![preview_id, expected_version, timestamp],
        )?;
        if changed != 1 { return Err(AppError::Domain("草案已被更新、确认或放弃，请重新读取".into())); }
        transaction.commit()?;
        Ok(result)
    }

    pub fn confirm_rule_based_plan(&mut self, preview: RulePlanPreview) -> AppResult<DayScheduleDto> {
        let stored = load_rule_plan_draft_by_id(&self.connection, &preview.preview_id)?
            .ok_or_else(|| AppError::NotFound(format!("日计划草案 {}", preview.preview_id)))?;
        if stored.status != "active"
            || stored.preview.version != preview.version
            || stored.preview.confirmation_token != preview.confirmation_token
        {
            return Err(AppError::InvalidConfirmation);
        }
        let preview = stored.preview;
        parse_plan_date(&preview.plan_date)?;
        if preview.blocks.is_empty() && preview.base_plan_id.is_none() {
            return Err(AppError::Domain("空计划无需确认".into()));
        }
        if self.rule_plan_facts_json(&preview.plan_date)? != stored.facts_json {
            return Err(AppError::Domain("草案已过期：任务或日计划发生变化，请重新生成".into()));
        }
        let normalized = self.normalize_rule_plan_blocks(
            &preview.plan_date,
            preview.blocks.clone(),
            preview.base_plan_id.as_deref(),
        )?;
        let proposed = normalized.iter().map(|block| crate::domain::ProposedPlanBlock {
            task_id: block.task_id.clone(), starts_at: block.starts_at.clone(), ends_at: block.ends_at.clone(),
            source: crate::domain::ProposalSource::RuleBased,
        }).collect::<Vec<_>>();
        let transaction = self.connection.transaction()?;
        let proposed_task_ids = proposed.iter().map(|block| block.task_id.clone()).collect::<Vec<_>>();
        let (plan_id, plan_source, created_new_plan, before_blocks, before_task_ids) = if let Some(base_plan_id) = &preview.base_plan_id {
            let source: String = transaction.query_row(
                "SELECT source FROM daily_plans WHERE id = ?1 AND plan_date = ?2 AND status = 'confirmed'",
                params![base_plan_id, preview.plan_date], |row| row.get(0),
            ).optional()?.ok_or_else(|| AppError::Domain("原计划已变化或已有执行记录，请放弃草案并重新读取".into()))?;
            let blocks = load_replaceable_plan_blocks(&transaction, base_plan_id)?;
            let mut task_ids = blocks.iter().map(|block| block.task_id.clone()).collect::<Vec<_>>();
            task_ids.extend(proposed_task_ids.iter().cloned());
            task_ids.sort();
            task_ids.dedup();
            (base_plan_id.clone(), source, false, blocks, task_ids)
        } else {
            let mut task_ids = proposed_task_ids.clone();
            task_ids.sort();
            task_ids.dedup();
            (Uuid::new_v4().to_string(), "rule_based".to_string(), true, Vec::new(), task_ids)
        };
        let before_tasks = load_plan_task_states(&transaction, &before_task_ids)?;
        let mut before_single_day_tasks = Vec::new();
        let mut single_day_schedule_undo = Vec::new();
        for block in &normalized {
            let task = load_task_dto_in_transaction(&transaction, &block.task_id)?;
            if can_sync_single_day_task(&transaction, &task.id, task.earliest_start_at.as_deref(), task.due_at.as_deref())? {
                if normalized.iter().filter(|item| item.task_id == task.id).count() != 1 {
                    return Err(AppError::Domain("单日任务只能有一个任务块；拆分安排请使用跨日任务".into()));
                }
                let before_schedule = load_task_schedule_blocks(&transaction, &task.id)?;
                for old in before_schedule.iter().filter(|old| old.plan_id != plan_id) {
                    transaction.execute("DELETE FROM plan_blocks WHERE id = ?1", [&old.block.id])?;
                }
                single_day_schedule_undo.push(TaskScheduleUndo {
                    task: Some(task.clone()), before_blocks: before_schedule, after_blocks: Vec::new(),
                });
                before_single_day_tasks.push(task);
                set_single_day_task_times(&transaction, &block.task_id, &block.starts_at, &block.ends_at)?;
            }
        }
        if let Some(base_plan_id) = &preview.base_plan_id {
            let replaceable: bool = transaction.query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM daily_plans dp
                    WHERE dp.id = ?1 AND dp.plan_date = ?2 AND dp.status = 'confirmed'
                 )",
                params![base_plan_id, preview.plan_date],
                |row| row.get(0),
            )?;
            if !replaceable {
                return Err(AppError::Domain("原计划已变化或已有执行记录，请放弃草案并重新读取".into()));
            }
            replace_confirmed_plan_blocks(&transaction, base_plan_id, &proposed)?;
        } else {
            let exists: bool = transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM daily_plans WHERE plan_date = ?1 AND status = 'confirmed')",
                [&preview.plan_date], |row| row.get(0),
            )?;
            if exists { return Err(AppError::Domain("草案已过期：当天已有已确认计划".into())); }
            insert_confirmed_plan_with_id(&transaction, &plan_id, &preview.plan_date, &proposed, "rule_based")?;
        }
        let changed = transaction.execute(
            "UPDATE daily_plan_drafts
             SET status = 'confirmed', confirmed_at = ?4, updated_at = ?4
             WHERE id = ?1 AND version = ?2 AND confirmation_token = ?3 AND status = 'active'",
            params![preview.preview_id, preview.version, preview.confirmation_token, now()],
        )?;
        if changed != 1 { return Err(AppError::InvalidConfirmation); }
        transaction.execute(
            "DELETE FROM daily_plan_draft_task_boundaries WHERE draft_id = ?1",
            [&preview.preview_id],
        )?;
        let after_blocks = load_replaceable_plan_blocks(&transaction, &plan_id)?;
        let after_tasks = load_plan_task_states(&transaction, &before_task_ids)?;
        for snapshot in &mut single_day_schedule_undo {
            snapshot.after_blocks = load_task_schedule_blocks(&transaction, &snapshot.task.as_ref().unwrap().id)?;
        }
        let undo_payload = PlanUndoPayload {
            plan_date: preview.plan_date.clone(), plan_source, created_new_plan,
            before_blocks, before_tasks, after_blocks, after_tasks, before_single_day_tasks, single_day_schedule_undo,
        };
        record_undo_entry(
            &transaction,
            if created_new_plan { "plan_created" } else { "plan_updated" },
            "daily_plan", &plan_id, &serde_json::to_string(&undo_payload)?, None,
        )?;
        transaction.commit()?;
        self.get_day_schedule(&preview.plan_date)
    }

    pub fn update_plan_block_time(&mut self, input: PlanBlockTimeUpdate) -> AppResult<DayScheduleDto> {
        let date = parse_plan_date(&input.plan_date)?;
        if input.plan_date < shanghai_today() {
            return Err(AppError::Domain("过去日期的安排只可查看".into()));
        }
        let start = crate::domain::parse_shanghai_timestamp(&input.starts_at)?;
        let end = crate::domain::parse_shanghai_timestamp(&input.ends_at)?;
        let day_start = shanghai_timestamp(date, NaiveTime::from_hms_opt(0, 0, 0).unwrap())?;
        let day_end = shanghai_timestamp(date.succ_opt().ok_or_else(|| AppError::Domain("计划日期超出范围".into()))?, NaiveTime::from_hms_opt(0, 0, 0).unwrap())?;
        if start < day_start || end > day_end {
            return Err(AppError::Domain("时间块必须完整位于计划日期内".into()));
        }
        if (end - start).num_minutes() < MIN_TASK_BLOCK_MINUTES {
            return Err(AppError::Domain("普通任务块至少需要 15 分钟，且结束时间必须晚于开始时间".into()));
        }
        let transaction = self.connection.transaction()?;
        if load_rule_plan_draft_for_date(&transaction, &input.plan_date)?.is_some() {
            return Err(AppError::Domain("这一天已有计划草案，请先保存或放弃草案，再单独修改正式安排".into()));
        }
        let (task_id, original_start, original_end, editable): (String, String, String, bool) = transaction.query_row(
            "SELECT pb.task_id, pb.starts_at, pb.ends_at,
                    pb.execution_status = 'planned' AND pb.execution_captured_at IS NULL
                    AND COALESCE(pb.actual_minutes, 0) = 0
                    AND NOT EXISTS(SELECT 1 FROM review_entries review WHERE review.plan_block_id = pb.id)
             FROM plan_blocks pb JOIN daily_plans dp ON dp.id = pb.daily_plan_id
             WHERE pb.id = ?1 AND dp.plan_date = ?2 AND dp.status = 'confirmed'",
            params![input.block_id, input.plan_date], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        ).optional()?.ok_or_else(|| AppError::Domain("这项安排已经变化，请重新打开后再调整".into()))?;
        if !editable {
            return Err(AppError::Domain("该时间块已有执行或复盘记录，不能调整时间".into()));
        }
        if original_start != input.expected_starts_at || original_end != input.expected_ends_at {
            return Err(AppError::Domain("时间已经被修改，请重新打开后再调整".into()));
        }
        let task = load_task_dto_in_transaction(&transaction, &task_id)?;
        ensure_task_content_editable(&task)?;
        if original_start == input.starts_at && original_end == input.ends_at {
            transaction.commit()?;
            return self.get_day_schedule(&input.plan_date);
        }
        crate::domain::validate_complete_task_timestamps(&task.earliest_start_at, &task.due_at)?;
        let before_blocks = load_task_schedule_blocks(&transaction, &task_id)?;
        let current_drafts = current_plan_draft_dates(&transaction)?;
        if can_sync_single_day_task(&transaction, &task_id, task.earliest_start_at.as_deref(), task.due_at.as_deref())? {
            set_single_day_task_times(&transaction, &task_id, &input.starts_at, &input.ends_at)?;
            let followup = database_execution::has_followup(&transaction, &task_id)?;
            for old in before_blocks.iter().filter(|old| old.block.id != input.block_id
                && (!followup || old.plan_date >= shanghai_today())) {
                transaction.execute("DELETE FROM plan_blocks WHERE id = ?1", [&old.block.id])?;
            }
        } else {
            // Cross-day and split tasks keep their overall range unless the selected block expands it.
            let earliest = task.earliest_start_at.as_deref().unwrap();
            let due = task.due_at.as_deref().unwrap();
            let next_earliest = if start < crate::domain::parse_shanghai_timestamp(earliest)? { input.starts_at.as_str() } else { earliest };
            let next_due = if end > crate::domain::parse_shanghai_timestamp(due)? { input.ends_at.as_str() } else { due };
            record_optional_change(&transaction, &task_id, "earliest_start_changed", Some(earliest), Some(next_earliest))?;
            record_optional_change(&transaction, &task_id, "due_changed", Some(due), Some(next_due))?;
            let (earliest_date, earliest_time) = split_legacy_timestamp(Some(next_earliest));
            let (due_date, due_time) = split_legacy_timestamp(Some(next_due));
            transaction.execute(
                "UPDATE tasks SET earliest_start_at = ?2, due_at = ?3, earliest_start_date = ?4,
                    earliest_start_time = ?5, due_date = ?6, due_time = ?7, updated_at = ?8 WHERE id = ?1",
                params![task_id, next_earliest, next_due, earliest_date, earliest_time, due_date, due_time, now()],
            )?;
        }
        transaction.execute(
            "UPDATE plan_blocks SET starts_at = ?2, ends_at = ?3, source = 'manual', updated_at = ?4 WHERE id = ?1",
            params![input.block_id, input.starts_at, input.ends_at, now()],
        )?;
        record_task_change(&transaction, &task_id, "plan_block_time_changed", Some(&original_start), Some(&input.starts_at), "manual", Some("单独保存任务块时间"))?;
        if single_day_range(task.earliest_start_at.as_deref(), task.due_at.as_deref())?.is_some() {
            refresh_task_in_plan_drafts(&transaction, &task_id, &current_drafts)?;
        }
        let committed = load_task_dto_in_transaction(&transaction, &task_id)?;
        record_undo_entry(&transaction, "task_updated", "task", &task_id,
            &task_schedule_undo_json(&transaction, &task_id, Some(task), before_blocks)?, Some(&committed.updated_at))?;
        transaction.commit()?;
        self.get_day_schedule(&input.plan_date)
    }

    pub fn include_plan_task(&mut self, input: PlanTaskInclude) -> AppResult<DayScheduleDto> {
        let date = parse_plan_date(&input.plan_date)?;
        if input.plan_date < shanghai_today() {
            return Err(AppError::Domain("过去日期的安排只可查看".into()));
        }
        let day_start = shanghai_timestamp(date, NaiveTime::from_hms_opt(0, 0, 0).unwrap())?;
        let day_end = shanghai_timestamp(date.succ_opt().ok_or_else(|| AppError::Domain("计划日期超出范围".into()))?, NaiveTime::from_hms_opt(0, 0, 0).unwrap())?;
        let transaction = self.connection.transaction()?;
        if load_rule_plan_draft_for_date(&transaction, &input.plan_date)?.is_some() {
            return Err(AppError::Domain("这一天已有批量计划草案，请先确认或放弃草案".into()));
        }
        let task = load_task_dto_in_transaction(&transaction, &input.task_id)?;
        ensure_task_content_editable(&task)?;
        if !matches!(task.status.as_str(), "open" | "scheduled") {
            return Err(AppError::Domain("该任务当前不能加入时间线".into()));
        }
        if task.updated_at != input.expected_updated_at || task.reserved_minutes != input.expected_reserved_minutes {
            return Err(AppError::Domain("任务或安排已经变化，请刷新后再试".into()));
        }
        crate::domain::validate_complete_task_timestamps(&task.earliest_start_at, &task.due_at)?;
        let earliest = crate::domain::parse_shanghai_timestamp(task.earliest_start_at.as_deref().unwrap())?;
        let due = crate::domain::parse_shanghai_timestamp(task.due_at.as_deref().unwrap())?;
        let remaining = task.remaining_workload_minutes.or(task.estimated_minutes)
            .ok_or_else(|| AppError::Domain("请先补充任务预计工作量".into()))? - task.reserved_minutes;
        if input.blocks.is_empty() { return Err(AppError::Domain("没有可加入的时间块".into())); }
        let before_blocks = load_task_schedule_blocks(&transaction, &task.id)?;
        let mut ranges = before_blocks.iter().map(|old| Ok((
            crate::domain::parse_shanghai_timestamp(&old.block.starts_at)?,
            crate::domain::parse_shanghai_timestamp(&old.block.ends_at)?,
        ))).collect::<AppResult<Vec<_>>>()?;
        let mut minutes = 0;
        for block in &input.blocks {
            let start = crate::domain::parse_shanghai_timestamp(&block.starts_at)?;
            let end = crate::domain::parse_shanghai_timestamp(&block.ends_at)?;
            let duration = (end - start).num_minutes();
            if block.task_id != task.id || start < day_start || end > day_end
                || start < earliest || end > due || duration < MIN_TASK_BLOCK_MINUTES {
                return Err(AppError::Domain("时间块必须在任务当天的有效范围内，且至少 15 分钟".into()));
            }
            if ranges.iter().any(|(other_start, other_end)| start < *other_end && end > *other_start) {
                return Err(AppError::Domain("同一任务的时间块不能重复安排".into()));
            }
            ranges.push((start, end));
            minutes += duration;
        }
        if minutes > remaining {
            return Err(AppError::Domain("新增安排超出任务剩余待安排工作量，请刷新后再试".into()));
        }
        let plan_id = transaction.query_row(
            "SELECT id FROM daily_plans WHERE plan_date = ?1 AND status = 'confirmed'", [&input.plan_date], |row| row.get::<_, String>(0),
        ).optional()?.unwrap_or_else(|| Uuid::new_v4().to_string());
        transaction.execute(
            "INSERT OR IGNORE INTO daily_plans (id, plan_date, status, source, created_at, confirmed_at)
             VALUES (?1, ?2, 'confirmed', 'manual', ?3, ?3)", params![plan_id, input.plan_date, now()],
        )?;
        // A single-day task with one block keeps the task editor and timeline in sync.
        if input.blocks.len() == 1 && before_blocks.is_empty()
            && can_sync_single_day_task(&transaction, &task.id, task.earliest_start_at.as_deref(), task.due_at.as_deref())? {
            set_single_day_task_times(&transaction, &task.id, &input.blocks[0].starts_at, &input.blocks[0].ends_at)?;
        }
        for block in &input.blocks {
            transaction.execute(
                "INSERT INTO plan_blocks (id, daily_plan_id, task_id, starts_at, ends_at, source, review_required, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'manual', 1, ?6, ?6)",
                params![Uuid::new_v4().to_string(), plan_id, task.id, block.starts_at, block.ends_at, now()],
            )?;
        }
        if task.status == "open" { set_task_status(&transaction, &task.id, TaskStatus::Scheduled, "manual")?; }
        transaction.execute("UPDATE tasks SET updated_at = ?2 WHERE id = ?1", params![task.id, now()])?;
        record_task_change(&transaction, &task.id, "plan_blocks_added", None, Some(&input.plan_date), "manual", None)?;
        let committed = load_task_dto_in_transaction(&transaction, &task.id)?;
        record_undo_entry(&transaction, "task_updated", "task", &task.id,
            &task_schedule_undo_json(&transaction, &task.id, Some(task.clone()), before_blocks)?, Some(&committed.updated_at))?;
        transaction.commit()?;
        self.get_day_schedule(&input.plan_date)
    }

    pub fn remove_plan_block(&mut self, input: PlanBlockRemove) -> AppResult<DayScheduleDto> {
        parse_plan_date(&input.plan_date)?;
        if input.plan_date < shanghai_today() { return Err(AppError::Domain("过去日期的安排只可查看".into())); }
        let transaction = self.connection.transaction()?;
        if load_rule_plan_draft_for_date(&transaction, &input.plan_date)?.is_some() {
            return Err(AppError::Domain("这一天已有批量计划草案，请先确认或放弃草案".into()));
        }
        let task_id: String = transaction.query_row(
            "SELECT pb.task_id FROM plan_blocks pb JOIN daily_plans dp ON dp.id = pb.daily_plan_id
             WHERE pb.id = ?1 AND dp.plan_date = ?2 AND dp.status = 'confirmed'",
            params![input.block_id, input.plan_date], |row| row.get(0),
        ).optional()?.ok_or_else(|| AppError::Domain("这项安排已经变化，请刷新后再试".into()))?;
        let task = load_task_dto_in_transaction(&transaction, &task_id)?;
        ensure_task_content_editable(&task)?;
        let before_blocks = load_task_schedule_blocks(&transaction, &task_id)?;
        let block = before_blocks.iter().find(|old| old.block.id == input.block_id)
            .ok_or_else(|| AppError::Domain("该时间块已有执行或复盘记录，不能移除".into()))?;
        if block.block.starts_at != input.expected_starts_at || block.block.ends_at != input.expected_ends_at {
            return Err(AppError::Domain("这项安排时间已经变化，请刷新后再试".into()));
        }
        transaction.execute("DELETE FROM plan_blocks WHERE id = ?1", [&input.block_id])?;
        let still_scheduled: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM plan_blocks pb JOIN daily_plans dp ON dp.id = pb.daily_plan_id
             WHERE pb.task_id = ?1 AND dp.status = 'confirmed')", [&task_id], |row| row.get(0),
        )?;
        if !still_scheduled && task.status == "scheduled" { set_task_status(&transaction, &task_id, TaskStatus::Open, "manual")?; }
        transaction.execute("UPDATE tasks SET updated_at = ?2 WHERE id = ?1", params![task_id, now()])?;
        record_task_change(&transaction, &task_id, "plan_block_removed", Some(&input.block_id), None, "manual", None)?;
        let committed = load_task_dto_in_transaction(&transaction, &task_id)?;
        record_undo_entry(&transaction, "task_updated", "task", &task_id,
            &task_schedule_undo_json(&transaction, &task_id, Some(task), before_blocks)?, Some(&committed.updated_at))?;
        transaction.commit()?;
        self.get_day_schedule(&input.plan_date)
    }

    pub fn get_day_schedule(&self, plan_date: &str) -> AppResult<DayScheduleDto> {
        let date = parse_plan_date(plan_date)?;
        let day_start = shanghai_timestamp(date, NaiveTime::from_hms_opt(0, 0, 0).unwrap())?.to_rfc3339();
        let day_end = shanghai_timestamp(date.succ_opt().ok_or_else(|| AppError::Domain("计划日期超出范围".into()))?, NaiveTime::from_hms_opt(0, 0, 0).unwrap())?.to_rfc3339();
        let fixed_events = self.list_calendar_events(&day_start, &day_end)?;
        let plan: Option<(String, String, String)> = self.connection.query_row(
            "SELECT id, status, source FROM daily_plans WHERE plan_date = ?1 AND status = 'confirmed' ORDER BY confirmed_at DESC LIMIT 1",
            [plan_date], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).optional()?;
        let mut task_blocks = Vec::new();
        if let Some((plan_id, _, _)) = &plan {
            let mut statement = self.connection.prepare(
                "SELECT pb.id, pb.daily_plan_id, pb.task_id, task.title, task.status, pb.starts_at, pb.ends_at, pb.source,
                        pb.execution_status, pb.actual_minutes, pb.review_required, task.remaining_workload_minutes,
                        pb.execution_note, pb.execution_captured_at,
                        review.id, review.review_date, review.plan_block_id, review.task_id, review.outcome,
                        review.actual_minutes, review.defer_reason, review.notes, review.remaining_workload_minutes,
                        review.created_at, review.updated_at, review.followup_action, pb.result_date, pb.result_ends_at
                 FROM plan_blocks pb JOIN tasks task ON task.id = pb.task_id
                 LEFT JOIN review_entries review ON review.plan_block_id = pb.id
                 WHERE pb.daily_plan_id = ?1
                 ORDER BY pb.starts_at",
            )?;
            task_blocks = statement.query_map([plan_id], |row| {
                let review_id: Option<String> = row.get(14)?;
                let review = if let Some(id) = review_id {
                    Some(ReviewEntryDto {
                        id,
                        review_date: row.get(15)?,
                        plan_block_id: row.get(16)?,
                        task_id: row.get(17)?,
                        outcome: row.get(18)?,
                        actual_minutes: row.get(19)?,
                        defer_reason: row.get(20)?,
                        notes: row.get(21)?,
                        remaining_workload_minutes: row.get(22)?,
                        created_at: row.get(23)?,
                        updated_at: row.get(24)?,
                        followup_action: row.get(25)?,
                    })
                } else {
                    None
                };
                Ok(PlanBlockDto {
                    id: row.get(0)?, daily_plan_id: row.get(1)?, task_id: row.get(2)?, task_title: row.get(3)?,
                    task_status: row.get(4)?, starts_at: row.get(5)?, ends_at: row.get(6)?, source: row.get(7)?,
                    execution_status: row.get(8)?, actual_minutes: row.get(9)?,
                    review_required: row.get::<_, i64>(10)? != 0,
                    remaining_workload_minutes: row.get(11)?, execution_note: row.get(12)?,
                    execution_captured_at: row.get(13)?, review,
                    result_date: row.get(26)?, result_ends_at: row.get(27)?,
                })
            })?.collect::<Result<Vec<_>, _>>()?;
        }
        Ok(DayScheduleDto {
            plan_id: plan.as_ref().map(|value| value.0.clone()),
            plan_status: plan.as_ref().map(|value| value.1.clone()),
            plan_source: plan.as_ref().map(|value| value.2.clone()),
            fixed_events, task_blocks,
        })
    }

    pub fn save_execution_capture(&mut self, capture_date: &str, mut input: ExecutionCaptureInput) -> AppResult<()> {
        input.note = normalize_review_text(input.note, 500, "执行备注")?;
        let transaction = self.connection.transaction()?;
        let (plan_date, task_status, has_review): (String, String, bool) = transaction
            .query_row(
                "SELECT dp.plan_date, CASE WHEN task.deleted_at IS NOT NULL THEN 'deleted' ELSE task.status END,
                        EXISTS(SELECT 1 FROM review_entries review WHERE review.plan_block_id = pb.id)
                 FROM plan_blocks pb
                 JOIN daily_plans dp ON dp.id = pb.daily_plan_id
                 JOIN tasks task ON task.id = pb.task_id
                 WHERE pb.id = ?1",
                [&input.plan_block_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound(format!("执行块 {}", input.plan_block_id)))?;
        if plan_date != capture_date {
            return Err(AppError::Domain("执行日期必须与执行块所属日期一致".into()));
        }
        let in_window = database_results::allow_capture(&transaction, capture_date, &input.plan_block_id)?;
        // A missing outcome means note-only: keep the current result and only update the note.
        let note_only = input.outcome.is_none();
        let outcome_str = if let Some(outcome) = input.outcome {
            outcome.as_str().to_string()
        } else {
            transaction.query_row(
                "SELECT COALESCE((SELECT outcome FROM review_entries WHERE plan_block_id = pb.id), pb.execution_status)
                 FROM plan_blocks pb WHERE pb.id = ?1",
                [&input.plan_block_id], |row| row.get::<_, String>(0),
            )?
        };
        if !note_only {
            database_results::require_block_outcome_change(&transaction, &input.plan_block_id, &outcome_str)?;
        }
        let task_id: String = transaction.query_row("SELECT task_id FROM plan_blocks WHERE id = ?1", [&input.plan_block_id], |row| row.get(0))?;
        let task = load_task_dto_in_transaction(&transaction, &task_id)?;
        if database_results::save_recycled_completion(&transaction, &task, capture_date,
            &input.plan_block_id, &outcome_str, input.note.as_deref())? {
            transaction.commit()?;
            return Ok(());
        }
        database_history::preserve_current(&transaction, &task_id)?;
        let before = execution_snapshot(&transaction, &input.plan_block_id)?;
        database_results::freeze_block(&transaction, &input.plan_block_id)?;
        if has_review {
            transaction.execute("UPDATE review_entries SET outcome = ?2, notes = ?3 WHERE plan_block_id = ?1",
                params![input.plan_block_id, &outcome_str, input.note])?;
        }
        let timestamp = now();
        transaction.execute(
            "UPDATE plan_blocks
             SET execution_status = ?2, execution_note = ?3, execution_captured_at = ?4,
                 review_required = CASE WHEN ?5 THEN review_required ELSE 1 END, updated_at = ?4
             WHERE id = ?1",
            params![input.plan_block_id, &outcome_str, input.note, timestamp, has_review],
        )?;
        if in_window {
            preserve_review_supplement_after_capture(&transaction, capture_date, &input.plan_block_id, before.execution_note.as_deref())?;
        } else {
            clear_review_draft(&transaction, capture_date, "task", &input.plan_block_id)?;
        }
        database_execution::sync_block_result(&transaction, &input.plan_block_id)?;
        if in_window && !has_review && !note_only && task_status != "done" {
            let payload = FactUndo { task: None, block: Some(before), occurrence: None, review: None,
                after_facts: fact_fingerprint(&transaction, "execution_capture", &task_id)? };
            record_undo_entry(&transaction, "execution_captured", "execution_capture", &task_id, &serde_json::to_string(&payload)?, None)?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn clear_execution_capture(&mut self, capture_date: &str, plan_block_id: &str) -> AppResult<()> {
        self.clear_execution_capture_with_note(capture_date, plan_block_id, None)
    }

    pub fn clear_execution_capture_with_note(&mut self, capture_date: &str, plan_block_id: &str, note: Option<String>) -> AppResult<()> {
        let note = normalize_review_text(note, 500, "执行备注")?;
        let transaction = self.connection.transaction()?;
        let in_window = database_results::allow_capture(&transaction, capture_date, plan_block_id)?;
        database_results::require_block_outcome_change(&transaction, plan_block_id, "planned")?;
        let task_id: String = transaction.query_row("SELECT task_id FROM plan_blocks WHERE id = ?1", [plan_block_id], |row| row.get(0))?;
        let task = load_task_dto_in_transaction(&transaction, &task_id)?;
        if task.deleted_at.is_some() || task.status == "deleted" { return Err(AppError::Domain("回收站任务不能取消结果".into())); }
        let (plan_date, execution_status, has_review): (String, String, bool) = transaction
            .query_row(
                "SELECT dp.plan_date, COALESCE((SELECT outcome FROM review_entries WHERE plan_block_id = pb.id), pb.execution_status),
                        EXISTS(SELECT 1 FROM review_entries review WHERE review.plan_block_id = pb.id)
                 FROM plan_blocks pb
                 JOIN daily_plans dp ON dp.id = pb.daily_plan_id
                 WHERE pb.id = ?1",
                [plan_block_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound(format!("执行块 {plan_block_id}")))?;
        if plan_date != capture_date {
            return Err(AppError::Domain("执行日期必须与执行块所属日期一致".into()));
        }
        if has_review && execution_status != "completed" {
            return Err(AppError::Domain("该执行块已有未完成的最终复盘，不能撤销最终事实".into()));
        }
        if !matches!(execution_status.as_str(), "completed" | "not_started" | "partial" | "cancelled" | "blocked") {
            return Err(AppError::Domain("该执行块没有可取消的任务结果".into()));
        }
        let timestamp = now();
        database_execution::clear_block_capture(&transaction, &task_id, capture_date, plan_block_id, has_review)?;
        if let Some(note) = note {
            transaction.execute("UPDATE plan_blocks SET execution_note = ?2, execution_captured_at = ?3, review_required = 1 WHERE id = ?1",
                params![plan_block_id, note, timestamp])?;
        }
        if in_window { transaction.execute("UPDATE tasks SET updated_at = ?2 WHERE id = ?1", params![task_id, timestamp])?; }
        database_history::record_cleared(&transaction, &task_id, capture_date, execution_status == "completed")?;
        if execution_status == "completed" {
            database_execution::sync_cleared_completion(&transaction, plan_block_id)?;
        } else {
            database_execution::sync_block_result(&transaction, plan_block_id)?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn save_review_entry(&mut self, review_date: &str, mut input: ReviewEntryInput) -> AppResult<ReviewEntryDto> {
        let is_today = review_date == shanghai_today();
        if input.actual_minutes.is_some_and(|minutes| minutes < 0) {
            return Err(AppError::Schema("实际耗时不能小于 0 分钟".into()));
        }
        if input.remaining_workload_minutes.is_some_and(|minutes| minutes < 0) {
            return Err(AppError::Schema("剩余工作量不能小于 0 分钟".into()));
        }
        input.defer_reason = normalize_review_text(input.defer_reason, 500, "延期原因")?;
        input.notes = normalize_review_text(input.notes, 2_000, "复盘备注")?;

        let transaction = self.connection.transaction()?;
        let (task_id, plan_date, task_status, current_remaining): (String, String, String, Option<i64>) = transaction
            .query_row(
                "SELECT pb.task_id, dp.plan_date, CASE WHEN task.deleted_at IS NOT NULL THEN 'deleted' ELSE task.status END, task.remaining_workload_minutes
                 FROM plan_blocks pb
                 JOIN daily_plans dp ON dp.id = pb.daily_plan_id
                 JOIN tasks task ON task.id = pb.task_id
                 WHERE pb.id = ?1",
                [&input.plan_block_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound(format!("执行块 {}", input.plan_block_id)))?;
        if plan_date != review_date {
            return Err(AppError::Domain("复盘日期必须与执行块所属日期一致".into()));
        }
        if task_status == TaskStatus::Deleted.as_str() {
            return Err(AppError::Domain("回收站任务不能新增执行事实".into()));
        }
        let already_saved: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM review_entries WHERE plan_block_id = ?1)",
            [&input.plan_block_id],
            |row| row.get(0),
        )?;
        let in_window = database_results::allow_capture(&transaction, review_date, &input.plan_block_id)?;
        database_results::require_block_outcome_change(&transaction, &input.plan_block_id, input.outcome.as_str())?;
        if !is_today && input.remaining_workload_minutes.is_some() {
            return Err(AppError::Domain("历史记录不能修改当前剩余工作量".into()));
        }
        if already_saved {
            let (actual, reason, remaining): (Option<i64>, Option<String>, Option<i64>) = transaction.query_row(
                "SELECT actual_minutes, defer_reason, remaining_workload_minutes FROM review_entries WHERE plan_block_id = ?1",
                [&input.plan_block_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?;
            if input.actual_minutes.is_some_and(|value| Some(value) != actual)
                || input.defer_reason.as_ref().is_some_and(|value| Some(value) != reason.as_ref())
                || input.remaining_workload_minutes.is_some_and(|value| Some(value) != remaining) {
                return Err(AppError::Domain("已保存的独立复盘详情不能被结果修改覆盖".into()));
            }
            database_history::preserve_current(&transaction, &task_id)?;
            transaction.execute("UPDATE review_entries SET outcome = ?2, notes = ?3 WHERE plan_block_id = ?1",
                params![input.plan_block_id, input.outcome.as_str(), input.notes])?;
            transaction.execute("UPDATE plan_blocks SET execution_status = ?2, execution_note = ?3,
                execution_captured_at = ?4, updated_at = ?4 WHERE id = ?1",
                params![input.plan_block_id, input.outcome.as_str(), input.notes, now()])?;
            if !in_window {
                clear_review_draft(&transaction, review_date, "task", &input.plan_block_id)?;
            }
            database_execution::sync_block_result(&transaction, &input.plan_block_id)?;
            transaction.commit()?;
            return self.get_review_entry_for_block(&input.plan_block_id);
        }
        database_history::preserve_current(&transaction, &task_id)?;
        database_results::freeze_block(&transaction, &input.plan_block_id)?;
        if is_today && task_status == TaskStatus::Done.as_str()
            && input.remaining_workload_minutes.is_some_and(|minutes| minutes > 0)
        {
            return Err(AppError::Domain("已完成任务的剩余工作量必须为 0".into()));
        }

        // Historical details belong only to this block; existing review details are immutable above.
        let credited: Option<i64> = transaction.query_row("SELECT actual_minutes FROM plan_blocks WHERE id = ?1",
            [&input.plan_block_id], |row| row.get(0))?;
        if let Some(minutes) = input.actual_minutes {
            let accumulated: i64 = transaction.query_row("SELECT actual_minutes FROM tasks WHERE id = ?1", [&task_id], |row| row.get(0))?;
            if accumulated.checked_add(minutes - credited.unwrap_or(0)).is_none() { return Err(AppError::Schema("累计实际耗时超过可保存范围".into())); }
        }
        let id = Uuid::new_v4().to_string();
        let timestamp = now();
        transaction.execute(
            "INSERT INTO review_entries (
                id, review_date, plan_block_id, task_id, outcome, actual_minutes,
                defer_reason, notes, remaining_workload_minutes, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
            params![
                id, review_date, input.plan_block_id, task_id, input.outcome.as_str(),
                input.actual_minutes, input.defer_reason, input.notes,
                input.remaining_workload_minutes, timestamp
            ],
        )?;
        transaction.execute(
            "UPDATE plan_blocks
             SET execution_status = ?2, actual_minutes = ?3, review_required = 0, updated_at = ?4,
                 execution_note = CASE WHEN ?5 THEN execution_note ELSE ?6 END,
                 execution_captured_at = CASE WHEN ?5 THEN execution_captured_at ELSE ?4 END
             WHERE id = ?1",
            params![input.plan_block_id, input.outcome.as_str(), input.actual_minutes, now(), is_today, input.notes],
        )?;
        // A zero daily estimate is not whole-task completion; only the aggregate may zero it.
        let reviewed_remaining = if task_status == "done" { current_remaining } else {
            input.remaining_workload_minutes.filter(|minutes| *minutes > 0).or(current_remaining)
        };
        if is_today && current_remaining != reviewed_remaining {
            transaction.execute(
                "INSERT INTO task_estimates
                    (id, task_id, estimate_kind, old_minutes, new_minutes, source, reason, created_at)
                 VALUES (?1, ?2, 'remaining', ?3, ?4, 'review', '执行块复盘重新估算', ?5)",
                params![
                    Uuid::new_v4().to_string(), task_id, current_remaining,
                    reviewed_remaining, now()
                ],
            )?;
        }
        if is_today {
            let remaining = reviewed_remaining;
            // A cancelled completed review retains its independent block minutes. Reconfirming
            // the supplement must not count the same work a second time.
            transaction.execute("UPDATE tasks SET actual_minutes = actual_minutes + ?2, remaining_workload_minutes = ?3, updated_at = ?4 WHERE id = ?1",
                params![task_id, input.actual_minutes.unwrap_or(0) - credited.unwrap_or(0), remaining, now()])?;
        }
        clear_review_draft(&transaction, review_date, "task", &input.plan_block_id)?;
        database_execution::sync_block_result(&transaction, &input.plan_block_id)?;
        transaction.commit()?;
        self.get_review_entry_for_block(&input.plan_block_id)
    }

    pub fn complete_task(&mut self, task_id: &str, plan_block_id: Option<&str>) -> AppResult<TaskDto> {
        self.complete_task_with_note(task_id, plan_block_id, None)
    }

    pub fn complete_task_with_note(&mut self, task_id: &str, plan_block_id: Option<&str>, note: Option<String>) -> AppResult<TaskDto> {
        let note = normalize_review_text(note, 500, "执行备注")?;
        let transaction = self.connection.transaction()?;
        database_execution::complete_in_transaction(&transaction, task_id, plan_block_id, note.as_deref())?;
        transaction.commit()?;
        self.get_task(task_id)
    }

    pub fn complete_task_from_review(&mut self, task_id: &str, review_date: &str, _confirmed: bool) -> AppResult<TaskDto> {
        parse_plan_date(review_date)?;
        let block: Option<String> = self.connection.query_row("SELECT pb.id FROM plan_blocks pb JOIN daily_plans dp ON dp.id = pb.daily_plan_id
            WHERE pb.task_id = ?1 AND dp.plan_date = ?2 ORDER BY pb.starts_at, pb.id LIMIT 1", params![task_id, review_date], |row| row.get(0)).optional()?;
        if block.is_none() && review_date != shanghai_today() { return Err(AppError::Domain("历史完成缺少执行块上下文".into())); }
        self.complete_task(task_id, block.as_deref())
    }

    pub fn list_review_form_drafts(&self, review_date: &str) -> AppResult<Vec<ReviewFormDraft>> {
        parse_plan_date(review_date)?;
        let mut statement = self.connection.prepare("SELECT review_date,item_type,item_id,COALESCE(payload_json, '{}'),revision,updated_at FROM review_form_drafts WHERE review_date = ?1 ORDER BY item_type,item_id")?;
        let rows = statement.query_map([review_date], |row| Ok(ReviewFormDraft { review_date: row.get(0)?, item_type: row.get(1)?, item_id: row.get(2)?, payload_json: row.get(3)?, revision: row.get(4)?, updated_at: row.get(5)? }))?.collect::<Result<Vec<_>, _>>()?;
        // Empty tombstones expose the latest revision for a new session, never old input.
        let mut drafts = Vec::new();
        for draft in rows {
            match validate_review_target(&self.connection, review_date, &draft.item_type, &draft.item_id) {
                Ok(()) => drafts.push(draft),
                Err(AppError::Domain(_)) | Err(AppError::Schema(_)) => {},
                Err(error) => return Err(error),
            }
        }
        Ok(drafts)
    }

    pub fn save_review_form_draft(&mut self, date: &str, kind: &str, id: &str, payload: &str, expected_revision: i64) -> AppResult<ReviewFormDraft> {
        if expected_revision < 0 || payload.len() > 64 * 1024 { return Err(AppError::Schema("草稿版本或大小无效".into())); }
        let _: serde_json::Value = serde_json::from_str(payload)?;
        let transaction = self.connection.transaction()?;
        validate_review_target(&transaction, date, kind, id)?;
        let current: i64 = transaction.query_row("SELECT revision FROM review_form_drafts WHERE review_date = ?1 AND item_type = ?2 AND item_id = ?3",
            params![date, kind, id], |row| row.get(0)).optional()?.unwrap_or(0);
        if current != expected_revision { return Err(AppError::Domain("记录草稿版本冲突，请重新加载后重试".into())); }
        let draft = ReviewFormDraft { review_date: date.into(), item_type: kind.into(), item_id: id.into(), payload_json: payload.into(), revision: current + 1, updated_at: now() };
        transaction.execute("INSERT INTO review_form_drafts (review_date,item_type,item_id,payload_json,revision,updated_at) VALUES (?1,?2,?3,?4,?5,?6)
            ON CONFLICT(review_date,item_type,item_id) DO UPDATE SET payload_json = excluded.payload_json, revision = excluded.revision, updated_at = excluded.updated_at",
            params![date, kind, id, payload, draft.revision, draft.updated_at])?;
        transaction.commit()?;
        Ok(draft)
    }

    pub fn delete_review_form_draft(&mut self, date: &str, kind: &str, id: &str) -> AppResult<()> {
        parse_plan_date(date)?;
        if !matches!(kind, "task" | "recurring") { return Err(AppError::Schema("无效条目类型".into())); }
        let transaction = self.connection.transaction()?;
        clear_review_draft(&transaction, date, kind, id)?;
        transaction.commit()?;
        Ok(())
    }

    fn get_review_entry_for_block(&self, plan_block_id: &str) -> AppResult<ReviewEntryDto> {
        self.connection.query_row(
            "SELECT id, review_date, plan_block_id, task_id, outcome, actual_minutes,
                    defer_reason, notes, remaining_workload_minutes, created_at, updated_at, followup_action
             FROM review_entries WHERE plan_block_id = ?1",
            [plan_block_id],
            |row| Ok(ReviewEntryDto {
                id: row.get(0)?, review_date: row.get(1)?, plan_block_id: row.get(2)?,
                task_id: row.get(3)?, outcome: row.get(4)?, actual_minutes: row.get(5)?,
                defer_reason: row.get(6)?, notes: row.get(7)?, remaining_workload_minutes: row.get(8)?,
                created_at: row.get(9)?, updated_at: row.get(10)?,
                followup_action: row.get(11)?,
            }),
        ).optional()?.ok_or_else(|| AppError::NotFound(format!("执行块 {plan_block_id} 的复盘记录")))
    }

    /// Restoring is a manual-only recycle-bin operation. AI proposals intentionally have no
    /// permanent-delete variant and cannot invoke this method through the confirmation pipeline.
    pub fn restore_task(&mut self, task_id: &str) -> AppResult<()> {
        let transaction = self.connection.transaction()?;
        let previous: Option<Option<String>> = transaction.query_row(
            "SELECT deleted_from_status FROM tasks WHERE id = ?1 AND status = 'deleted'", [task_id], |row| row.get(0),
        ).optional()?;
        let previous = previous.flatten().ok_or_else(|| AppError::Domain("只有回收站中的任务可以恢复".into()))?;
        let restored = TaskStatus::parse(&previous)?;
        if restored == TaskStatus::Deleted { return Err(AppError::Domain("回收站记录损坏，无法恢复".into())); }
        transaction.execute(
            "UPDATE tasks SET status = ?2, deleted_at = NULL, deleted_from_status = NULL, updated_at = ?3 WHERE id = ?1",
            params![task_id, restored.as_str(), now()],
        )?;
        record_task_change(&transaction, task_id, "restored", Some("deleted"), Some(restored.as_str()), "manual", None)?;
        transaction.commit()?;
        Ok(())
    }

    /// Permanent deletion is deliberately separate from soft deletion and only accepts a task
    /// already in the recycle bin. It is not exposed to AI operations.
    pub fn permanently_delete_task(&mut self, task_id: &str, confirmed: bool) -> AppResult<()> {
        if !confirmed { return Err(AppError::Domain("永久删除需要明确确认".into())); }
        let transaction = self.connection.transaction()?;
        let deleted: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM tasks WHERE id = ?1 AND status = 'deleted')", [task_id], |row| row.get(0),
        )?;
        if !deleted { return Err(AppError::Domain("永久删除只能在回收站中执行".into())); }
        transaction.execute("DELETE FROM plan_blocks WHERE task_id = ?1", [task_id])?;
        transaction.execute("DELETE FROM task_changes WHERE task_id = ?1", [task_id])?;
        transaction.execute("DELETE FROM tasks WHERE id = ?1", [task_id])?;
        transaction.commit()?;
        Ok(())
    }

    /// Stores only the validated structured operation and an opaque confirmation token. It never
    /// writes a task, event, block, or daily plan.
    pub fn preview_ai_proposal(&mut self, raw_json: &str) -> AppResult<ProposalPreview> {
        let proposal = AiProposal::parse_and_validate(raw_json)?;
        self.validate_against_current_state(&proposal)?;
        let ai_run_id = Uuid::new_v4().to_string();
        let confirmation_token = Uuid::new_v4().to_string();
        self.connection.execute(
            "INSERT INTO ai_runs (id, operation_type, structured_result_json, validation_status, confirmation_token, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'validated', ?4, ?5, ?5)",
            params![ai_run_id, operation_type(&proposal.operation), serde_json::to_string(&proposal)?, confirmation_token, now()],
        )?;
        Ok(ProposalPreview { ai_run_id, confirmation_token, proposal })
    }

    pub fn attach_ai_proposal_to_conversation(&mut self, ai_run_id: &str, conversation_id: &str) -> AppResult<()> {
        let changed = self.connection.execute(
            "UPDATE ai_runs SET conversation_id = ?2, updated_at = ?3
             WHERE id = ?1 AND validation_status = 'validated' AND confirmation_token IS NOT NULL",
            params![ai_run_id, conversation_id, now()],
        )?;
        if changed != 1 { return Err(AppError::NotFound(format!("AI 提议 {ai_run_id}"))); }
        Ok(())
    }

    pub fn list_ai_conversation_proposals(&self, conversation_id: &str) -> AppResult<Vec<ProposalPreview>> {
        let mut statement = self.connection.prepare(
            "SELECT id, confirmation_token, structured_result_json FROM ai_runs
             WHERE conversation_id = ?1 AND validation_status = 'validated'
               AND confirmation_token IS NOT NULL AND operation_type <> 'assistant_task_drafts'
             ORDER BY created_at",
        )?;
        let rows = statement.query_map([conversation_id], |row| {
            let raw: String = row.get(2)?;
            let proposal = serde_json::from_str(&raw).map_err(|error| rusqlite::Error::FromSqlConversionFailure(
                2, rusqlite::types::Type::Text, Box::new(error),
            ))?;
            Ok(ProposalPreview { ai_run_id: row.get(0)?, confirmation_token: row.get(1)?, proposal })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
    }

    /// The only AI-originated write path. It replays the locally stored, validated proposal after
    /// an explicit user confirmation, inside one SQLite transaction.
    pub fn apply_confirmed_ai_proposal(
        &mut self,
        ai_run_id: &str,
        confirmation_token: &str,
        destructive_confirmation: bool,
    ) -> AppResult<ApplyResult> {
        let stored: Option<String> = self.connection.query_row(
            "SELECT structured_result_json FROM ai_runs
             WHERE id = ?1 AND confirmation_token = ?2 AND validation_status = 'validated'",
            params![ai_run_id, confirmation_token],
            |row| row.get(0),
        ).optional()?;
        let stored = stored.ok_or(AppError::InvalidConfirmation)?;
        let proposal = AiProposal::parse_and_validate(&stored)?;

        // Re-checking immediately before commit prevents stale previews from bypassing new
        // conflicts or a concurrent manual edit.
        self.validate_against_current_state(&proposal)?;
        let transaction = self.connection.transaction()?;
        let result = apply_operation(&transaction, &proposal.operation, destructive_confirmation)?;
        transaction.execute(
            "UPDATE ai_runs SET validation_status = 'committed', confirmed_at = ?2, updated_at = ?2
             WHERE id = ?1",
            params![ai_run_id, now()],
        )?;
        transaction.commit()?;
        Ok(result)
    }

    #[cfg(test)]
    pub fn count(&self, table: &str) -> AppResult<i64> {
        let allowed = [
            "tasks", "task_drafts", "daily_plan_drafts", "daily_plans", "plan_blocks", "task_changes", "ai_runs",
            "ai_conversations", "ai_messages", "recurrence_rules", "recurrence_instances",
            "review_entries", "calendar_events", "recurring_items", "recurring_occurrences",
        ];
        if !allowed.contains(&table) { return Err(AppError::Domain("不允许查询该表".into())); }
        Ok(self.connection.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0))?)
    }

    #[cfg(test)]
    pub fn task_status(&self, task_id: &str) -> AppResult<String> {
        self.connection.query_row("SELECT status FROM tasks WHERE id = ?1", [task_id], |row| row.get(0))
            .map_err(AppError::from)
    }

    fn validate_against_current_state(&self, proposal: &AiProposal) -> AppResult<()> {
        match &proposal.operation {
            AiOperation::ProposedTaskCreate { earliest_start_at, due_at, .. } => {
                crate::domain::validate_complete_task_timestamps(earliest_start_at, due_at)
            }
            AiOperation::ProposedTaskUpdate { task_id, .. } | AiOperation::ProposedTaskComplete { task_id } => {
                let task = self.load_task(task_id)?;
                if task.status == TaskStatus::Deleted { return Err(AppError::Domain("回收站任务不能直接修改或完成".into())); }
                if matches!(&proposal.operation, AiOperation::ProposedTaskUpdate { .. }) {
                    ensure_task_content_editable(&self.get_task(task_id)?)?;
                }
                if matches!(&proposal.operation, AiOperation::ProposedTaskComplete { .. })
                    && !task.status.can_transition_to(TaskStatus::Done) {
                    return Err(AppError::Domain("该任务当前不能标记为完成".into()));
                }
                Ok(())
            }
            AiOperation::ProposedTaskSoftDelete { task_ids, .. } => {
                for id in task_ids {
                    let task = self.load_task(id)?;
                    if task.status == TaskStatus::Deleted { return Err(AppError::Domain("删除目标已在回收站中".into())); }
                }
                Ok(())
            }
            AiOperation::ProposedPlan { plan_date, blocks } => {
                for block in blocks {
                    ensure_task_content_editable(&self.get_task(&block.task_id)?)?;
                    let task = self.load_task(&block.task_id)?;
                    if !matches!(task.status, TaskStatus::Open | TaskStatus::Scheduled) {
                        return Err(AppError::Domain("只有待办或已安排任务可以进入日计划".into()));
                    }
                    if task.earliest_start_at.is_none() || task.due_at.is_none() {
                        return Err(AppError::Domain("任务开始和结束时间未填写完整，不能进入日计划".into()));
                    }
                    if task.splittable == false && blocks.iter().filter(|item| item.task_id == block.task_id).count() > 1 {
                        return Err(AppError::Domain("不允许拆分的任务只能有一个连续时间块".into()));
                    }
                    let minutes = (crate::domain::parse_shanghai_timestamp(&block.ends_at)?
                        - crate::domain::parse_shanghai_timestamp(&block.starts_at)?).num_minutes();
                    if task.splittable && minutes < 30 {
                        return Err(AppError::Domain("可拆分任务的每个时间块至少为 30 分钟".into()));
                    }
                }
                validate_plan_blocks_in_date(plan_date, blocks)
            }
        }
    }

    fn load_task(&self, id: &str) -> AppResult<TaskRow> {
        self.connection.query_row(
            "SELECT id, title, priority, estimated_minutes, earliest_start_at, due_at, splittable, status FROM tasks WHERE id = ?1",
            [id],
            |row| Ok(TaskRow {
                title: row.get(1)?, priority: row.get(2)?, estimated_minutes: row.get(3)?,
                earliest_start_at: row.get(4)?, due_at: row.get(5)?,
                splittable: row.get::<_, i64>(6)? != 0, status: TaskStatus::parse(&row.get::<_, String>(7)?).map_err(to_sql_error)?,
            }),
        ).optional()?.ok_or_else(|| AppError::NotFound(format!("任务 {id}")))
    }
}

fn apply_operation(transaction: &Transaction<'_>, operation: &AiOperation, destructive_confirmation: bool) -> AppResult<ApplyResult> {
    match operation {
        AiOperation::ProposedTaskCreate { title, notes, priority, earliest_start_at, due_at, estimated_minutes, splittable: _ } => {
            let current_drafts = current_plan_draft_dates(transaction)?;
            let id = Uuid::new_v4().to_string();
            let (earliest_start_date, earliest_start_time) = split_legacy_timestamp(earliest_start_at.as_deref());
            let (due_date, due_time) = split_legacy_timestamp(due_at.as_deref());
            let historical = validate_new_task_history(earliest_start_date.as_deref(), due_date.as_deref())?;
            let status = TaskStatus::Open;
            transaction.execute(
                "INSERT INTO tasks (
                    id, title, notes, priority, earliest_start_at, due_at, estimated_minutes,
                    earliest_start_date, earliest_start_time, due_date, due_time,
                    total_workload_minutes, remaining_workload_minutes, actual_minutes,
                    source_type, migration_review_required, splittable, status, created_at, updated_at
                 ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                    ?7, ?7, 0, 'ai_assistant', 0, ?12, ?13, ?14, ?14
                 )",
                params![
                    id, title, notes, priority.map(Priority::as_str), earliest_start_at, due_at,
                    estimated_minutes, earliest_start_date, earliest_start_time, due_date, due_time,
                    1, status.as_str(), now()
                ],
            )?;
            record_task_change(transaction, &id, "created", None, Some(status.as_str()), "ai", None)?;
            record_initial_estimates(transaction, &id, *estimated_minutes, *estimated_minutes, "ai_assistant")?;
            if historical {
                database_execution::complete_historical_creation(transaction, &id)?;
            } else {
                sync_single_day_task_schedule(transaction, &id, None, &current_drafts)?;
                schedule_new_cross_day_task(transaction, &id, &current_drafts)?;
            }
            Ok(ApplyResult { affected_task_ids: vec![id], plan_id: None })
        }
        AiOperation::ProposedTaskUpdate { task_id, title, priority, estimated_minutes } => {
            let existing = load_task_in_transaction(transaction, task_id)?;
            ensure_task_content_editable(&load_task_dto_in_transaction(transaction, task_id)?)?;
            let title = title.clone().unwrap_or(existing.title);
            let new_priority = priority.map(Priority::as_str).map(str::to_owned).or(existing.priority);
            let new_estimate = estimated_minutes.or(existing.estimated_minutes);
            transaction.execute(
                "UPDATE tasks SET title = ?2, priority = ?3, estimated_minutes = ?4, updated_at = ?5 WHERE id = ?1",
                params![task_id, title, new_priority, new_estimate, now()],
            )?;
            if existing.estimated_minutes != new_estimate {
                record_task_change(transaction, task_id, "estimate_changed", existing.estimated_minutes.map(|v| v.to_string()).as_deref(), new_estimate.map(|v| v.to_string()).as_deref(), "ai", None)?;
            }
            Ok(ApplyResult { affected_task_ids: vec![task_id.clone()], plan_id: None })
        }
        AiOperation::ProposedTaskComplete { task_id } => {
            set_task_status(transaction, task_id, TaskStatus::Done, "ai")?;
            Ok(ApplyResult { affected_task_ids: vec![task_id.clone()], plan_id: None })
        }
        AiOperation::ProposedTaskSoftDelete { task_ids, .. } => {
            if !destructive_confirmation { return Err(AppError::Domain("移入回收站需要二次确认".into())); }
            for task_id in task_ids { soft_delete_task(transaction, task_id, "ai")?; }
            Ok(ApplyResult { affected_task_ids: task_ids.clone(), plan_id: None })
        }
        AiOperation::ProposedPlan { plan_date, blocks } => {
            let plan_id = insert_confirmed_plan(transaction, plan_date, blocks, "ai")?;
            Ok(ApplyResult { affected_task_ids: blocks.iter().map(|block| block.task_id.clone()).collect(), plan_id: Some(plan_id) })
        }
    }
}

fn insert_confirmed_plan(
    transaction: &Transaction<'_>,
    plan_date: &str,
    blocks: &[crate::domain::ProposedPlanBlock],
    source: &str,
) -> AppResult<String> {
    let plan_id = Uuid::new_v4().to_string();
    insert_confirmed_plan_with_id(transaction, &plan_id, plan_date, blocks, source)?;
    Ok(plan_id)
}

fn insert_confirmed_plan_with_id(
    transaction: &Transaction<'_>,
    plan_id: &str,
    plan_date: &str,
    blocks: &[crate::domain::ProposedPlanBlock],
    source: &str,
) -> AppResult<()> {
    transaction.execute(
        "INSERT INTO daily_plans (id, plan_date, status, source, created_at, confirmed_at)
         VALUES (?1, ?2, 'confirmed', ?3, ?4, ?4)",
        params![plan_id, plan_date, source, now()],
    )?;
    let mut scheduled_tasks = Vec::new();
    for block in blocks {
        ensure_task_content_editable(&load_task_dto_in_transaction(transaction, &block.task_id)?)?;
        transaction.execute(
            "INSERT INTO plan_blocks (
                id, daily_plan_id, task_id, starts_at, ends_at, source,
                review_required, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7)",
            params![Uuid::new_v4().to_string(), plan_id, block.task_id, block.starts_at, block.ends_at, block.source.as_str(), now()],
        )?;
        if !scheduled_tasks.contains(&block.task_id) {
            scheduled_tasks.push(block.task_id.clone());
        }
    }
    for task_id in scheduled_tasks {
        let current: String = transaction.query_row("SELECT status FROM tasks WHERE id = ?1", [&task_id], |row| row.get(0))?;
        if current == TaskStatus::Open.as_str() {
            set_task_status(transaction, &task_id, TaskStatus::Scheduled, source)?;
        } else {
            // Scheduling changes invalidate already-open result forms, even when status stays scheduled.
            transaction.execute("UPDATE tasks SET updated_at = ?2 WHERE id = ?1", params![task_id, now()])?;
        }
    }
    Ok(())
}

fn load_replaceable_plan_blocks(transaction: &Transaction<'_>, plan_id: &str) -> AppResult<Vec<PlanUndoBlock>> {
    let mut statement = transaction.prepare(
        "SELECT id, task_id, starts_at, ends_at, source, created_at, updated_at
         FROM plan_blocks
         WHERE daily_plan_id = ?1 AND task_id IS NOT NULL AND execution_status = 'planned'
           AND execution_captured_at IS NULL AND COALESCE(actual_minutes, 0) = 0
           AND NOT EXISTS(SELECT 1 FROM review_entries review WHERE review.plan_block_id = plan_blocks.id)
         ORDER BY starts_at, id",
    )?;
    let rows = statement.query_map([plan_id], |row| Ok(PlanUndoBlock {
        id: row.get(0)?, task_id: row.get(1)?, starts_at: row.get(2)?, ends_at: row.get(3)?,
        source: row.get(4)?, created_at: row.get(5)?, updated_at: row.get(6)?,
    }))?;
    let blocks = rows.collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    let mut editable = Vec::new();
    for block in blocks {
        if !load_task_dto_in_transaction(transaction, &block.task_id)?.execution_locked {
            editable.push(block);
        }
    }
    Ok(editable)
}

fn ensure_task_content_editable(task: &TaskDto) -> AppResult<()> {
    TaskStatus::parse(&task.status)?.ensure_editable()?;
    if task.execution_locked {
        return Err(AppError::Domain("该单日任务已有执行或复盘记录，内容和时间已锁定".into()));
    }
    Ok(())
}

fn schedule_new_cross_day_task(transaction: &Transaction<'_>, task_id: &str, dates: &[String]) -> AppResult<()> {
    let task = load_task_dto_in_transaction(transaction, task_id)?;
    let (Some(start), Some(end), Some(total)) = (
        task.earliest_start_at.as_deref(), task.due_at.as_deref(),
        task.remaining_workload_minutes.or(task.total_workload_minutes),
    ) else { return Ok(()); };
    let start = crate::domain::parse_shanghai_timestamp(start)?;
    let end = crate::domain::parse_shanghai_timestamp(end)?;
    let days = (end.date_naive() - start.date_naive()).num_days() + 1;
    if days <= 1 || total / days < MIN_TASK_BLOCK_MINUTES { return Ok(()); }
    let workday_start: String = transaction.query_row(
        "SELECT workday_start FROM availability_settings WHERE id = 1", [], |row| row.get(0),
    ).optional()?.unwrap_or_else(|| AvailabilitySettings::default().workday_start);
    let preferred_time = parse_clock(&workday_start)?;
    for day in 0..days {
        let date = start.date_naive() + Duration::days(day);
        let midnight = NaiveTime::from_hms_opt(0, 0, 0).unwrap();
        let lower = shanghai_timestamp(date, midnight)?.max(start);
        let upper = shanghai_timestamp(date + Duration::days(1), midnight)?.min(end);
        let minutes = (total / days + i64::from(day < total % days)).min((upper - lower).num_minutes());
        if minutes < MIN_TASK_BLOCK_MINUTES { continue; }
        let starts_at = shanghai_timestamp(date, preferred_time)?.max(lower).min(upper - Duration::minutes(minutes));
        let ends_at = starts_at + Duration::minutes(minutes);
        let plan_date = date.to_string();
        let plan_id: String = transaction.query_row(
            "SELECT id FROM daily_plans WHERE plan_date = ?1 AND status = 'confirmed'", [&plan_date], |row| row.get(0),
        ).optional()?.unwrap_or_else(|| Uuid::new_v4().to_string());
        transaction.execute(
            "INSERT OR IGNORE INTO daily_plans (id, plan_date, status, source, created_at, confirmed_at)
             VALUES (?1, ?2, 'confirmed', 'manual', ?3, ?3)", params![plan_id, plan_date, now()],
        )?;
        transaction.execute(
            "INSERT INTO plan_blocks (id, daily_plan_id, task_id, starts_at, ends_at, source, review_required, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'manual', 1, ?6, ?6)",
            params![Uuid::new_v4().to_string(), plan_id, task_id, starts_at.to_rfc3339(), ends_at.to_rfc3339(), now()],
        )?;
    }
    if !load_task_schedule_blocks(transaction, task_id)?.is_empty() {
        set_task_status(transaction, task_id, TaskStatus::Scheduled, "manual")?;
        refresh_task_in_plan_drafts(transaction, task_id, dates)?;
    }
    Ok(())
}

fn single_day_range(start: Option<&str>, end: Option<&str>) -> AppResult<Option<(String, i64)>> {
    let (Some(start), Some(end)) = (start, end) else { return Ok(None); };
    let start = crate::domain::parse_shanghai_timestamp(start)?;
    let end = crate::domain::parse_shanghai_timestamp(end)?;
    if start.date_naive() != end.date_naive() || end <= start { return Ok(None); }
    Ok(Some((start.format("%Y-%m-%d").to_string(), (end - start).num_minutes())))
}

fn load_task_schedule_blocks(connection: &Connection, task_id: &str) -> AppResult<Vec<TaskScheduleBlock>> {
    let mut statement = connection.prepare(
        "SELECT dp.id, dp.plan_date, pb.id, pb.task_id, pb.starts_at, pb.ends_at, pb.source, pb.created_at, pb.updated_at
         FROM plan_blocks pb JOIN daily_plans dp ON dp.id = pb.daily_plan_id
         WHERE pb.task_id = ?1 AND dp.status = 'confirmed' AND pb.execution_status = 'planned'
           AND pb.execution_captured_at IS NULL AND COALESCE(pb.actual_minutes, 0) = 0
           AND NOT EXISTS(SELECT 1 FROM review_entries review WHERE review.plan_block_id = pb.id)
         ORDER BY dp.plan_date, pb.id",
    )?;
    let rows = statement.query_map([task_id], |row| Ok(TaskScheduleBlock {
        plan_id: row.get(0)?, plan_date: row.get(1)?,
        block: PlanUndoBlock { id: row.get(2)?, task_id: row.get(3)?, starts_at: row.get(4)?,
            ends_at: row.get(5)?, source: row.get(6)?, created_at: row.get(7)?, updated_at: row.get(8)? },
    }))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn can_sync_single_day_task(connection: &Connection, task_id: &str, start: Option<&str>, end: Option<&str>) -> AppResult<bool> {
    if !single_day_range(start, end)?.is_some_and(|(date, _)| date >= shanghai_today()) { return Ok(false); }
    let actual_locked: bool = connection.query_row("SELECT actual_minutes > 0 AND NOT EXISTS(
        SELECT 1 FROM review_entries WHERE task_id = ?1 AND followup_action IN ('schedule','wait','stop')) FROM tasks WHERE id = ?1",
        [task_id], |row| row.get(0))?;
    if actual_locked { return Ok(false); }
    let (count, locked): (i64, i64) = connection.query_row(
        "SELECT COALESCE(SUM(CASE WHEN dp.plan_date >= ?2 THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN pb.execution_status <> 'planned' OR pb.execution_captured_at IS NOT NULL
                OR COALESCE(pb.actual_minutes, 0) > 0
                OR EXISTS(SELECT 1 FROM review_entries review WHERE review.plan_block_id = pb.id) THEN 1 ELSE 0 END), 0)
         FROM plan_blocks pb JOIN daily_plans dp ON dp.id = pb.daily_plan_id
         WHERE pb.task_id = ?1 AND dp.status = 'confirmed'
           AND NOT EXISTS(SELECT 1 FROM review_entries resolved WHERE resolved.plan_block_id = pb.id
               AND resolved.followup_action IN ('schedule','wait','stop'))",
        params![task_id, shanghai_today()], |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    Ok(count <= 1 && locked == 0)
}

// Only rebase drafts that were current before this explicit task save.
fn current_plan_draft_dates(connection: &Connection) -> AppResult<Vec<String>> {
    let drafts = {
        let mut statement = connection.prepare("SELECT plan_date, facts_json FROM daily_plan_drafts WHERE status = 'active'")?;
        let rows = statement.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    let mut dates = Vec::new();
    for (date, facts) in drafts {
        if facts == rule_plan_facts_json_from_connection(connection, &date)? { dates.push(date); }
    }
    Ok(dates)
}

fn refresh_task_in_plan_drafts(transaction: &Transaction<'_>, task_id: &str, dates: &[String]) -> AppResult<()> {
    let task = load_task_dto_in_transaction(transaction, task_id)?;
    let blocks = load_task_schedule_blocks(transaction, task_id)?;
    for date in dates {
        let Some(stored) = load_rule_plan_draft_for_date(transaction, date)? else { continue; };
        let mut preview = stored.preview;
        let existing = preview.blocks.iter().any(|block| block.task_id == task_id)
            || preview.unscheduled.iter().any(|item| item.task_id == task_id);
        let automatic = if blocks.iter().filter(|block| block.plan_date == *date).count() == 1 {
            blocks.iter().find(|block| block.plan_date == *date && task.status == "scheduled"
                && task.earliest_start_at.as_ref().is_some_and(|start| block.block.starts_at >= *start)
                && task.due_at.as_ref().is_some_and(|end| block.block.ends_at <= *end)).map(|block| &block.block)
        } else { None };
        if !existing && automatic.is_none() { continue; }
        preview.blocks.retain(|block| block.task_id != task_id);
        preview.unscheduled.retain(|item| item.task_id != task_id);
        if let Some(block) = automatic {
            preview.blocks.push(RulePlanBlock { task_id: task_id.into(), task_title: task.title.clone(),
                starts_at: block.starts_at.clone(), ends_at: block.ends_at.clone(),
                estimated_minutes: (crate::domain::parse_shanghai_timestamp(&block.ends_at)?
                    - crate::domain::parse_shanghai_timestamp(&block.starts_at)?).num_minutes() });
        } else if matches!(task.status.as_str(), "open" | "scheduled")
            && task.earliest_start_date.as_deref().is_some_and(|start| start <= date.as_str())
            && task.due_date.as_deref().is_some_and(|end| end >= date.as_str())
        {
            preview.unscheduled.push(UnscheduledTask { task_id: task_id.into(), task_title: task.title.clone(),
                estimated_minutes: task.remaining_workload_minutes, reason: "尚未排入当前计划".into() });
        }
        let base_plan_id: Option<String> = transaction.query_row(
            "SELECT id FROM daily_plans WHERE plan_date = ?1 AND status = 'confirmed'", [date], |row| row.get(0),
        ).optional()?;
        let facts = rule_plan_facts_json_from_connection(transaction, date)?;
        transaction.execute(
            "UPDATE daily_plan_drafts SET blocks_json = ?2, unscheduled_json = ?3, facts_json = ?4,
                base_plan_id = ?5, version = version + 1, confirmation_token = ?6, updated_at = ?7 WHERE id = ?1",
            params![preview.preview_id, serde_json::to_string(&preview.blocks)?, serde_json::to_string(&preview.unscheduled)?,
                facts, base_plan_id, Uuid::new_v4().to_string(), now()],
        )?;
    }
    Ok(())
}

fn set_single_day_task_times(transaction: &Transaction<'_>, task_id: &str, start: &str, end: &str) -> AppResult<()> {
    let before = load_task_dto_in_transaction(transaction, task_id)?;
    let (date, minutes) = single_day_range(Some(start), Some(end))?
        .ok_or_else(|| AppError::Domain("单日任务必须在同一天内结束".into()))?;
    if minutes < MIN_TASK_BLOCK_MINUTES { return Err(AppError::Domain("单日任务至少需要 15 分钟".into())); }
    record_task_change(transaction, task_id, "single_day_time_synced", before.earliest_start_at.as_deref(),
        Some(start), "manual", Some("单日任务与时间线同步"))?;
    // A follow-up range is a new reservation, not a rewrite of the task's original workload.
    let followup = database_execution::has_followup(transaction, task_id)?;
    transaction.execute(
        "UPDATE tasks SET earliest_start_at = ?2, due_at = ?3, earliest_start_date = ?4, due_date = ?4,
            earliest_start_time = ?5, due_time = ?6, estimated_minutes = ?7, total_workload_minutes = ?9,
            remaining_workload_minutes = ?10, updated_at = ?8 WHERE id = ?1",
        params![task_id, start, end, date, &start[11..16], &end[11..16],
            if followup { before.estimated_minutes } else { Some(minutes) }, now(),
            if followup { before.total_workload_minutes } else { Some(minutes) },
            if followup { before.remaining_workload_minutes } else { Some(minutes) }],
    )?;
    Ok(())
}

fn sync_single_day_task_schedule(transaction: &Transaction<'_>, task_id: &str, before: Option<&TaskDto>, dates: &[String]) -> AppResult<()> {
    let task = load_task_dto_in_transaction(transaction, task_id)?;
    let range = single_day_range(task.earliest_start_at.as_deref(), task.due_at.as_deref())?;
    let followup = database_execution::has_followup(transaction, task_id)?;
    let old_blocks = load_task_schedule_blocks(transaction, task_id)?.into_iter()
        .filter(|block| !followup || block.plan_date >= shanghai_today()).collect::<Vec<_>>();
    if let Some((date, _)) = &range {
        if *date < shanghai_today() {
            if old_blocks.iter().any(|block| block.plan_date >= shanghai_today()) {
                return Err(AppError::Domain("已安排任务不能移入历史日期".into()));
            }
            if old_blocks.is_empty() { return Ok(()); }
        }
        if *date >= shanghai_today() && !can_sync_single_day_task(transaction, task_id, task.earliest_start_at.as_deref(), task.due_at.as_deref())? {
            return Err(AppError::Domain("该单日任务已有执行记录或多个待执行块，不能直接修改安排".into()));
        }
        let start = task.earliest_start_at.as_deref().unwrap();
        let end = task.due_at.as_deref().unwrap();
        set_single_day_task_times(transaction, task_id, start, end)?;
        let plan_id = transaction.query_row(
            "SELECT id FROM daily_plans WHERE plan_date = ?1 AND status = 'confirmed'", [date], |row| row.get::<_, String>(0),
        ).optional()?.unwrap_or_else(|| Uuid::new_v4().to_string());
        transaction.execute(
            "INSERT OR IGNORE INTO daily_plans (id, plan_date, status, source, created_at, confirmed_at)
             VALUES (?1, ?2, 'confirmed', 'manual', ?3, ?3)", params![plan_id, date, now()],
        )?;
        let current = old_blocks.iter().find(|block| block.plan_date >= shanghai_today()).or_else(|| old_blocks.first());
        if let Some(old) = current {
            transaction.execute("UPDATE plan_blocks SET daily_plan_id = ?2, starts_at = ?3, ends_at = ?4, updated_at = ?5 WHERE id = ?1",
                params![old.block.id, plan_id, start, end, now()])?;
            for duplicate in old_blocks.iter().filter(|block| block.block.id != old.block.id) {
                transaction.execute("DELETE FROM plan_blocks WHERE id = ?1", [&duplicate.block.id])?;
            }
        } else {
            transaction.execute(
                "INSERT INTO plan_blocks (id, daily_plan_id, task_id, starts_at, ends_at, source, review_required, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'manual', 1, ?6, ?6)",
                params![Uuid::new_v4().to_string(), plan_id, task_id, start, end, now()],
            )?;
        }
        if task.status == "open" { set_task_status(transaction, task_id, TaskStatus::Scheduled, "manual")?; }
    } else if before.is_some_and(|before| single_day_range(before.earliest_start_at.as_deref(), before.due_at.as_deref())
        .ok().flatten().is_some())
        && !before.unwrap().execution_locked
        && (before.unwrap().due_date.as_deref().is_some_and(|date| date < shanghai_today().as_str())
            || can_sync_single_day_task(transaction, task_id, before.unwrap().earliest_start_at.as_deref(), before.unwrap().due_at.as_deref())?)
    {
        for block in &old_blocks {
            transaction.execute("DELETE FROM plan_blocks WHERE id = ?1", [&block.block.id])?;
        }
        if task.status == "scheduled" { set_task_status(transaction, task_id, TaskStatus::Open, "manual")?; }
    } else { return Ok(()); }
    refresh_task_in_plan_drafts(transaction, task_id, dates)
}

fn task_schedule_undo_json(transaction: &Transaction<'_>, task_id: &str, task: Option<TaskDto>, before_blocks: Vec<TaskScheduleBlock>) -> AppResult<String> {
    Ok(serde_json::to_string(&TaskScheduleUndo { task, before_blocks,
        after_blocks: load_task_schedule_blocks(transaction, task_id)? })?)
}

fn restore_single_day_task_time_snapshot(transaction: &Transaction<'_>, task: &TaskDto) -> AppResult<()> {
    transaction.execute(
        "UPDATE tasks SET earliest_start_at = ?2, due_at = ?3, earliest_start_date = ?4,
            earliest_start_time = ?5, due_date = ?6, due_time = ?7, estimated_minutes = ?8,
            total_workload_minutes = ?9, remaining_workload_minutes = ?10, updated_at = ?11 WHERE id = ?1",
        params![task.id, task.earliest_start_at, task.due_at, task.earliest_start_date,
            task.earliest_start_time, task.due_date, task.due_time, task.estimated_minutes,
            task.total_workload_minutes, task.remaining_workload_minutes, now()],
    )?;
    record_task_change(transaction, &task.id, "undo_single_day_time", None, task.due_at.as_deref(), "undo", None)
}

fn load_plan_task_states(transaction: &Transaction<'_>, task_ids: &[String]) -> AppResult<Vec<PlanUndoTaskState>> {
    let mut states = Vec::with_capacity(task_ids.len());
    for task_id in task_ids {
        states.push(transaction.query_row(
            "SELECT id, status, updated_at FROM tasks WHERE id = ?1",
            [task_id],
            |row| Ok(PlanUndoTaskState { id: row.get(0)?, status: row.get(1)?, updated_at: row.get(2)? }),
        ).optional()?.ok_or_else(|| AppError::NotFound(format!("任务 {task_id}")))?);
    }
    states.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(states)
}

fn replace_confirmed_plan_blocks(
    transaction: &Transaction<'_>,
    plan_id: &str,
    blocks: &[crate::domain::ProposedPlanBlock],
) -> AppResult<()> {
    let previous_blocks = load_replaceable_plan_blocks(transaction, plan_id)?;
    let previous_task_ids = previous_blocks.iter().map(|block| block.task_id.clone()).collect::<HashSet<_>>();
    for block in &previous_blocks {
        transaction.execute("DELETE FROM plan_blocks WHERE id = ?1", [&block.id])?;
    }
    let timestamp = now();
    let next_task_ids = blocks.iter().map(|block| block.task_id.as_str()).collect::<HashSet<_>>();
    for block in blocks {
        ensure_task_content_editable(&load_task_dto_in_transaction(transaction, &block.task_id)?)?;
        transaction.execute(
            "INSERT INTO plan_blocks (
                id, daily_plan_id, task_id, starts_at, ends_at, source,
                review_required, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, 'manual', 1, ?6, ?6)",
            params![Uuid::new_v4().to_string(), plan_id, block.task_id, block.starts_at, block.ends_at, timestamp],
        )?;
        let status: String = transaction.query_row(
            "SELECT status FROM tasks WHERE id = ?1", [&block.task_id], |row| row.get(0),
        )?;
        if status == TaskStatus::Open.as_str() {
            set_task_status(transaction, &block.task_id, TaskStatus::Scheduled, "manual")?;
        } else {
            transaction.execute("UPDATE tasks SET updated_at = ?2 WHERE id = ?1", params![block.task_id, timestamp])?;
        }
    }
    for task_id in previous_task_ids {
        if next_task_ids.contains(task_id.as_str()) { continue; }
        let still_scheduled: bool = transaction.query_row(
            "SELECT EXISTS(
                SELECT 1 FROM plan_blocks pb
                JOIN daily_plans dp ON dp.id = pb.daily_plan_id
                WHERE pb.task_id = ?1 AND dp.status = 'confirmed'
             )",
            [&task_id],
            |row| row.get(0),
        )?;
        let status: String = transaction.query_row(
            "SELECT status FROM tasks WHERE id = ?1", [&task_id], |row| row.get(0),
        )?;
        if !still_scheduled && status == TaskStatus::Scheduled.as_str() {
            set_task_status(transaction, &task_id, TaskStatus::Open, "manual")?;
        } else {
            transaction.execute("UPDATE tasks SET updated_at = ?2 WHERE id = ?1", params![task_id, timestamp])?;
        }
    }
    transaction.execute(
        "UPDATE daily_plans SET source = 'manual', confirmed_at = ?2 WHERE id = ?1",
        params![plan_id, timestamp],
    )?;
    Ok(())
}

fn normalize_calendar_event_input(mut input: ManualCalendarEventInput) -> AppResult<ManualCalendarEventInput> {
    // The field remains accepted solely so older callers do not fail deserialization.
    // Every fixed event is now a non-exclusive timeline item.
    let _legacy_blocks_scheduling = input.blocks_scheduling;
    input.blocks_scheduling = false;
    crate::domain::validate_title(&input.title)?;
    validate_range(&input.starts_at, &input.ends_at)?;
    if input.is_all_day {
        let date = crate::domain::parse_shanghai_timestamp(&input.starts_at)?.date_naive();
        let next_date = date.succ_opt().ok_or_else(|| AppError::Domain("全天日程日期超出范围".into()))?;
        let midnight = NaiveTime::from_hms_opt(0, 0, 0).unwrap();
        input.starts_at = shanghai_timestamp(date, midnight)?.to_rfc3339();
        input.ends_at = shanghai_timestamp(next_date, midnight)?.to_rfc3339();
    }
    Ok(input)
}

fn validate_range(starts_at: &str, ends_at: &str) -> AppResult<()> {
    let start = crate::domain::parse_shanghai_timestamp(starts_at)?;
    let end = crate::domain::parse_shanghai_timestamp(ends_at)?;
    if end <= start { return Err(AppError::Domain("结束时间必须晚于开始时间".into())); }
    Ok(())
}

fn calendar_event_dto_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CalendarEventDto> {
    Ok(CalendarEventDto {
        id: row.get(0)?, title: row.get(1)?, starts_at: row.get(2)?, ends_at: row.get(3)?,
        is_all_day: row.get::<_, i64>(4)? != 0, blocks_scheduling: row.get::<_, i64>(5)? != 0,
        deleted_at: row.get(6)?, created_at: row.get(7)?, updated_at: row.get(8)?,
    })
}

fn validate_availability_settings(settings: &AvailabilitySettings) -> AppResult<()> {
    if settings.weekdays.is_empty() || settings.weekdays.iter().any(|day| !(1..=7).contains(day)) {
        return Err(AppError::Schema("至少选择一个有效工作日".into()));
    }
    let mut unique = settings.weekdays.clone();
    unique.sort_unstable();
    unique.dedup();
    if unique.len() != settings.weekdays.len() { return Err(AppError::Schema("工作日不能重复".into())); }
    let start = parse_clock(&settings.workday_start)?;
    let end = parse_clock(&settings.workday_end)?;
    if end <= start { return Err(AppError::Domain("每日结束时间必须晚于开始时间".into())); }
    Ok(())
}

fn parse_clock(value: &str) -> AppResult<NaiveTime> {
    NaiveTime::parse_from_str(value, "%H:%M")
        .map_err(|_| AppError::Schema("时刻必须为 HH:MM 格式".into()))
}

fn parse_plan_date(value: &str) -> AppResult<NaiveDate> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| AppError::Schema("计划日期必须为 YYYY-MM-DD".into()))
}

fn preferred_daily_task_minutes(
    total_workload_minutes: Option<i64>,
    earliest_start_at: Option<&str>,
    due_at: Option<&str>,
) -> AppResult<Option<i64>> {
    let (Some(total), Some(earliest), Some(due)) = (
        total_workload_minutes,
        earliest_start_at,
        due_at,
    ) else {
        return Ok(None);
    };
    let start_date = crate::domain::parse_shanghai_timestamp(earliest)?.date_naive();
    let due_date = crate::domain::parse_shanghai_timestamp(due)?.date_naive();
    if due_date <= start_date {
        return Ok(None);
    }
    let days = (due_date - start_date).num_days() + 1;
    if total % days != 0 {
        return Ok(None);
    }
    let daily = total / days;
    Ok((MIN_TASK_BLOCK_MINUTES..=24 * 60).contains(&daily).then_some(daily))
}

fn remove_automatic_duplicates_already_in_plan(
    blocks: &[RulePlanBlock],
    unscheduled: &mut Vec<UnscheduledTask>,
) {
    let planned_task_ids = blocks.iter()
        .map(|block| block.task_id.as_str())
        .collect::<HashSet<_>>();
    unscheduled.retain(|item| {
        item.reason != "尚未排入当前计划"
            || !planned_task_ids.contains(item.task_id.as_str())
    });
}

fn shanghai_timestamp(date: NaiveDate, time: NaiveTime) -> AppResult<DateTime<FixedOffset>> {
    let offset = FixedOffset::east_opt(crate::domain::SHANGHAI_OFFSET_SECONDS)
        .ok_or_else(|| AppError::Domain("无法创建中国标准时间偏移".into()))?;
    offset.from_local_datetime(&date.and_time(time)).single()
        .ok_or_else(|| AppError::Domain("无法创建计划时间".into()))
}


fn set_task_status(transaction: &Transaction<'_>, task_id: &str, target: TaskStatus, source: &str) -> AppResult<()> {
    if target == TaskStatus::Done { return database_execution::complete_in_transaction(transaction, task_id, None, None); }
    let current: String = transaction.query_row("SELECT status FROM tasks WHERE id = ?1", [task_id], |row| row.get(0))?;
    let current = TaskStatus::parse(&current)?;
    if !current.can_transition_to(target) { return Err(AppError::Domain("任务状态转移不合法".into())); }
    if current == TaskStatus::Done && target != TaskStatus::Done && target != TaskStatus::Deleted {
        database_results::require_task_reopenable(transaction, task_id)?;
    }
    transaction.execute("UPDATE tasks SET status = ?2, updated_at = ?3 WHERE id = ?1", params![task_id, target.as_str(), now()])?;
    record_task_change(transaction, task_id, "status_changed", Some(current.as_str()), Some(target.as_str()), source, None)
}

fn soft_delete_task(transaction: &Transaction<'_>, task_id: &str, source: &str) -> AppResult<()> {
    let current: String = transaction.query_row("SELECT status FROM tasks WHERE id = ?1", [task_id], |row| row.get(0))?;
    let current = TaskStatus::parse(&current)?;
    if !current.can_transition_to(TaskStatus::Deleted) { return Err(AppError::Domain("该任务当前不能移入回收站".into())); }
    transaction.execute(
        "UPDATE tasks SET status = 'deleted', deleted_at = ?2, deleted_from_status = ?3, updated_at = ?2 WHERE id = ?1",
        params![task_id, now(), current.as_str()],
    )?;
    record_task_change(transaction, task_id, "soft_deleted", Some(current.as_str()), Some("deleted"), source, None)
}

fn load_task_in_transaction(transaction: &Transaction<'_>, id: &str) -> AppResult<TaskRow> {
    transaction.query_row(
        "SELECT id, title, priority, estimated_minutes, earliest_start_at, due_at, splittable, status FROM tasks WHERE id = ?1", [id],
        |row| Ok(TaskRow {
            title: row.get(1)?, priority: row.get(2)?, estimated_minutes: row.get(3)?,
            earliest_start_at: row.get(4)?, due_at: row.get(5)?,
            splittable: row.get::<_, i64>(6)? != 0, status: TaskStatus::parse(&row.get::<_, String>(7)?).map_err(to_sql_error)?,
        }),
    ).optional()?.ok_or_else(|| AppError::NotFound(format!("任务 {id}")))
}

fn validate_task_draft_input(input: &TaskDraftInput, require_title: bool) -> AppResult<()> {
    if !matches!(input.item_type.as_str(), "task" | "recurring") {
        return Err(AppError::Schema("任务类型无效".into()));
    }
    if input.item_type == "recurring" && input.recurring_settings.is_none() {
        return Err(AppError::Schema("重复事项草稿缺少重复设置".into()));
    }
    if input.title.chars().count() > 300 {
        return Err(AppError::Schema("任务标题不能超过 300 个字符".into()));
    }
    if require_title {
        crate::domain::validate_title(&input.title)?;
    }
    crate::domain::validate_date_constraints(
        &input.earliest_start_date,
        &input.earliest_start_time,
        &input.due_date,
        &input.due_time,
    )?;
    crate::domain::validate_workload(input.total_workload_minutes, "总工作量", false)?;
    crate::domain::validate_workload(input.remaining_workload_minutes, "剩余工作量", true)?;
    let field_states: std::collections::BTreeMap<String, crate::domain::DraftFieldState> =
        serde_json::from_str(&input.field_states_json)
            .map_err(|_| AppError::Schema("字段状态必须是合法 JSON 对象".into()))?;
    let allowed_fields = [
        "title",
        "notes",
        "priority",
        "earliest_start_date",
        "earliest_start_time",
        "due_date",
        "due_time",
        "total_workload_minutes",
        "remaining_workload_minutes",
    ];
    if field_states.keys().any(|field| !allowed_fields.contains(&field.as_str())) {
        return Err(AppError::Schema("字段状态包含未知任务字段".into()));
    }
    normalize_tags(&input.tags)?;
    if let Some(recurrence) = &input.recurrence { validate_recurrence(recurrence)?; }
    Ok(())
}

fn ensure_task_not_moved_into_history(task: &TaskDto, start: Option<&str>, due: Option<&str>) -> AppResult<()> {
    if task.earliest_start_date.as_deref() == start && task.due_date.as_deref() == due {
        return Ok(());
    }
    let today = shanghai_today();
    let historical_multiday = start != due && start.is_some_and(|date| date < today.as_str());
    if historical_multiday || (task.due_date.as_deref().is_some_and(|date| date >= today.as_str())
        && due.is_some_and(|date| date < today.as_str())) {
        return Err(AppError::Domain("当日或未来任务不能改为历史任务，请新建历史单日任务补录".into()));
    }
    Ok(())
}

fn validate_new_task_history(start: Option<&str>, due: Option<&str>) -> AppResult<bool> {
    let today = shanghai_today();
    let historical = due.is_some_and(|date| date < today.as_str());
    if start != due && (historical || start.is_some_and(|date| date < today.as_str())) {
        return Err(AppError::Domain("历史日期只允许创建单日任务".into()));
    }
    Ok(historical)
}

fn validate_confirmable_task_input(input: &TaskDraftInput) -> AppResult<()> {
    crate::domain::validate_complete_task_schedule(
        &input.earliest_start_date,
        &input.earliest_start_time,
        &input.due_date,
        &input.due_time,
    )
}

fn normalize_tags(tags: &[String]) -> AppResult<Vec<String>> {
    let mut normalized = Vec::new();
    let mut seen = HashSet::new();
    for raw in tags {
        let value = raw.trim();
        if value.is_empty() { continue; }
        if value.chars().count() > 30 {
            return Err(AppError::Schema("单个标签不能超过 30 个字符".into()));
        }
        let key = value.to_lowercase();
        if seen.insert(key) { normalized.push(value.to_string()); }
    }
    Ok(normalized)
}

fn validate_recurrence(input: &RecurrenceInput) -> AppResult<()> {
    if !matches!(input.frequency.as_str(), "daily" | "weekdays" | "weekly" | "monthly") {
        return Err(AppError::Schema("未知重复频率".into()));
    }
    if !(1..=365).contains(&input.interval_value) {
        return Err(AppError::Schema("重复周期必须在 1 至 365 之间".into()));
    }
    let starts_on = parse_plan_date(&input.starts_on)?;
    if let Some(ends_on) = &input.ends_on {
        let ends_on = parse_plan_date(ends_on)?;
        if ends_on < starts_on { return Err(AppError::Domain("重复结束日期不能早于开始日期".into())); }
    }
    if input.weekdays.iter().any(|day| !(1..=7).contains(day)) {
        return Err(AppError::Schema("重复星期必须为 1 至 7".into()));
    }
    if input.frequency == "weekly" && input.weekdays.is_empty() {
        return Err(AppError::Schema("每周重复至少选择一个星期".into()));
    }
    if input.frequency == "monthly" && !matches!(input.month_day, Some(1..=31)) {
        return Err(AppError::Schema("每月重复必须选择 1 至 31 日".into()));
    }
    Ok(())
}

fn insert_recurring_item(transaction: &Transaction<'_>, input: &RecurringItemInput, source_type: &str) -> AppResult<RecurringItemDto> {
    database_tags::register_tags(transaction, &input.tags)?;
    let id = Uuid::new_v4().to_string();
    let timestamp = now();
    transaction.execute(
        "INSERT INTO recurring_items (
            id, title, notes, frequency, interval_value, weekdays_json, month_day,
            starts_on, ends_on, display_time, display_duration_minutes, tags_json, status, created_at, updated_at, source_type
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'active', ?13, ?13, ?14)",
        params![
            id, input.title, input.notes, input.frequency, input.interval_value,
            serde_json::to_string(&input.weekdays)?, input.month_day, input.starts_on,
            input.ends_on, input.display_time, input.display_duration_minutes, serde_json::to_string(&input.tags)?, timestamp, source_type,
        ],
    )?;
    let item = load_recurring_item_in_transaction(transaction, &id)?;
    database_recurring::insert_initial_version(transaction, &item)?;
    Ok(item)
}

fn recurring_input_for_draft(title: &str, notes: &Option<String>, tags: &[String], settings: Option<&RecurringDraftSettings>) -> AppResult<RecurringItemInput> {
    let settings = settings.ok_or_else(|| AppError::Schema("重复事项草稿缺少重复设置".into()))?;
    Ok(RecurringItemInput {
        title: title.into(), notes: notes.clone(), tags: tags.to_vec(),
        frequency: settings.frequency.clone(), interval_value: settings.interval_value,
        weekdays: settings.weekdays.clone(), month_day: settings.month_day,
        starts_on: settings.starts_on.clone(), ends_on: settings.ends_on.clone(),
        display_time: settings.display_time.clone(), display_duration_minutes: settings.display_duration_minutes,
    })
}

fn normalize_recurring_item_input(mut input: RecurringItemInput) -> AppResult<RecurringItemInput> {
    input.title = input.title.trim().to_owned();
    if input.title.is_empty() {
        return Err(AppError::Schema("重复事项标题不能为空".into()));
    }
    if input.title.chars().count() > 300 {
        return Err(AppError::Schema("重复事项标题不能超过 300 个字符".into()));
    }
    input.notes = normalize_review_text(input.notes, 2000, "重复事项备注")?;
    input.tags = normalize_tags(&input.tags)?;
    input.weekdays.sort_unstable();
    input.weekdays.dedup();
    let recurrence = RecurrenceInput {
        frequency: input.frequency.clone(),
        interval_value: input.interval_value,
        weekdays: input.weekdays.clone(),
        month_day: input.month_day,
        starts_on: input.starts_on.clone(),
        ends_on: input.ends_on.clone(),
    };
    validate_recurrence(&recurrence)?;
    input.starts_on = parse_plan_date(&input.starts_on)?.to_string();
    input.ends_on = input.ends_on.as_deref().map(parse_plan_date).transpose()?.map(|date| date.to_string());
    input.display_time = input.display_time
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    match (&input.display_time, input.display_duration_minutes) {
        (Some(display_time), Some(duration_minutes)) => {
            let display_time = NaiveTime::parse_from_str(display_time, "%H:%M")
                .map_err(|_| AppError::Schema("展示时间必须使用 HH:MM 格式".into()))?;
            if !(1..=1440).contains(&duration_minutes) {
                return Err(AppError::Schema("重复事项预计时长必须在 1 至 1440 分钟之间".into()));
            }
            let start_minutes = display_time.num_seconds_from_midnight() as i64 / 60;
            if start_minutes + duration_minutes > 1440 {
                return Err(AppError::Schema("重复事项展示时间与预计时长不能跨越当天 24:00".into()));
            }
            input.display_time = Some(display_time.format("%H:%M").to_string());
        }
        (Some(_), None) => return Err(AppError::Schema("填写展示时间后还需填写重复事项预计时长".into())),
        (None, Some(_)) => return Err(AppError::Schema("填写重复事项预计时长前请先设置展示时间".into())),
        (None, None) => return Err(AppError::Schema("重复事项必须填写展示时间和预计时长".into())),
    }
    Ok(input)
}

fn recurring_item_dto_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RecurringItemDto> {
    let weekdays_json: String = row.get(5)?;
    let tags_json: String = row.get(11)?;
    Ok(RecurringItemDto {
        id: row.get(0)?,
        title: row.get(1)?,
        notes: row.get(2)?,
        frequency: row.get(3)?,
        interval_value: row.get(4)?,
        weekdays: serde_json::from_str(&weekdays_json).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(5, rusqlite::types::Type::Text, Box::new(error))
        })?,
        month_day: row.get(6)?,
        starts_on: row.get(7)?,
        ends_on: row.get(8)?,
        display_time: row.get(9)?,
        display_duration_minutes: row.get(10)?,
        tags: serde_json::from_str(&tags_json).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(11, rusqlite::types::Type::Text, Box::new(error))
        })?,
        status: row.get(12)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
        deleted_at: row.get(15)?,
        source_type: row.get(16)?,
    })
}

fn recurring_occurrence_dto_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RecurringOccurrenceDto> {
    let tags_json: String = row.get(7)?;
    Ok(RecurringOccurrenceDto {
        id: row.get(0)?,
        recurring_item_id: row.get(1)?,
        title: row.get(2)?,
        notes: row.get(3)?,
        occurrence_date: row.get(4)?,
        display_time: row.get(5)?,
        display_duration_minutes: row.get(6)?,
        tags: serde_json::from_str(&tags_json).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(7, rusqlite::types::Type::Text, Box::new(error))
        })?,
        outcome: row.get(8)?,
        review_notes: row.get(9)?,
        reviewed_at: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
        schedule_rule: None,
    })
}

fn load_recurring_item_in_transaction(transaction: &Transaction<'_>, item_id: &str) -> AppResult<RecurringItemDto> {
    transaction.query_row(
        "SELECT id, title, notes, frequency, interval_value, weekdays_json, month_day,
                starts_on, ends_on, display_time, display_duration_minutes, tags_json, status, created_at, updated_at, deleted_at, source_type
         FROM recurring_items WHERE id = ?1",
        [item_id],
        recurring_item_dto_from_row,
    ).optional()?.ok_or_else(|| AppError::NotFound(format!("重复事项 {item_id}")))
}

fn weekday_interval_matches(calendar: &HolidaySnapshot, start: NaiveDate, date: NaiveDate, interval: i64) -> bool {
    if interval < 1 || !calendar.covers(start, date) || calendar.workday_on(date) != Some(true) {
        return false;
    }
    let workdays = (0..=(date - start).num_days())
        .filter(|offset| calendar.workday_on(start + Duration::days(*offset)) == Some(true))
        .count() as i64;
    (workdays - 1) % interval == 0
}

fn recurring_item_occurs_on(calendar: &HolidaySnapshot, item: &RecurringItemDto, date: NaiveDate) -> AppResult<bool> {
    let start = parse_plan_date(&item.starts_on)?;
    if date < start { return Ok(false); }
    if item.ends_on.as_deref().map(parse_plan_date).transpose()?.is_some_and(|end| date > end) {
        return Ok(false);
    }
    let days = (date - start).num_days();
    let weeks = days.div_euclid(7);
    let matches = match item.frequency.as_str() {
        "daily" => days % item.interval_value == 0,
        "weekdays" => weekday_interval_matches(calendar, start, date, item.interval_value),
        "weekly" => item.weekdays.contains(&date.weekday().number_from_monday()) && weeks % item.interval_value == 0,
        "monthly" => date.day() == item.month_day.unwrap_or(1)
            && ((date.year() - start.year()) as i64 * 12 + date.month() as i64 - start.month() as i64)
                % item.interval_value == 0,
        _ => false,
    };
    Ok(matches)
}

fn draft_validation_status(input: &TaskDraftInput) -> &'static str {
    if input.item_type == "recurring" {
        return if recurring_input_for_draft(&input.title, &input.notes, &input.tags, input.recurring_settings.as_ref()).and_then(normalize_recurring_item_input).is_ok() { "valid" } else { "needs_confirmation" };
    }
    if input.title.trim().is_empty()
        || input.earliest_start_date.is_none()
        || input.earliest_start_time.is_none()
        || input.due_date.is_none()
        || input.due_time.is_none()
    {
        "needs_confirmation"
    } else {
        "valid"
    }
}

fn legacy_timestamp(date: Option<&str>, time: Option<&str>) -> Option<String> {
    match (date, time) {
        (Some(date), Some(time)) => Some(format!("{date}T{time}:00+08:00")),
        _ => None,
    }
}

fn split_legacy_timestamp(value: Option<&str>) -> (Option<String>, Option<String>) {
    match value {
        Some(value) if value.len() >= 16 => (Some(value[0..10].to_string()), Some(value[11..16].to_string())),
        _ => (None, None),
    }
}

fn parse_priority(value: &str) -> AppResult<Priority> {
    match value {
        "low" => Ok(Priority::Low),
        "medium" => Ok(Priority::Medium),
        "high" => Ok(Priority::High),
        "urgent" => Ok(Priority::Urgent),
        _ => Err(AppError::Domain(format!("未知优先级：{value}"))),
    }
}

fn load_task_draft_in_transaction(transaction: &Transaction<'_>, id: &str) -> AppResult<TaskDraftDto> {
    let draft = transaction
        .query_row(
            "SELECT id, draft_kind, target_task_id, source_type, conversation_id,
                    title, notes, priority, earliest_start_date, earliest_start_time,
                    due_date, due_time, total_workload_minutes, remaining_workload_minutes,
                    splittable, field_states_json, validation_status, version,
                    confirmation_token, status, confirmed_task_id, created_at, updated_at, confirmed_at,
                    tags_json, recurrence_json, item_type, recurring_settings_json, confirmed_recurring_item_id
             FROM task_drafts WHERE id = ?1",
            [id],
            task_draft_dto_from_row,
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("任务草稿 {id}")))?;
    Ok(draft)
}

fn task_draft_dto_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TaskDraftDto> {
    let tags_json: String = row.get(24)?;
    let recurrence_json: Option<String> = row.get(25)?;
    let recurring_settings_json: Option<String> = row.get(27)?;
    Ok(TaskDraftDto {
        item_type: row.get(26)?,
        recurring_settings: recurring_settings_json.map(|value| serde_json::from_str(&value)).transpose().map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(27, rusqlite::types::Type::Text, Box::new(error))
        })?,
        confirmed_recurring_item_id: row.get(28)?,
        id: row.get(0)?,
        draft_kind: row.get(1)?,
        target_task_id: row.get(2)?,
        source_type: row.get(3)?,
        conversation_id: row.get(4)?,
        title: row.get(5)?,
        notes: row.get(6)?,
        priority: row.get(7)?,
        earliest_start_date: row.get(8)?,
        earliest_start_time: row.get(9)?,
        due_date: row.get(10)?,
        due_time: row.get(11)?,
        total_workload_minutes: row.get(12)?,
        remaining_workload_minutes: row.get(13)?,
        splittable: row.get::<_, i64>(14)? != 0,
        field_states_json: row.get(15)?,
        validation_status: row.get(16)?,
        version: row.get(17)?,
        confirmation_token: row.get(18)?,
        status: row.get(19)?,
        confirmed_task_id: row.get(20)?,
        created_at: row.get(21)?,
        updated_at: row.get(22)?,
        confirmed_at: row.get(23)?,
        tags: serde_json::from_str(&tags_json).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(24, rusqlite::types::Type::Text, Box::new(error))
        })?,
        recurrence: recurrence_json.map(|value| serde_json::from_str(&value)).transpose().map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(25, rusqlite::types::Type::Text, Box::new(error))
        })?,
    })
}

fn record_initial_estimates(
    transaction: &Transaction<'_>,
    task_id: &str,
    total_minutes: Option<i64>,
    remaining_minutes: Option<i64>,
    source: &str,
) -> AppResult<()> {
    for (kind, minutes) in [("total", total_minutes), ("remaining", remaining_minutes)] {
        if let Some(minutes) = minutes {
            transaction.execute(
                "INSERT INTO task_estimates
                    (id, task_id, estimate_kind, old_minutes, new_minutes, source, created_at)
                 VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6)",
                params![Uuid::new_v4().to_string(), task_id, kind, minutes, source, now()],
            )?;
        }
    }
    Ok(())
}

fn apply_task_tags(transaction: &Transaction<'_>, task_id: &str, tags: &[String]) -> AppResult<()> {
    let previous = load_task_dto_in_transaction(transaction, task_id)?.tags;
    apply_task_tags_with_previous(transaction, task_id, tags, &previous)
}

fn apply_task_tags_with_previous(transaction: &Transaction<'_>, task_id: &str, tags: &[String], previous: &[String]) -> AppResult<()> {
    let tags = database_tags::validate_selection(tags, previous)?;
    let ids = database_tags::register_tags(transaction, &tags)?;
    transaction.execute("DELETE FROM task_tags WHERE task_id = ?1", [task_id])?;
    for tag_id in ids {
        transaction.execute("INSERT INTO task_tags (task_id, tag_id) VALUES (?1, ?2)", params![task_id, tag_id])?;
    }
    Ok(())
}

#[derive(Debug)]
struct RecurrenceTaskSeed {
    title: String,
    notes: Option<String>,
    priority: Option<String>,
    earliest_start_date: Option<String>,
    earliest_start_time: Option<String>,
    due_date: Option<String>,
    due_time: Option<String>,
    total_workload_minutes: Option<i64>,
    remaining_workload_minutes: Option<i64>,
    source_type: String,
}

fn recurrence_dates(input: &RecurrenceInput, calendar: &HolidaySnapshot) -> AppResult<Vec<NaiveDate>> {
    validate_recurrence(input)?;
    let start = parse_plan_date(&input.starts_on)?;
    let configured_end = input.ends_on.as_deref().map(parse_plan_date).transpose()?;
    let end = configured_end.unwrap_or(start + Duration::days(366)).min(start + Duration::days(366));
    let selected: HashSet<u32> = input.weekdays.iter().copied().collect();
    let mut dates = Vec::new();
    let mut date = start;
    while date <= end {
        let days = (date - start).num_days();
        let weeks = days.div_euclid(7);
        let matches = match input.frequency.as_str() {
            "daily" => days % input.interval_value == 0,
            "weekdays" => weekday_interval_matches(calendar, start, date, input.interval_value),
            "weekly" => selected.contains(&date.weekday().number_from_monday()) && weeks % input.interval_value == 0,
            "monthly" => date.day() == input.month_day.unwrap_or(1)
                && ((date.year() - start.year()) as i64 * 12 + date.month() as i64 - start.month() as i64) % input.interval_value == 0,
            _ => false,
        };
        if matches { dates.push(date); }
        date += Duration::days(1);
    }
    if dates.is_empty() || dates[0] != start {
        dates.insert(0, start);
    }
    Ok(dates)
}

fn shifted_date(value: Option<&str>, anchor: NaiveDate, occurrence: NaiveDate) -> AppResult<Option<String>> {
    value.map(|value| {
        let parsed = parse_plan_date(value)?;
        Ok((parsed + (occurrence - anchor)).format("%Y-%m-%d").to_string())
    }).transpose()
}

fn create_recurrence_series_with_parent(
    transaction: &Transaction<'_>,
    base_task_id: &str,
    input: &RecurrenceInput,
    parent_rule_id: Option<&str>,
    calendar: &HolidaySnapshot,
) -> AppResult<String> {
    let dates = recurrence_dates(input, calendar)?;
    let anchor = parse_plan_date(&input.starts_on)?;
    let seed = transaction.query_row(
        "SELECT title, notes, priority, earliest_start_date, earliest_start_time,
                due_date, due_time, total_workload_minutes, remaining_workload_minutes, source_type
         FROM tasks WHERE id = ?1",
        [base_task_id],
        |row| Ok(RecurrenceTaskSeed {
            title: row.get(0)?, notes: row.get(1)?, priority: row.get(2)?,
            earliest_start_date: row.get(3)?, earliest_start_time: row.get(4)?,
            due_date: row.get(5)?, due_time: row.get(6)?,
            total_workload_minutes: row.get(7)?, remaining_workload_minutes: row.get(8)?,
            source_type: row.get(9)?,
        }),
    )?;
    let rule_id = Uuid::new_v4().to_string();
    let weekdays_json = if input.weekdays.is_empty() { None } else { Some(serde_json::to_string(&input.weekdays)?) };
    let timestamp = now();
    transaction.execute(
        "INSERT INTO recurrence_rules
            (id, frequency, interval_value, weekdays_json, month_day, starts_on, ends_on, status, parent_rule_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'active', ?8, ?9, ?9)",
        params![rule_id, input.frequency, input.interval_value, weekdays_json, input.month_day, input.starts_on, input.ends_on, parent_rule_id, timestamp],
    )?;

    for (sequence, occurrence) in dates.into_iter().enumerate() {
        let task_id = if sequence == 0 {
            let earliest = shifted_date(seed.earliest_start_date.as_deref(), anchor, occurrence)?.or(Some(occurrence.format("%Y-%m-%d").to_string()));
            let due = shifted_date(seed.due_date.as_deref(), anchor, occurrence)?.or_else(|| earliest.clone());
            let earliest_at = legacy_timestamp(earliest.as_deref(), seed.earliest_start_time.as_deref());
            let due_at = legacy_timestamp(due.as_deref(), seed.due_time.as_deref());
            transaction.execute(
                "UPDATE tasks SET earliest_start_date = ?2, due_date = ?3,
                    earliest_start_at = ?4, due_at = ?5, status = 'open', updated_at = ?6 WHERE id = ?1",
                params![
                    base_task_id,
                    earliest, due, earliest_at, due_at,
                    timestamp,
                ],
            )?;
            base_task_id.to_string()
        } else {
            let task_id = Uuid::new_v4().to_string();
            let earliest = shifted_date(seed.earliest_start_date.as_deref(), anchor, occurrence)?.or(Some(occurrence.format("%Y-%m-%d").to_string()));
            let due = shifted_date(seed.due_date.as_deref(), anchor, occurrence)?.or_else(|| earliest.clone());
            let earliest_at = legacy_timestamp(earliest.as_deref(), seed.earliest_start_time.as_deref());
            let due_at = legacy_timestamp(due.as_deref(), seed.due_time.as_deref());
            transaction.execute(
                "INSERT INTO tasks (
                    id, title, notes, priority, earliest_start_at, due_at, estimated_minutes,
                    earliest_start_date, earliest_start_time, due_date, due_time,
                    total_workload_minutes, remaining_workload_minutes, actual_minutes,
                    source_type, migration_review_required, splittable, status, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 0, ?14, 0, 1, 'open', ?15, ?15)",
                params![
                    task_id, &seed.title, seed.notes.as_deref(), seed.priority.as_deref(), earliest_at, due_at,
                    seed.total_workload_minutes, earliest, seed.earliest_start_time.as_deref(),
                    due, seed.due_time.as_deref(), seed.total_workload_minutes,
                    seed.remaining_workload_minutes.or(seed.total_workload_minutes), &seed.source_type, timestamp,
                ],
            )?;
            transaction.execute(
                "INSERT INTO task_tags (task_id, tag_id) SELECT ?1, tag_id FROM task_tags WHERE task_id = ?2",
                params![task_id, base_task_id],
            )?;
            record_task_change(transaction, &task_id, "created_from_recurrence", None, Some("open"), "system", Some(&format!("recurrence_rule:{rule_id}")))?;
            task_id
        };
        transaction.execute(
            "INSERT INTO recurrence_instances (id, recurrence_rule_id, task_id, occurrence_date, sequence_number)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![Uuid::new_v4().to_string(), rule_id, task_id, occurrence.format("%Y-%m-%d").to_string(), sequence as i64],
        )?;
    }
    Ok(rule_id)
}

fn update_task_from_draft_input(
    transaction: &Transaction<'_>,
    task_id: &str,
    input: &TaskDraftInput,
    timestamp: &str,
) -> AppResult<()> {
    let earliest_start_at = legacy_timestamp(input.earliest_start_date.as_deref(), input.earliest_start_time.as_deref());
    let due_at = legacy_timestamp(input.due_date.as_deref(), input.due_time.as_deref());
    let changed = transaction.execute(
        "UPDATE tasks SET title = ?2, notes = ?3, priority = ?4,
            earliest_start_at = ?5, due_at = ?6, estimated_minutes = ?7,
            earliest_start_date = ?8, earliest_start_time = ?9,
            due_date = ?10, due_time = ?11, total_workload_minutes = ?12,
            remaining_workload_minutes = ?13, migration_review_required = 0,
            updated_at = ?14 WHERE id = ?1",
        params![
            task_id, input.title.trim(), input.notes.as_deref(), input.priority.map(Priority::as_str),
            earliest_start_at, due_at, input.total_workload_minutes,
            input.earliest_start_date.as_deref(), input.earliest_start_time.as_deref(),
            input.due_date.as_deref(), input.due_time.as_deref(),
            input.total_workload_minutes, input.remaining_workload_minutes.or(input.total_workload_minutes), timestamp,
        ],
    )?;
    if changed != 1 { return Err(AppError::NotFound(format!("任务 {task_id}"))); }
    Ok(())
}

fn load_task_dto_in_transaction(transaction: &Connection, id: &str) -> AppResult<TaskDto> {
    transaction
        .query_row(
            "SELECT task.id, task.title, task.notes, task.priority, task.earliest_start_at, task.due_at, task.estimated_minutes,
                    earliest_start_date, earliest_start_time, due_date, due_time,
                    total_workload_minutes, remaining_workload_minutes, actual_minutes,
                    source_type, migration_review_required,
                    splittable, status, deleted_at, created_at, task.updated_at,
                    COALESCE((
                        SELECT SUM(CAST(ROUND((julianday(pb.ends_at) - julianday(pb.starts_at)) * 1440) AS INTEGER))
                        FROM plan_blocks pb
                        JOIN daily_plans dp ON dp.id = pb.daily_plan_id
                        WHERE pb.task_id = task.id
                          AND dp.status = 'confirmed'
                          AND NOT EXISTS (SELECT 1 FROM review_entries review WHERE review.plan_block_id = pb.id)
                        ), 0),
                        COALESCE((
                            SELECT json_group_array(scheduled_date) FROM (
                                SELECT DISTINCT substr(pb.starts_at, 1, 10) AS scheduled_date
                                FROM plan_blocks pb
                                JOIN daily_plans dp ON dp.id = pb.daily_plan_id
                                WHERE pb.task_id = task.id AND dp.status = 'confirmed'
                                ORDER BY scheduled_date
                            )
                        ), '[]'),
                        COALESCE((
                            SELECT json_group_array(name) FROM (
                                SELECT tag.name AS name FROM tags tag
                                JOIN task_tags relation ON relation.tag_id = tag.id
                                WHERE relation.task_id = task.id ORDER BY tag.name COLLATE NOCASE
                            )
                        ), '[]'),
                        COALESCE(substr(task.earliest_start_at, 1, 10) = substr(task.due_at, 1, 10), 0)
                        AND ((task.actual_minutes > 0 AND NOT EXISTS(SELECT 1 FROM review_entries permission
                            WHERE permission.task_id = task.id AND permission.followup_action IN ('schedule','wait','stop'))) OR EXISTS(
                            SELECT 1 FROM plan_blocks fact WHERE fact.task_id = task.id
                            AND NOT EXISTS(SELECT 1 FROM review_entries resolved WHERE resolved.plan_block_id = fact.id
                                AND resolved.followup_action IN ('schedule','wait','stop'))
                            AND (fact.execution_status <> 'planned' OR fact.execution_captured_at IS NOT NULL
                                OR COALESCE(fact.actual_minutes, 0) > 0
                                OR EXISTS(SELECT 1 FROM review_entries review WHERE review.plan_block_id = fact.id))
                        ))
                        , task.result_date, task.result_ends_at
                        , task.status IN ('open', 'scheduled') AND task.deleted_at IS NULL AND COALESCE((
                            SELECT COALESCE(review.outcome, fact.execution_status) IN ('not_started', 'partial', 'blocked', 'cancelled')
                                AND NOT EXISTS (
                                    SELECT 1 FROM plan_blocks pending JOIN daily_plans future ON future.id = pending.daily_plan_id
                                    WHERE pending.task_id = task.id AND future.status = 'confirmed' AND future.plan_date >= ?2
                                        AND pending.starts_at > fact.starts_at AND pending.execution_status = 'planned'
                                        AND pending.execution_captured_at IS NULL AND COALESCE(pending.actual_minutes, 0) = 0
                                        AND NOT EXISTS (SELECT 1 FROM review_entries resolved WHERE resolved.plan_block_id = pending.id)
                                )
                            FROM plan_blocks fact JOIN daily_plans recorded ON recorded.id = fact.daily_plan_id
                            LEFT JOIN review_entries review ON review.plan_block_id = fact.id
                            WHERE fact.task_id = task.id AND recorded.status = 'confirmed'
                                AND COALESCE(review.outcome, fact.execution_status) <> 'planned'
                            ORDER BY fact.starts_at DESC, fact.id LIMIT 1
                        ), 0)
             FROM tasks task WHERE task.id = ?1",
            params![id, shanghai_today()],
            task_dto_from_row,
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("任务 {id}")))
}

fn task_dto_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TaskDto> {
    let scheduled_dates_json: String = row.get(22)?;
    let scheduled_dates = serde_json::from_str(&scheduled_dates_json).map_err(|error| rusqlite::Error::FromSqlConversionFailure(
        22, rusqlite::types::Type::Text, Box::new(error),
    ))?;
    let tags_json: String = row.get(23)?;
    let tags = serde_json::from_str(&tags_json).map_err(|error| rusqlite::Error::FromSqlConversionFailure(
        23, rusqlite::types::Type::Text, Box::new(error),
    ))?;
    Ok(TaskDto {
        id: row.get(0)?,
        title: row.get(1)?,
        notes: row.get(2)?,
        priority: row.get(3)?,
        earliest_start_at: row.get(4)?,
        due_at: row.get(5)?,
        estimated_minutes: row.get(6)?,
        earliest_start_date: row.get(7)?,
        earliest_start_time: row.get(8)?,
        due_date: row.get(9)?,
        due_time: row.get(10)?,
        total_workload_minutes: row.get(11)?,
        remaining_workload_minutes: row.get(12)?,
        actual_minutes: row.get(13)?,
        source_type: row.get(14)?,
        migration_review_required: row.get::<_, i64>(15)? != 0,
        splittable: row.get::<_, i64>(16)? != 0,
        status: row.get(17)?,
        deleted_at: row.get(18)?,
        created_at: row.get(19)?,
        updated_at: row.get(20)?,
        reserved_minutes: row.get(21)?,
        scheduled_dates,
        tags,
        execution_locked: row.get::<_, bool>(24)? || row.get::<_, Option<String>>(25)?.is_some_and(|date| date < shanghai_today()),
        result_date: row.get(25)?,
        result_ends_at: row.get(26)?,
        is_incomplete: row.get(27)?,
    })
}

fn stored_rule_plan_draft_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredRulePlanDraft> {
    let blocks_json: String = row.get(2)?;
    let unscheduled_json: String = row.get(3)?;
    let blocks = serde_json::from_str(&blocks_json).map_err(|error| rusqlite::Error::FromSqlConversionFailure(
        2, rusqlite::types::Type::Text, Box::new(error),
    ))?;
    let unscheduled = serde_json::from_str(&unscheduled_json).map_err(|error| rusqlite::Error::FromSqlConversionFailure(
        3, rusqlite::types::Type::Text, Box::new(error),
    ))?;
    Ok(StoredRulePlanDraft {
        preview: RulePlanPreview {
            preview_id: row.get(0)?,
            plan_date: row.get(1)?,
            base_plan_id: row.get(9)?,
            blocks,
            unscheduled,
            generated_at: row.get(4)?,
            version: row.get(5)?,
            confirmation_token: row.get(6)?,
        },
        facts_json: row.get(7)?,
        status: row.get(8)?,
    })
}

fn rule_plan_facts_json_from_connection(connection: &Connection, plan_date: &str) -> AppResult<String> {
    let tasks = {
        let mut task_statement = connection.prepare(
            "SELECT id, status, updated_at, COALESCE(remaining_workload_minutes, estimated_minutes, -1)
             FROM tasks
             WHERE status IN ('open', 'scheduled')
               AND earliest_start_at IS NOT NULL
               AND due_at IS NOT NULL
             ORDER BY id",
        )?;
        let rows = task_statement.query_map([], |row| Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i64>(3)?,
        )))?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    let confirmed_plan = {
        let mut plan_statement = connection.prepare(
            "SELECT dp.id, pb.id, pb.task_id, pb.starts_at, pb.ends_at, pb.execution_status,
                    pb.updated_at, EXISTS(SELECT 1 FROM review_entries review WHERE review.plan_block_id = pb.id)
             FROM daily_plans dp
             JOIN plan_blocks pb ON pb.daily_plan_id = dp.id
             WHERE dp.plan_date = ?1 AND dp.status = 'confirmed'
             ORDER BY pb.id",
        )?;
        let rows = plan_statement.query_map([plan_date], |row| Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, String>(6)?,
            row.get::<_, bool>(7)?,
        )))?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    // Fixed events, other time blocks and work-time preferences may overlap this draft
    // without invalidating it. Only task and execution/review facts are confirmation facts.
    Ok(serde_json::to_string(&(tasks, confirmed_plan))?)
}

fn load_rule_plan_draft_by_id(connection: &Connection, preview_id: &str) -> AppResult<Option<StoredRulePlanDraft>> {
    Ok(connection.query_row(
        "SELECT id, plan_date, blocks_json, unscheduled_json, updated_at,
                version, confirmation_token, facts_json, status, base_plan_id
         FROM daily_plan_drafts WHERE id = ?1",
        [preview_id],
        stored_rule_plan_draft_from_row,
    ).optional()?)
}

fn load_rule_plan_draft_for_date(connection: &Connection, plan_date: &str) -> AppResult<Option<StoredRulePlanDraft>> {
    Ok(connection.query_row(
        "SELECT id, plan_date, blocks_json, unscheduled_json, updated_at,
                version, confirmation_token, facts_json, status, base_plan_id
         FROM daily_plan_drafts
         WHERE plan_date = ?1 AND status = 'active'
         ORDER BY updated_at DESC LIMIT 1",
        [plan_date],
        stored_rule_plan_draft_from_row,
    ).optional()?)
}

fn validate_plan_blocks_in_date(
    plan_date: &str,
    blocks: &[crate::domain::ProposedPlanBlock],
) -> AppResult<()> {
    for block in blocks {
        if !block.starts_at.starts_with(plan_date) { return Err(AppError::Domain("时间块必须属于计划日期".into())); }
    }
    Ok(())
}

fn record_task_change(transaction: &Transaction<'_>, task_id: &str, kind: &str, old_value: Option<&str>, new_value: Option<&str>, source: &str, reason: Option<&str>) -> AppResult<()> {
    transaction.execute(
        "INSERT INTO task_changes (id, task_id, change_kind, old_value, new_value, source, reason, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![Uuid::new_v4().to_string(), task_id, kind, old_value, new_value, source, reason, now()],
    )?;
    Ok(())
}

fn record_undo_entry(
    transaction: &Transaction<'_>,
    action_kind: &str,
    target_type: &str,
    target_id: &str,
    before_json: &str,
    expected_updated_at: Option<&str>,
) -> AppResult<String> {
    let id = Uuid::new_v4().to_string();
    let created_at = DateTime::parse_from_rfc3339(&now()).expect("backend timestamp").with_timezone(&Utc);
    transaction.execute(
        "UPDATE undo_entries SET status = 'expired'
         WHERE status = 'available' AND expires_at < ?1",
        [created_at.to_rfc3339()],
    )?;
    transaction.execute(
        "INSERT INTO undo_entries
            (id, action_kind, target_type, target_id, before_json, expected_updated_at,
             status, expires_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'available', ?7, ?8)",
        params![
            id, action_kind, target_type, target_id, before_json, expected_updated_at,
            (created_at + Duration::seconds(10)).to_rfc3339(), created_at.to_rfc3339(),
        ],
    )?;
    Ok(id)
}

fn undo_entry_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<UndoEntryDto> {
    Ok(UndoEntryDto {
        id: row.get(0)?, action_kind: row.get(1)?, target_type: row.get(2)?,
        target_id: row.get(3)?, expires_at: row.get(4)?, status: row.get(5)?,
    })
}

fn upsert_setting(transaction: &Transaction<'_>, key: &str, value: &str) -> AppResult<()> {
    transaction.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, value, now()],
    )?;
    Ok(())
}

fn normalize_conversation_title(value: &str) -> AppResult<String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 80 {
        return Err(AppError::Domain("对话名称必须为 1 至 80 个字符".into()));
    }
    Ok(value.to_owned())
}

fn prompt_needs_task_candidates(prompt: &str) -> bool {
    ["修改", "调整", "更新", "延期", "改成", "优先级", "已有任务", "这个任务", "完成", "删除", "安排", "计划"]
        .iter().any(|keyword| prompt.contains(keyword))
}

fn ai_conversation_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AiConversationDto> {
    Ok(AiConversationDto {
        id: row.get(0)?, title: row.get(1)?, status: row.get(2)?,
        message_count: row.get(3)?, draft_count: row.get(4)?, created_at: row.get(5)?,
        updated_at: row.get(6)?, archived_at: row.get(7)?,
    })
}

fn ai_message_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AiMessageDto> {
    Ok(AiMessageDto {
        id: row.get(0)?, conversation_id: row.get(1)?, run_id: row.get(2)?,
        role: row.get(3)?, content: row.get(4)?, stream_status: row.get(5)?,
        created_at: row.get(6)?, updated_at: row.get(7)?,
    })
}

fn ai_run_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AiRunDto> {
    Ok(AiRunDto {
        id: row.get(0)?, conversation_id: row.get(1)?, run_status: row.get(2)?,
        assistant_message: row.get(3)?, error_message: row.get(4)?, created_at: row.get(5)?,
        updated_at: row.get(6)?, stopped_at: row.get(7)?,
    })
}

fn load_ai_run_in_transaction(transaction: &Transaction<'_>, run_id: &str) -> AppResult<AiRunDto> {
    transaction.query_row(
        "SELECT id, conversation_id, run_status, assistant_message, error_message, created_at, updated_at, stopped_at
         FROM ai_runs WHERE id = ?1", [run_id], ai_run_from_row,
    ).optional()?.ok_or_else(|| AppError::NotFound(format!("AI 运行 {run_id}")))
}

fn load_ai_messages_in_transaction(
    transaction: &Transaction<'_>,
    conversation_id: &str,
    limit: i64,
) -> AppResult<Vec<AiMessageDto>> {
    let mut statement = transaction.prepare(
        "SELECT id, conversation_id, run_id, role, content, stream_status, created_at, updated_at
         FROM (SELECT * FROM ai_messages WHERE conversation_id = ?1 ORDER BY created_at DESC LIMIT ?2)
         ORDER BY created_at ASC",
    )?;
    let rows = statement.query_map(params![conversation_id, limit], ai_message_from_row)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

fn record_optional_change(
    transaction: &Transaction<'_>,
    task_id: &str,
    kind: &str,
    old_value: Option<&str>,
    new_value: Option<&str>,
) -> AppResult<()> {
    if old_value != new_value {
        record_task_change(transaction, task_id, kind, old_value, new_value, "manual", None)?;
    }
    Ok(())
}

fn normalize_review_text(value: Option<String>, maximum_length: usize, label: &str) -> AppResult<Option<String>> {
    let value = value.map(|text| text.trim().to_owned()).filter(|text| !text.is_empty());
    if value.as_ref().is_some_and(|text| text.chars().count() > maximum_length) {
        return Err(AppError::Schema(format!("{label}不能超过 {maximum_length} 个字符")));
    }
    Ok(value)
}

fn clock_now() -> DateTime<Utc> {
    #[cfg(test)]
    {
        if let Some(timestamp) = TEST_NOW.with(|value| value.borrow().clone()) { return timestamp; }
        if let Some(date) = TEST_TODAY.with(|value| value.borrow().clone()) {
            return DateTime::parse_from_rfc3339(&format!("{date}T12:00:00+08:00")).unwrap().with_timezone(&Utc);
        }
    }
    Utc::now()
}

fn now() -> String {
    #[cfg(test)]
    {
        // Audit revisions remain unique even with a frozen policy clock.
        thread_local! { static REVISION: std::cell::Cell<i64> = const { std::cell::Cell::new(0) }; }
        return REVISION.with(|revision| {
            revision.set(revision.get() + 1);
            (clock_now() + Duration::nanoseconds(revision.get())).to_rfc3339_opts(chrono::SecondsFormat::Nanos, false)
        });
    }
    #[cfg(not(test))]
    clock_now().to_rfc3339()
}

#[cfg(test)]
thread_local! { static TEST_NOW: std::cell::RefCell<Option<DateTime<Utc>>> = const { std::cell::RefCell::new(None) }; }
#[cfg(test)]
struct TestNow(Option<DateTime<Utc>>);
#[cfg(test)]
impl TestNow {
    fn new(timestamp: &str) -> Self {
        Self(TEST_NOW.with(|value| value.replace(Some(DateTime::parse_from_rfc3339(timestamp).unwrap().with_timezone(&Utc)))))
    }
}
#[cfg(test)]
impl Drop for TestNow {
    fn drop(&mut self) { TEST_NOW.with(|value| value.replace(self.0.take())); }
}

#[cfg(test)]
thread_local! { static TEST_TODAY: std::cell::RefCell<Option<String>> = const { std::cell::RefCell::new(None) }; }

#[cfg(test)]
struct TestToday(Option<String>);
#[cfg(test)]
impl TestToday {
    fn new(date: &str) -> Self { Self(TEST_TODAY.with(|value| value.replace(Some(date.into())))) }
}
#[cfg(test)]
impl Drop for TestToday {
    fn drop(&mut self) { TEST_TODAY.with(|value| value.replace(self.0.take())); }
}

fn shanghai_today() -> String {
    clock_now()
        .with_timezone(&FixedOffset::east_opt(8 * 3600).expect("fixed Shanghai offset"))
        .format("%Y-%m-%d")
        .to_string()
}

fn operation_type(operation: &AiOperation) -> &'static str {
    match operation {
        AiOperation::ProposedTaskCreate { .. } => "proposed_task_create",
        AiOperation::ProposedTaskUpdate { .. } => "proposed_task_update",
        AiOperation::ProposedTaskComplete { .. } => "proposed_task_complete",
        AiOperation::ProposedTaskSoftDelete { .. } => "proposed_task_soft_delete",
        AiOperation::ProposedPlan { .. } => "proposed_plan",
    }
}

fn to_sql_error(error: AppError) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}

pub fn purge_expired_deleted_items(database: &mut Database) -> AppResult<usize> {
    let cutoff = (Utc::now() - Duration::days(30)).to_rfc3339();
    let ids = {
        let mut statement = database.connection.prepare(
            "SELECT id FROM tasks WHERE status = 'deleted' AND deleted_at < ?1 ORDER BY deleted_at",
        )?;
        let rows = statement.query_map([&cutoff], |row| row.get(0))?
            .collect::<Result<Vec<String>, _>>()?;
        rows
    };
    for id in &ids { database.permanently_delete_task(id, true)?; }
    let recurring_ids = {
        let mut statement = database.connection.prepare(
            "SELECT id FROM recurring_items WHERE deleted_at < ?1 ORDER BY deleted_at",
        )?;
        let rows = statement.query_map([&cutoff], |row| row.get(0))?
            .collect::<Result<Vec<String>, _>>()?;
        rows
    };
    for id in &recurring_ids { database.permanently_delete_recurring_item(id, true)?; }
    Ok(ids.len() + recurring_ids.len())
}

const MIGRATIONS: &[(i64, &str)] = &[
    (1, r#"
        CREATE TABLE tasks (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, notes TEXT, priority TEXT CHECK(priority IN ('low','medium','high')),
            earliest_start_at TEXT, due_at TEXT, estimated_minutes INTEGER, splittable INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL CHECK(status IN ('inbox','open','scheduled','done','cancelled','deleted')),
            deleted_at TEXT, deleted_from_status TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE task_changes (
            id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), change_kind TEXT NOT NULL,
            old_value TEXT, new_value TEXT, source TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL
        );
        CREATE TABLE calendar_events (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
            is_all_day INTEGER NOT NULL DEFAULT 0, blocks_scheduling INTEGER NOT NULL DEFAULT 1,
            deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE daily_plans (
            id TEXT PRIMARY KEY, plan_date TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','confirmed','reviewed')),
            source TEXT NOT NULL, created_at TEXT NOT NULL, confirmed_at TEXT
        );
        CREATE TABLE plan_blocks (
            id TEXT PRIMARY KEY, daily_plan_id TEXT NOT NULL REFERENCES daily_plans(id), task_id TEXT REFERENCES tasks(id),
            calendar_event_id TEXT REFERENCES calendar_events(id), starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
            source TEXT NOT NULL CHECK(source IN ('ai','rule_based','manual')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            CHECK(task_id IS NOT NULL OR calendar_event_id IS NOT NULL)
        );
        CREATE TABLE inbox_items (
            id TEXT PRIMARY KEY, content TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('untriaged','triaged','deleted')),
            deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE ai_runs (
            id TEXT PRIMARY KEY, operation_type TEXT NOT NULL, structured_result_json TEXT NOT NULL,
            validation_status TEXT NOT NULL CHECK(validation_status IN ('validated','committed','rejected','failed')),
            confirmation_token TEXT, confirmed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
    "#),
    (2, r#"
        CREATE INDEX idx_tasks_status ON tasks(status);
        CREATE INDEX idx_plan_blocks_range ON plan_blocks(starts_at, ends_at);
        CREATE INDEX idx_calendar_events_range ON calendar_events(starts_at, ends_at);
    "#),
    (3, r#"
        CREATE TABLE availability_settings (
            id INTEGER PRIMARY KEY CHECK(id = 1),
            weekdays_json TEXT NOT NULL,
            workday_start TEXT NOT NULL,
            workday_end TEXT NOT NULL,
            lunch_start TEXT,
            lunch_end TEXT,
            buffer_minutes INTEGER NOT NULL CHECK(buffer_minutes BETWEEN 0 AND 120),
            updated_at TEXT NOT NULL
        );
        INSERT INTO availability_settings
            (id, weekdays_json, workday_start, workday_end, lunch_start, lunch_end, buffer_minutes, updated_at)
        VALUES (1, '[1,2,3,4,5]', '09:00', '18:00', '12:00', '13:00', 10, CURRENT_TIMESTAMP);
        CREATE UNIQUE INDEX idx_daily_plans_one_confirmed_per_day
            ON daily_plans(plan_date) WHERE status = 'confirmed';
    "#),
    (4, r#"
        ALTER TABLE tasks ADD COLUMN earliest_start_date TEXT;
        ALTER TABLE tasks ADD COLUMN earliest_start_time TEXT;
        ALTER TABLE tasks ADD COLUMN due_date TEXT;
        ALTER TABLE tasks ADD COLUMN due_time TEXT;
        ALTER TABLE tasks ADD COLUMN total_workload_minutes INTEGER CHECK(total_workload_minutes IS NULL OR total_workload_minutes > 0);
        ALTER TABLE tasks ADD COLUMN remaining_workload_minutes INTEGER CHECK(remaining_workload_minutes IS NULL OR remaining_workload_minutes >= 0);
        ALTER TABLE tasks ADD COLUMN actual_minutes INTEGER NOT NULL DEFAULT 0 CHECK(actual_minutes >= 0);
        ALTER TABLE tasks ADD COLUMN source_type TEXT NOT NULL DEFAULT 'manual' CHECK(source_type IN ('manual','ai_assistant'));
        ALTER TABLE tasks ADD COLUMN migration_review_required INTEGER NOT NULL DEFAULT 0 CHECK(migration_review_required IN (0,1));

        UPDATE tasks
        SET earliest_start_date = CASE WHEN earliest_start_at IS NULL THEN NULL ELSE substr(earliest_start_at, 1, 10) END,
            earliest_start_time = CASE WHEN earliest_start_at IS NULL THEN NULL ELSE substr(earliest_start_at, 12, 5) END,
            due_date = CASE WHEN due_at IS NULL THEN NULL ELSE substr(due_at, 1, 10) END,
            due_time = CASE WHEN due_at IS NULL THEN NULL ELSE substr(due_at, 12, 5) END,
            total_workload_minutes = estimated_minutes,
            remaining_workload_minutes = estimated_minutes,
            migration_review_required = CASE WHEN estimated_minutes IS NULL THEN 0 ELSE 1 END,
            source_type = CASE
                WHEN EXISTS (
                    SELECT 1 FROM task_changes tc
                    WHERE tc.task_id = tasks.id AND tc.change_kind = 'created' AND tc.source = 'ai'
                ) THEN 'ai_assistant'
                ELSE 'manual'
            END;

        CREATE TABLE ai_conversations (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('active','archived')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            archived_at TEXT
        );
        CREATE TABLE ai_messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
            role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
            content TEXT NOT NULL,
            stream_status TEXT NOT NULL CHECK(stream_status IN ('complete','streaming','stopped','failed')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE task_drafts (
            id TEXT PRIMARY KEY,
            draft_kind TEXT NOT NULL CHECK(draft_kind IN ('create','update')),
            target_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
            source_type TEXT NOT NULL CHECK(source_type IN ('manual','ai_assistant')),
            conversation_id TEXT REFERENCES ai_conversations(id) ON DELETE SET NULL,
            title TEXT NOT NULL DEFAULT '',
            notes TEXT,
            priority TEXT CHECK(priority IN ('low','medium','high')),
            earliest_start_date TEXT,
            earliest_start_time TEXT,
            due_date TEXT,
            due_time TEXT,
            total_workload_minutes INTEGER CHECK(total_workload_minutes IS NULL OR total_workload_minutes > 0),
            remaining_workload_minutes INTEGER CHECK(remaining_workload_minutes IS NULL OR remaining_workload_minutes >= 0),
            splittable INTEGER NOT NULL DEFAULT 0 CHECK(splittable IN (0,1)),
            field_states_json TEXT NOT NULL DEFAULT '{}',
            validation_status TEXT NOT NULL CHECK(validation_status IN ('valid','needs_confirmation','invalid')),
            version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
            confirmation_token TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL CHECK(status IN ('active','confirmed','discarded')),
            confirmed_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            confirmed_at TEXT
        );
        CREATE TABLE tags (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE COLLATE NOCASE,
            created_at TEXT NOT NULL
        );
        CREATE TABLE task_tags (
            task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
            PRIMARY KEY(task_id, tag_id)
        );
        CREATE TABLE task_estimates (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            estimate_kind TEXT NOT NULL CHECK(estimate_kind IN ('total','remaining')),
            old_minutes INTEGER,
            new_minutes INTEGER,
            source TEXT NOT NULL CHECK(source IN ('manual','ai_assistant','migration','review')),
            reason TEXT,
            created_at TEXT NOT NULL
        );
        INSERT INTO task_estimates (id, task_id, estimate_kind, old_minutes, new_minutes, source, reason, created_at)
        SELECT lower(hex(randomblob(16))), id, 'total', estimated_minutes, estimated_minutes,
               'migration', '由旧 estimated_minutes 保留迁移，等待用户确认语义', updated_at
        FROM tasks WHERE estimated_minutes IS NOT NULL;
        INSERT INTO task_estimates (id, task_id, estimate_kind, old_minutes, new_minutes, source, reason, created_at)
        SELECT lower(hex(randomblob(16))), id, 'remaining', estimated_minutes, estimated_minutes,
               'migration', '由旧 estimated_minutes 保留迁移，等待用户确认语义', updated_at
        FROM tasks WHERE estimated_minutes IS NOT NULL;

        CREATE TABLE recurrence_rules (
            id TEXT PRIMARY KEY,
            frequency TEXT NOT NULL CHECK(frequency IN ('daily','weekdays','weekly','monthly')),
            interval_value INTEGER NOT NULL DEFAULT 1 CHECK(interval_value > 0),
            weekdays_json TEXT,
            month_day INTEGER CHECK(month_day IS NULL OR month_day BETWEEN 1 AND 31),
            starts_on TEXT NOT NULL,
            ends_on TEXT,
            status TEXT NOT NULL CHECK(status IN ('active','superseded','ended')),
            parent_rule_id TEXT REFERENCES recurrence_rules(id),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE recurrence_instances (
            id TEXT PRIMARY KEY,
            recurrence_rule_id TEXT NOT NULL REFERENCES recurrence_rules(id),
            task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
            occurrence_date TEXT NOT NULL,
            sequence_number INTEGER NOT NULL CHECK(sequence_number >= 0),
            UNIQUE(recurrence_rule_id, occurrence_date)
        );

        ALTER TABLE plan_blocks ADD COLUMN execution_status TEXT NOT NULL DEFAULT 'planned'
            CHECK(execution_status IN ('planned','completed','partial','not_started','cancelled','blocked'));
        ALTER TABLE plan_blocks ADD COLUMN actual_minutes INTEGER CHECK(actual_minutes IS NULL OR actual_minutes >= 0);
        ALTER TABLE plan_blocks ADD COLUMN review_required INTEGER NOT NULL DEFAULT 0 CHECK(review_required IN (0,1));
        ALTER TABLE plan_blocks ADD COLUMN out_of_plan INTEGER NOT NULL DEFAULT 0 CHECK(out_of_plan IN (0,1));
        CREATE TABLE review_entries (
            id TEXT PRIMARY KEY,
            review_date TEXT NOT NULL,
            plan_block_id TEXT REFERENCES plan_blocks(id) ON DELETE SET NULL,
            task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            outcome TEXT NOT NULL CHECK(outcome IN ('completed','partial','not_started','cancelled','blocked')),
            actual_minutes INTEGER NOT NULL CHECK(actual_minutes >= 0),
            defer_reason TEXT,
            notes TEXT,
            remaining_workload_minutes INTEGER CHECK(remaining_workload_minutes IS NULL OR remaining_workload_minutes >= 0),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        ALTER TABLE ai_runs ADD COLUMN conversation_id TEXT REFERENCES ai_conversations(id) ON DELETE SET NULL;
        ALTER TABLE ai_runs ADD COLUMN target_type TEXT;
        ALTER TABLE ai_runs ADD COLUMN target_id TEXT;
        ALTER TABLE ai_runs ADD COLUMN target_version INTEGER;
        ALTER TABLE ai_runs ADD COLUMN run_status TEXT NOT NULL DEFAULT 'completed'
            CHECK(run_status IN ('pending','streaming','completed','stopped','failed','expired'));
        ALTER TABLE ai_runs ADD COLUMN stopped_at TEXT;

        CREATE TABLE notification_states (
            id TEXT PRIMARY KEY,
            notification_type TEXT NOT NULL,
            notification_date TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('pending','sent','opened','dismissed')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(notification_type, notification_date)
        );
        CREATE TABLE calendar_holidays (
            holiday_date TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            kind TEXT NOT NULL CHECK(kind IN ('statutory_holiday','makeup_workday','lunar_festival','solar_term')),
            data_version TEXT NOT NULL
        );

        CREATE INDEX idx_task_drafts_status ON task_drafts(status, updated_at DESC);
        CREATE INDEX idx_task_drafts_conversation ON task_drafts(conversation_id);
        CREATE INDEX idx_ai_messages_conversation ON ai_messages(conversation_id, created_at);
        CREATE INDEX idx_tasks_due_date ON tasks(due_date);
        CREATE INDEX idx_recurrence_instances_rule ON recurrence_instances(recurrence_rule_id, occurrence_date);
        CREATE INDEX idx_review_entries_date ON review_entries(review_date, task_id);
    "#),
    (5, r#"
        CREATE UNIQUE INDEX idx_review_entries_plan_block
            ON review_entries(plan_block_id) WHERE plan_block_id IS NOT NULL;
    "#),
    (6, r#"
        ALTER TABLE plan_blocks ADD COLUMN execution_note TEXT;
        ALTER TABLE plan_blocks ADD COLUMN execution_captured_at TEXT;
    "#),
    (7, r#"
        UPDATE tasks SET splittable = 1 WHERE splittable <> 1;
        UPDATE task_drafts SET splittable = 1 WHERE splittable <> 1;
    "#),
    (8, r#"
        CREATE TABLE daily_plan_drafts (
            id TEXT PRIMARY KEY,
            plan_date TEXT NOT NULL,
            source TEXT NOT NULL CHECK(source IN ('rule_based','ai')),
            blocks_json TEXT NOT NULL,
            unscheduled_json TEXT NOT NULL,
            facts_json TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
            confirmation_token TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL CHECK(status IN ('active','confirmed','discarded')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            confirmed_at TEXT
        );
        CREATE UNIQUE INDEX idx_daily_plan_drafts_one_active_per_day
            ON daily_plan_drafts(plan_date) WHERE status = 'active';
        CREATE INDEX idx_daily_plan_drafts_date_status
            ON daily_plan_drafts(plan_date, status, updated_at DESC);
    "#),
    (9, r#"
        ALTER TABLE availability_settings ADD COLUMN lunch_reason TEXT NOT NULL DEFAULT '午休';
    "#),
    (10, r#"
        ALTER TABLE daily_plan_drafts ADD COLUMN base_plan_id TEXT REFERENCES daily_plans(id);
    "#),
    (11, r#"
        ALTER TABLE task_drafts ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE task_drafts ADD COLUMN recurrence_json TEXT;

        CREATE TABLE undo_entries (
            id TEXT PRIMARY KEY,
            action_kind TEXT NOT NULL,
            target_type TEXT NOT NULL,
            target_id TEXT NOT NULL,
            before_json TEXT NOT NULL,
            expected_updated_at TEXT,
            status TEXT NOT NULL CHECK(status IN ('available','applied','expired','conflicted')),
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            applied_at TEXT
        );
        CREATE INDEX idx_undo_entries_status_expiry ON undo_entries(status, expires_at DESC);
    "#),
    (12, r#"
        ALTER TABLE ai_messages ADD COLUMN run_id TEXT REFERENCES ai_runs(id) ON DELETE SET NULL;
        ALTER TABLE task_drafts ADD COLUMN ai_run_id TEXT REFERENCES ai_runs(id) ON DELETE SET NULL;
        ALTER TABLE ai_runs ADD COLUMN assistant_message TEXT;
        ALTER TABLE ai_runs ADD COLUMN error_message TEXT;
        CREATE INDEX idx_ai_messages_run ON ai_messages(run_id);
        CREATE INDEX idx_task_drafts_ai_run ON task_drafts(ai_run_id);
        CREATE INDEX idx_ai_runs_conversation_status ON ai_runs(conversation_id, run_status, updated_at DESC);
    "#),
    (13, r#"
        CREATE TABLE recurring_items (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            notes TEXT,
            frequency TEXT NOT NULL CHECK(frequency IN ('daily','weekdays','weekly','monthly')),
            interval_value INTEGER NOT NULL DEFAULT 1 CHECK(interval_value BETWEEN 1 AND 365),
            weekdays_json TEXT NOT NULL DEFAULT '[]',
            month_day INTEGER CHECK(month_day IS NULL OR month_day BETWEEN 1 AND 31),
            starts_on TEXT NOT NULL,
            ends_on TEXT,
            display_time TEXT,
            tags_json TEXT NOT NULL DEFAULT '[]',
            status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','ended')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE recurring_occurrences (
            id TEXT PRIMARY KEY,
            recurring_item_id TEXT NOT NULL REFERENCES recurring_items(id) ON DELETE CASCADE,
            occurrence_date TEXT NOT NULL,
            outcome TEXT CHECK(outcome IN ('completed','partial','not_completed')),
            review_notes TEXT,
            reviewed_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(recurring_item_id, occurrence_date)
        );
        CREATE INDEX idx_recurring_items_status ON recurring_items(status, updated_at DESC);
        CREATE INDEX idx_recurring_occurrences_date ON recurring_occurrences(occurrence_date, recurring_item_id);
    "#),
    (14, r#"
        ALTER TABLE recurring_items ADD COLUMN display_duration_minutes INTEGER;
        UPDATE recurring_items
        SET display_duration_minutes = 30
        WHERE display_time IS NOT NULL AND display_duration_minutes IS NULL;
    "#),
    (15, r#"
        ALTER TABLE recurring_items ADD COLUMN deleted_at TEXT;
        CREATE INDEX idx_recurring_items_deleted_at ON recurring_items(deleted_at, updated_at DESC);
    "#),
    (16, r#"
        CREATE TABLE daily_plan_draft_task_boundaries (
            draft_id TEXT NOT NULL REFERENCES daily_plan_drafts(id) ON DELETE CASCADE,
            task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            original_earliest_start_at TEXT,
            original_due_at TEXT,
            applied_earliest_start_at TEXT,
            applied_due_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(draft_id, task_id)
        );
        CREATE INDEX idx_daily_plan_draft_task_boundaries_task
            ON daily_plan_draft_task_boundaries(task_id, updated_at DESC);
    "#),
    (17, r#"
        UPDATE tasks
        SET deleted_from_status = 'open'
        WHERE status = 'deleted' AND deleted_from_status = 'cancelled';

        INSERT INTO task_changes (
            id, task_id, change_kind, old_value, new_value, source, reason, created_at
        )
        SELECT lower(hex(randomblob(16))), id, 'soft_deleted', 'cancelled', 'deleted',
               'migration', '合并不再进行与回收站', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        FROM tasks
        WHERE status = 'cancelled';

        UPDATE tasks
        SET status = 'deleted',
            deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            deleted_from_status = 'open',
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE status = 'cancelled';
    "#),
    (18, r#"
        INSERT INTO task_changes (
            id, task_id, change_kind, old_value, new_value, source, reason, created_at
        )
        SELECT lower(hex(randomblob(16))), id, 'status_changed', 'inbox', 'open',
               'migration', '移除 Inbox；保留原任务，补全开始与结束时间后方可排入计划',
               strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        FROM tasks
        WHERE status = 'inbox';

        UPDATE tasks
        SET status = 'open', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE status = 'inbox';

        UPDATE tasks
        SET deleted_from_status = 'open'
        WHERE deleted_from_status = 'inbox';

        UPDATE settings
        SET value = 'open', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE key = 'ui.task_queue_view' AND value = 'inbox';
    "#),
    (19, r#"
        ALTER TABLE task_drafts ADD COLUMN item_type TEXT NOT NULL DEFAULT 'task' CHECK (item_type IN ('task', 'recurring'));
        ALTER TABLE task_drafts ADD COLUMN recurring_settings_json TEXT;
        ALTER TABLE task_drafts ADD COLUMN confirmed_recurring_item_id TEXT REFERENCES recurring_items(id) ON DELETE SET NULL;
    "#),
    (20, r#"
        ALTER TABLE recurring_items ADD COLUMN source_type TEXT NOT NULL DEFAULT 'manual' CHECK(source_type IN ('manual','ai_assistant'));
        UPDATE recurring_items SET source_type = 'ai_assistant'
        WHERE id IN (
            SELECT confirmed_recurring_item_id FROM task_drafts
            WHERE source_type = 'ai_assistant' AND confirmed_recurring_item_id IS NOT NULL
        );
    "#),
    (21, r#"
        ALTER TABLE availability_settings ADD COLUMN makeup_workdays_as_workdays INTEGER NOT NULL DEFAULT 1 CHECK(makeup_workdays_as_workdays IN (0,1));
    "#),
    (22, r#"
        CREATE TABLE review_entries_nullable (
            id TEXT PRIMARY KEY,
            review_date TEXT NOT NULL,
            plan_block_id TEXT REFERENCES plan_blocks(id) ON DELETE SET NULL,
            task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            outcome TEXT NOT NULL CHECK(outcome IN ('completed','partial','not_started','cancelled','blocked')),
            actual_minutes INTEGER CHECK(actual_minutes IS NULL OR actual_minutes >= 0),
            defer_reason TEXT, notes TEXT,
            remaining_workload_minutes INTEGER CHECK(remaining_workload_minutes IS NULL OR remaining_workload_minutes >= 0),
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        INSERT INTO review_entries_nullable SELECT * FROM review_entries;
        DROP TABLE review_entries;
        ALTER TABLE review_entries_nullable RENAME TO review_entries;
        CREATE INDEX idx_review_entries_date ON review_entries(review_date, task_id);
        CREATE UNIQUE INDEX idx_review_entries_plan_block ON review_entries(plan_block_id) WHERE plan_block_id IS NOT NULL;
        CREATE TABLE review_form_drafts (
            review_date TEXT NOT NULL,
            item_type TEXT NOT NULL CHECK(item_type IN ('task','recurring')),
            item_id TEXT NOT NULL,
            payload_json TEXT,
            revision INTEGER NOT NULL CHECK(revision > 0),
            updated_at TEXT NOT NULL,
            PRIMARY KEY(review_date, item_type, item_id)
        );
    "#),
    (23, r#"
        ALTER TABLE review_entries ADD COLUMN followup_action TEXT
            CHECK(followup_action IS NULL OR followup_action IN ('schedule','wait','stop'));
    "#),
    (24, r#"
        CREATE TABLE task_draft_origins (
            draft_id TEXT PRIMARY KEY REFERENCES task_drafts(id) ON DELETE CASCADE,
            source_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
            source_title TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE INDEX idx_task_draft_origins_source ON task_draft_origins(source_task_id);
        CREATE TABLE task_origins (
            task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
            source_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
            source_title TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE INDEX idx_task_origins_source ON task_origins(source_task_id);
    "#),
    (25, r#"
        ALTER TABLE tags ADD COLUMN color INTEGER NOT NULL DEFAULT 0 CHECK(color BETWEEN 0 AND 7);
        UPDATE tags SET color = abs(random() % 8);
        INSERT OR IGNORE INTO tags (id, name, color, created_at)
        SELECT lower(hex(randomblob(16))), name, abs(random() % 8), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        FROM (
            SELECT DISTINCT trim(value) AS name FROM task_drafts, json_each(task_drafts.tags_json)
            UNION SELECT DISTINCT trim(value) FROM recurring_items, json_each(recurring_items.tags_json)
        ) WHERE name <> '';
        CREATE TABLE task_completion_snapshots (
            task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
            before_json TEXT NOT NULL,
            block_after_json TEXT
        );
    "#),
    (26, r#"
        ALTER TABLE tasks ADD COLUMN result_date TEXT;
        ALTER TABLE tasks ADD COLUMN result_ends_at TEXT;
        ALTER TABLE tasks ADD COLUMN result_block_id TEXT;
        ALTER TABLE plan_blocks ADD COLUMN result_ends_at TEXT;
        ALTER TABLE plan_blocks ADD COLUMN result_date TEXT;
        UPDATE plan_blocks SET result_ends_at = ends_at
        WHERE execution_captured_at IS NOT NULL OR execution_status <> 'planned'
            OR EXISTS(SELECT 1 FROM review_entries r WHERE r.plan_block_id = plan_blocks.id);
        UPDATE plan_blocks SET result_date = (SELECT plan_date FROM daily_plans WHERE id = plan_blocks.daily_plan_id)
        WHERE result_ends_at IS NOT NULL;
        -- A durable completion snapshot identifies the original execution, not the last edit.
        -- Completion contexts are recovered conservatively by the versioned Rust migration.
    "#),
    (27, database_recurring::MIGRATION),
    (28, database_recurring_execution::MIGRATION),
    (29, database_recurring_execution::STATUS_TIMESTAMP_MIGRATION),
    (30, database_recurring_execution::LIFECYCLE_MIGRATION),
    (31, holiday_calendar::MIGRATION),
    (32, ""), // Priority CHECK constraints are rebuilt transactionally in Rust.
    (33, database_reminder::MIGRATION),
    (34, database_reminder::REVISION_MIGRATION),
];

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn task_create(title: &str) -> String {
        json!({
            "proposal_id": Uuid::new_v4().to_string(),
            "operation": { "type": "proposed_task_create", "title": title,
                "notes": null, "priority": "high", "earliest_start_at": "2026-08-28T09:00:00+08:00",
                "due_at": "2026-08-28T09:45:00+08:00", "estimated_minutes": 45, "splittable": false }
        }).to_string()
    }

    fn manual_draft(title: &str, due_date: Option<&str>) -> TaskDraftInput {
        TaskDraftInput {
            item_type: "task".into(),
            recurring_settings: None,
            title: title.into(),
            notes: None,
            priority: Some(Priority::Medium),
            earliest_start_date: due_date.map(str::to_owned),
            earliest_start_time: due_date.map(|_| "09:00".into()),
            due_date: due_date.map(str::to_owned),
            due_time: due_date.map(|_| "10:30".into()),
            total_workload_minutes: Some(90),
            remaining_workload_minutes: None,
            field_states_json: json!({ "title": "manually_edited" }).to_string(),
            tags: Vec::new(),
            recurrence: None,
        }
    }

    fn create_direct_task(database: &mut Database, title: &str, date: &str) -> TaskDto {
        let draft = database.create_manual_task_draft(manual_draft(title, Some(date))).unwrap();
        database.confirm_task_draft(&draft.id, &draft.confirmation_token).unwrap()
    }

    fn save_direct_task_time(database: &mut Database, id: &str, start: &str, end: &str) -> AppResult<TaskDto> {
        let task = database.get_task(id)?;
        database.update_manual_task(id, ManualTaskUpdate { title: task.title, notes: task.notes,
            priority: task.priority.as_deref().map(parse_priority).transpose()?,
            earliest_start_at: Some(start.into()), due_at: Some(end.into()), estimated_minutes: task.estimated_minutes })
    }

    fn create_waiting_cross_day_task(database: &mut Database, date: &str) -> TaskDto {
        let mut input = manual_draft("直接安排跨日任务", Some(date));
        input.due_date = Some((parse_plan_date(date).unwrap() + Duration::days(2)).to_string());
        input.due_time = Some("18:00".into());
        input.total_workload_minutes = Some(240);
        let draft = database.create_manual_task_draft(input).unwrap();
        let task = database.confirm_task_draft(&draft.id, &draft.confirmation_token).unwrap();
        // Preserve a legacy waiting task to exercise manual allocation independently of creation.
        database.connection.execute("DELETE FROM plan_blocks WHERE task_id = ?1", [&task.id]).unwrap();
        database.connection.execute("DELETE FROM daily_plans WHERE NOT EXISTS(SELECT 1 FROM plan_blocks WHERE daily_plan_id = daily_plans.id)", []).unwrap();
        database.connection.execute("UPDATE tasks SET status = 'open' WHERE id = ?1", [&task.id]).unwrap();
        database.get_task(&task.id).unwrap()
    }

    fn include_input(task: &TaskDto, date: &str, start: &str, end: &str) -> PlanTaskInclude {
        PlanTaskInclude { plan_date: date.into(), task_id: task.id.clone(),
            expected_updated_at: task.updated_at.clone(), expected_reserved_minutes: task.reserved_minutes,
            blocks: vec![RulePlanBlock { task_id: task.id.clone(), task_title: task.title.clone(),
                starts_at: format!("{date}T{start}:00+08:00"), ends_at: format!("{date}T{end}:00+08:00"), estimated_minutes: 0 }] }
    }

    fn remove_input(date: &str, block: &PlanBlockDto) -> PlanBlockRemove {
        PlanBlockRemove { plan_date: date.into(), block_id: block.id.clone(),
            expected_starts_at: block.starts_at.clone(), expected_ends_at: block.ends_at.clone() }
    }

    #[test]
    fn task_read_paths_preserve_dto_metadata_and_not_found_errors() {
        let _clock = TestToday::new("2026-11-12");
        let mut database = Database::in_memory().unwrap();
        let date = shanghai_today();
        let single = create_direct_task(&mut database, "单日详情", &date);
        let cross = create_waiting_cross_day_task(&mut database, &date);
        database.include_plan_task(include_input(&cross, &date, "14:00", "15:00")).unwrap();
        for id in [&single.id, &cross.id] {
            database.set_task_tags(id, vec!["工作".into(), "项目".into()]).unwrap();
        }
        for deleted in [false, true] {
            if deleted { database.soft_delete_manual_task(&single.id, true).unwrap(); }
            let listed = database.list_tasks(true, None).unwrap();
            for id in [&single.id, &cross.id] {
                let detail = database.get_task(id).unwrap();
                let listed_task = listed.iter().find(|task| &task.id == id).unwrap();
                assert_eq!(serde_json::to_value(&detail).unwrap(), serde_json::to_value(listed_task).unwrap());
                assert_eq!(detail.tags.len(), 2);
                let metadata = database.get_task_metadata(id).unwrap();
                assert_eq!(metadata.tags, detail.tags);
                assert_eq!(metadata.completion_backfill_allowed,
                    database_results::can_backfill_completion(&database.connection, &detail).unwrap());
                let transaction = database.connection.unchecked_transaction().unwrap();
                let transactional = load_task_dto_in_transaction(&transaction, id).unwrap();
                assert_eq!(serde_json::to_value(&detail).unwrap(), serde_json::to_value(transactional).unwrap());
                transaction.rollback().unwrap();
            }
        }
        assert!(matches!(database.get_task("missing"), Err(AppError::NotFound(message)) if message == "任务 missing"));
        assert!(matches!(database.get_task_metadata("missing"), Err(AppError::NotFound(message)) if message == "任务 missing"));
    }

    #[test]
    fn direct_include_creates_plan_and_reserves_workload_without_draft() {
        let mut database = Database::in_memory().unwrap();
        let date = shanghai_today();
        let task = create_waiting_cross_day_task(&mut database, &date);
        assert!(database.get_day_schedule(&date).unwrap().plan_id.is_none());
        let saved = database.include_plan_task(include_input(&task, &date, "09:00", "10:00")).unwrap();
        assert_eq!(saved.task_blocks.len(), 1);
        let updated = database.get_task(&task.id).unwrap();
        assert_eq!(updated.status, "scheduled");
        assert_eq!(updated.reserved_minutes, 60);
        assert_eq!(updated.remaining_workload_minutes, Some(240));
        assert_eq!(updated.due_at, task.due_at);
        assert_eq!(database.count("daily_plan_drafts").unwrap(), 0);
        let undo = database.latest_undo().unwrap().unwrap();
        database.apply_undo(&undo.id).unwrap();
        assert!(database.get_day_schedule(&date).unwrap().task_blocks.is_empty());
        let restored = database.get_task(&task.id).unwrap();
        assert_eq!(restored.status, "open");
        assert_eq!(restored.reserved_minutes, 0);
    }

    #[test]
    fn direct_include_reuses_plan_and_future_blocks_and_remove_releases_only_selected_minutes() {
        let mut database = Database::in_memory().unwrap();
        let date = shanghai_today();
        let next = (parse_plan_date(&date).unwrap() + Duration::days(1)).to_string();
        let other = create_direct_task(&mut database, "保留其他任务", &date);
        let original = database.get_day_schedule(&date).unwrap();
        let other_block = serde_json::to_value(&original.task_blocks[0]).unwrap();
        let task = create_waiting_cross_day_task(&mut database, &date);
        let saved = database.include_plan_task(include_input(&task, &date, "09:00", "10:00")).unwrap();
        assert_eq!(saved.plan_id, original.plan_id);
        assert_eq!(serde_json::to_value(saved.task_blocks.iter().find(|b| b.task_id == other.id).unwrap()).unwrap(), other_block);
        let current = database.get_task(&task.id).unwrap();
        let future = database.include_plan_task(include_input(&current, &next, "14:00", "15:00")).unwrap();
        let future_id = future.task_blocks[0].id.clone();
        let selected = saved.task_blocks.iter().find(|b| b.task_id == task.id).unwrap();
        database.remove_plan_block(remove_input(&date, selected)).unwrap();
        let removed = database.get_task(&task.id).unwrap();
        assert_eq!(removed.status, "scheduled");
        assert_eq!(removed.reserved_minutes, 60);
        assert_eq!(removed.remaining_workload_minutes, Some(240));
        let undo = database.latest_undo().unwrap().unwrap();
        database.apply_undo(&undo.id).unwrap();
        assert_eq!(database.get_task(&task.id).unwrap().reserved_minutes, 120);
        assert_eq!(database.get_day_schedule(&date).unwrap().task_blocks.iter().find(|b| b.task_id == task.id).unwrap().id, selected.id);
        assert_eq!(database.get_day_schedule(&next).unwrap().task_blocks[0].id, future_id);
        database.remove_plan_block(remove_input(&date, selected)).unwrap();
        let current = database.get_task(&task.id).unwrap();
        database.include_plan_task(include_input(&current, &date, "16:00", "17:00")).unwrap();
        assert_eq!(database.get_task(&task.id).unwrap().reserved_minutes, 120);
        assert_eq!(database.count("daily_plan_drafts").unwrap(), 0);
    }

    #[test]
    fn direct_remove_single_day_and_reinclude_syncs_task_and_undo_restores_identity() {
        let mut database = Database::in_memory().unwrap();
        let date = shanghai_today();
        let task = create_direct_task(&mut database, "移回待安排", &date);
        let block = database.get_day_schedule(&date).unwrap().task_blocks[0].clone();
        database.remove_plan_block(remove_input(&date, &block)).unwrap();
        let waiting = database.get_task(&task.id).unwrap();
        assert_eq!(waiting.status, "open");
        assert_eq!(waiting.reserved_minutes, 0);
        assert_eq!(waiting.due_at, task.due_at);
        let undo_remove = database.latest_undo().unwrap().unwrap();
        database.apply_undo(&undo_remove.id).unwrap();
        assert_eq!(database.get_day_schedule(&date).unwrap().task_blocks[0].id, block.id);
        database.remove_plan_block(remove_input(&date, &block)).unwrap();
        let waiting = database.get_task(&task.id).unwrap();
        database.include_plan_task(include_input(&waiting, &date, "09:15", "10:15")).unwrap();
        let updated = database.get_task(&task.id).unwrap();
        assert_eq!(updated.earliest_start_time.as_deref(), Some("09:15"));
        assert_eq!(updated.total_workload_minutes, Some(60));
        let undo = database.latest_undo().unwrap().unwrap();
        database.apply_undo(&undo.id).unwrap();
        assert!(database.get_day_schedule(&date).unwrap().task_blocks.is_empty());
        assert_eq!(database.get_task(&task.id).unwrap().total_workload_minutes, task.total_workload_minutes);
    }

    #[test]
    fn direct_include_and_remove_reject_stale_invalid_and_batch_draft_requests_atomically() {
        let mut database = Database::in_memory().unwrap();
        let date = shanghai_today();
        let task = create_waiting_cross_day_task(&mut database, &date);
        let input = include_input(&task, &date, "09:00", "10:00");
        let mut over = include_input(&task, &date, "09:00", "14:00");
        assert!(database.include_plan_task(over.clone()).is_err());
        over.blocks[0].ends_at = format!("{date}T09:10:00+08:00");
        assert!(database.include_plan_task(over).is_err());
        let mut duplicate = input.clone(); duplicate.blocks.push(duplicate.blocks[0].clone());
        assert!(database.include_plan_task(duplicate).is_err());
        let previous = (parse_plan_date(&date).unwrap() - Duration::days(1)).to_string();
        assert!(database.include_plan_task(include_input(&task, &previous, "09:00", "10:00")).is_err());
        assert!(database.get_day_schedule(&date).unwrap().plan_id.is_none());
        let saved = database.include_plan_task(input.clone()).unwrap();
        assert!(database.include_plan_task(input).is_err());
        let mut stale_remove = remove_input(&date, &saved.task_blocks[0]); stale_remove.expected_ends_at = format!("{date}T11:00:00+08:00");
        assert!(database.remove_plan_block(stale_remove).is_err());
        let draft = database.start_manual_plan_draft(&date).unwrap();
        let current = database.get_task(&task.id).unwrap();
        assert!(database.include_plan_task(include_input(&current, &date, "11:00", "12:00")).is_err());
        assert!(database.remove_plan_block(remove_input(&date, &saved.task_blocks[0])).is_err());
        assert_eq!(database.get_rule_plan_draft(&date).unwrap().unwrap().version, draft.version);
        assert_eq!(database.get_day_schedule(&date).unwrap().task_blocks[0].id, saved.task_blocks[0].id);
        database.discard_rule_plan_draft(&draft.preview_id, draft.version).unwrap();
        database.remove_plan_block(remove_input(&date, &saved.task_blocks[0])).unwrap();
        assert!(database.remove_plan_block(remove_input(&date, &saved.task_blocks[0])).is_err());
    }

    #[test]
    fn direct_operations_preserve_execution_and_refuse_unsafe_undo() {
        let mut database = Database::in_memory().unwrap();
        let date = shanghai_today();
        let task = create_waiting_cross_day_task(&mut database, &date);
        let first = database.include_plan_task(include_input(&task, &date, "09:00", "10:00")).unwrap();
        let undo = database.latest_undo().unwrap().unwrap();
        database.save_execution_capture(&date, ExecutionCaptureInput { plan_block_id: first.task_blocks[0].id.clone(),
            outcome: Some(ReviewOutcome::Partial), note: Some("已有执行记录".into()) }).unwrap();
        assert!(database.apply_undo(&undo.id).is_err());
        assert!(database.remove_plan_block(remove_input(&date, &first.task_blocks[0])).is_err());
        let current = database.get_task(&task.id).unwrap();
        let second = database.include_plan_task(include_input(&current, &date, "11:00", "12:00")).unwrap();
        let editable = second.task_blocks.iter().find(|b| b.starts_at.contains("11:00")).unwrap();
        database.remove_plan_block(remove_input(&date, editable)).unwrap();
        let undo_remove = database.latest_undo().unwrap().unwrap();
        database.apply_undo(&undo_remove.id).unwrap();
        assert_eq!(database.get_day_schedule(&date).unwrap().task_blocks[0].execution_status, "partial");
        database.remove_plan_block(remove_input(&date, editable)).unwrap();
        let undo_remove = database.latest_undo().unwrap().unwrap();
        let current = database.get_task(&task.id).unwrap();
        database.include_plan_task(include_input(&current, &date, "14:00", "15:00")).unwrap();
        assert!(database.apply_undo(&undo_remove.id).is_err());
        let single = create_direct_task(&mut database, "锁定安排", &date);
        let block = database.get_day_schedule(&date).unwrap().task_blocks.into_iter().find(|b| b.task_id == single.id).unwrap();
        database.save_execution_capture(&date, ExecutionCaptureInput { plan_block_id: block.id.clone(), outcome: Some(ReviewOutcome::Completed), note: None }).unwrap();
        assert!(database.remove_plan_block(remove_input(&date, &block)).is_err());
        let locked = database.get_task(&single.id).unwrap();
        assert!(database.include_plan_task(include_input(&locked, &date, "09:00", "10:00")).is_err());
    }

    #[test]
    fn unfinished_yesterday_task_moves_to_today_and_undo_restores_original_block() {
        let mut database = Database::in_memory().unwrap();
        let today = shanghai_today();
        let yesterday = (parse_plan_date(&today).unwrap() - Duration::days(1)).to_string();
        let task = create_direct_task(&mut database, "昨日未执行任务", &today);
        let original_id = database.get_day_schedule(&today).unwrap().task_blocks[0].id.clone();
        // Reproduce a task saved by an older version, with its only block on yesterday.
        database.connection.execute("UPDATE daily_plans SET plan_date = ?1", [&yesterday]).unwrap();
        database.connection.execute(
            "UPDATE tasks SET earliest_start_date = ?1, due_date = ?1, earliest_start_at = ?2, due_at = ?3 WHERE id = ?4",
            params![yesterday, format!("{yesterday}T09:00:00+08:00"), format!("{yesterday}T10:30:00+08:00"), task.id],
        ).unwrap();
        database.connection.execute(
            "UPDATE plan_blocks SET starts_at = ?1, ends_at = ?2",
            params![format!("{yesterday}T09:00:00+08:00"), format!("{yesterday}T10:30:00+08:00")],
        ).unwrap();
        save_direct_task_time(&mut database, &task.id, &format!("{today}T14:00:00+08:00"), &format!("{today}T15:00:00+08:00")).unwrap();
        assert!(database.get_day_schedule(&yesterday).unwrap().task_blocks.is_empty());
        assert_eq!(database.get_day_schedule(&today).unwrap().task_blocks[0].id, original_id);
        assert_eq!(database.count("plan_blocks").unwrap(), 1);
        let undo = database.latest_undo().unwrap().unwrap();
        database.apply_undo(&undo.id).unwrap();
        assert!(database.get_day_schedule(&today).unwrap().task_blocks.is_empty());
        assert_eq!(database.get_day_schedule(&yesterday).unwrap().task_blocks[0].id, original_id);
        assert_eq!(database.get_task(&task.id).unwrap().due_date.as_deref(), Some(yesterday.as_str()));
    }

    #[test]
    fn single_day_execution_locks_manual_ai_and_preexisting_update_drafts_atomically() {
        for outcome in [ReviewOutcome::Completed, ReviewOutcome::Partial, ReviewOutcome::NotStarted, ReviewOutcome::Cancelled, ReviewOutcome::Blocked] {
            let mut database = Database::in_memory().unwrap();
            let date = shanghai_today();
            let task = create_direct_task(&mut database, "保护执行事实", &date);
            let block = database.get_day_schedule(&date).unwrap().task_blocks.remove(0);
            let proposal = json!({"proposal_id":"locked-update", "operation": {
                "type":"proposed_task_update", "task_id":task.id, "title":"禁止覆盖", "priority":"high", "estimated_minutes":30
            }}).to_string();
            let preview = database.preview_ai_proposal(&proposal).unwrap();
            let conversation = database.create_ai_conversation(None).unwrap();
            let run = database.start_ai_run(&conversation.id, "旧修改草案").unwrap();
            let (_, drafts) = database.complete_ai_run_with_drafts(&run.run.id, "待确认", vec![AiDraftCreationInput {
                draft_kind: "update".into(), target_task_id: Some(task.id.clone()), input: manual_draft("禁止跨日绕过锁定", Some(&date)),
            }], "{}").unwrap();
            let old_plan = database.start_manual_plan_draft(&date).unwrap();
            database.save_execution_capture(&date, ExecutionCaptureInput {plan_block_id:block.id.clone(), outcome:Some(outcome), note:None}).unwrap();
            let before = serde_json::to_value(database.get_task(&task.id).unwrap()).unwrap();
            assert_eq!(before["execution_locked"], true);
            assert!(database.list_tasks(false, None).unwrap().iter().find(|item| item.id == task.id).unwrap().execution_locked);
            let change_count = database.count("task_changes").unwrap();
            assert!(save_direct_task_time(&mut database, &task.id, &format!("{date}T14:00:00+08:00"), &format!("{date}T15:00:00+08:00")).is_err());
            let next = (parse_plan_date(&date).unwrap() + Duration::days(1)).to_string();
            assert!(database.update_manual_task(&task.id, ManualTaskUpdate {
                title:"禁止修改".into(), notes:Some("禁止备注".into()), priority:None,
                earliest_start_at:task.earliest_start_at.clone(), due_at:Some(format!("{next}T16:00:00+08:00")), estimated_minutes:Some(60),
            }).is_err());
            assert!(database.set_task_tags(&task.id, vec!["禁止标签".into()]).is_err());
            assert!(database.preview_ai_proposal(&proposal).is_err());
            assert!(database.apply_confirmed_ai_proposal(&preview.ai_run_id, &preview.confirmation_token, false).is_err());
            assert!(database.confirm_task_draft(&drafts[0].id, &drafts[0].confirmation_token).is_err());
            assert!(database.confirm_rule_based_plan(old_plan).is_err());
            assert_eq!(serde_json::to_value(database.get_task(&task.id).unwrap()).unwrap(), before);
            assert_eq!(database.count("task_changes").unwrap(), change_count);
            assert_eq!(database.get_day_schedule(&date).unwrap().task_blocks[0].id, block.id);
            if database.get_day_schedule(&date).unwrap().task_blocks[0].execution_status == "completed" {
                database.clear_execution_capture(&date, &block.id).unwrap();
                assert!(!database.get_task(&task.id).unwrap().execution_locked, "取消当天轻量记录后可恢复编辑");
            }
        }
    }

    #[test]
    fn reviewed_single_day_and_legacy_actual_minutes_remain_locked() {
        let mut database = Database::in_memory().unwrap();
        let date = shanghai_today();
        let task = create_direct_task(&mut database, "已复盘任务", &date);
        let block = database.get_day_schedule(&date).unwrap().task_blocks.remove(0);
        database.save_review_entry(&date, ReviewEntryInput {
            plan_block_id:block.id.clone(), outcome:ReviewOutcome::NotStarted, actual_minutes:Some(0),
            defer_reason:Some("未开始".into()), notes:None, remaining_workload_minutes:Some(90),
        }).unwrap();
        assert!(database.get_task(&task.id).unwrap().execution_locked);
        assert!(database.clear_execution_capture(&date, &block.id).is_err());
        assert!(save_direct_task_time(&mut database, &task.id, &format!("{date}T14:00:00+08:00"), &format!("{date}T15:00:00+08:00")).is_err());
        let legacy = create_direct_task(&mut database, "旧实际投入", &date);
        database.connection.execute("UPDATE tasks SET actual_minutes = 10 WHERE id = ?1", [&legacy.id]).unwrap();
        assert!(database.get_task(&legacy.id).unwrap().execution_locked);
        assert!(save_direct_task_time(&mut database, &legacy.id, &format!("{date}T14:00:00+08:00"), &format!("{date}T15:00:00+08:00")).is_err());
    }

    #[test]
    fn plan_adjustment_preserves_locked_single_day_blocks_and_allows_cross_day_pending_blocks() {
        for cross_day in [false, true] {
            let mut database = Database::in_memory().unwrap();
            let date = shanghai_today();
            let previous = (parse_plan_date(&date).unwrap() - Duration::days(1)).to_string();
            let next = (parse_plan_date(&date).unwrap() + Duration::days(1)).to_string();
            let task = create_direct_task(&mut database, "有历史执行的任务", &date);
            let other = create_direct_task(&mut database, "仍可调整的任务", &date);
            let original = database.get_day_schedule(&date).unwrap().task_blocks.into_iter().find(|block| block.task_id == task.id).unwrap();
            let history_plan = Uuid::new_v4().to_string();
            let history_id = Uuid::new_v4().to_string();
            database.connection.execute(
                "INSERT INTO daily_plans (id, plan_date, status, source, created_at, confirmed_at) VALUES (?1, ?2, 'confirmed', 'manual', ?3, ?3)",
                params![history_plan, previous, now()],
            ).unwrap();
            database.connection.execute(
                "INSERT INTO plan_blocks (id, daily_plan_id, task_id, starts_at, ends_at, source, execution_status, review_required, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'manual', 'completed', 1, ?6, ?6)",
                params![history_id, history_plan, task.id, format!("{previous}T09:00:00+08:00"), format!("{previous}T10:00:00+08:00"), now()],
            ).unwrap();
            if cross_day {
                database.connection.execute(
                    "UPDATE tasks SET earliest_start_at = ?2, earliest_start_date = ?3, due_at = ?4, due_date = ?5 WHERE id = ?1",
                    params![task.id, format!("{previous}T09:00:00+08:00"), previous, format!("{next}T18:00:00+08:00"), next],
                ).unwrap();
            }
            assert_eq!(database.get_task(&task.id).unwrap().execution_locked, !cross_day);
            let preview = database.start_confirmed_plan_adjustment(&date).unwrap();
            assert_eq!(preview.blocks.iter().any(|block| block.task_id == task.id), cross_day);
            assert!(!preview.unscheduled.iter().any(|item| item.task_id == task.id));
            let mut blocks = preview.blocks;
            for block in &mut blocks {
                block.starts_at = format!("{date}T14:00:00+08:00");
                block.ends_at = format!("{date}T15:00:00+08:00");
            }
            let edited = database.update_rule_plan_draft(&preview.preview_id, preview.version, blocks, preview.unscheduled).unwrap();
            let saved = database.confirm_rule_based_plan(edited).unwrap();
            let preserved = saved.task_blocks.iter().find(|block| block.task_id == task.id).unwrap();
            if cross_day { assert_eq!(preserved.starts_at, format!("{date}T14:00:00+08:00")); }
            else { assert_eq!(preserved.id, original.id); assert_eq!(preserved.starts_at, original.starts_at); }
            assert_eq!(saved.task_blocks.iter().find(|block| block.task_id == other.id).unwrap().starts_at, format!("{date}T14:00:00+08:00"));
            let undo = database.latest_undo().unwrap().unwrap();
            database.apply_undo(&undo.id).unwrap();
            let restored = database.get_day_schedule(&date).unwrap();
            assert_eq!(restored.task_blocks.iter().find(|block| block.task_id == task.id).unwrap().id, original.id);
            assert_eq!(database.get_day_schedule(&previous).unwrap().task_blocks[0].id, history_id);
            assert_eq!(database.get_day_schedule(&previous).unwrap().task_blocks[0].execution_status, "completed");
        }
    }

    #[test]
    fn direct_block_time_save_syncs_single_day_without_a_plan_draft_and_undo_restores_all() {
        let mut database = Database::in_memory().unwrap();
        let date = shanghai_today();
        let previous = (parse_plan_date(&date).unwrap() - Duration::days(1)).to_string();
        let task = create_direct_task(&mut database, "一次保存时间", &date);
        let other = create_direct_task(&mut database, "其他任务保持不变", &date);
        let initial = database.get_day_schedule(&date).unwrap();
        let original = initial.task_blocks.iter().find(|block| block.task_id == task.id).unwrap().clone();
        let other_original = serde_json::to_value(initial.task_blocks.iter().find(|block| block.task_id == other.id).unwrap()).unwrap();
        let history_plan = Uuid::new_v4().to_string();
        let history_id = Uuid::new_v4().to_string();
        database.connection.execute(
            "INSERT INTO daily_plans (id, plan_date, status, source, created_at, confirmed_at) VALUES (?1, ?2, 'confirmed', 'manual', ?3, ?3)",
            params![history_plan, previous, now()],
        ).unwrap();
        database.connection.execute(
            "INSERT INTO plan_blocks (id, daily_plan_id, task_id, starts_at, ends_at, source, review_required, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, 'manual', 1, ?6, ?6)",
            params![history_id, history_plan, task.id, format!("{previous}T09:00:00+08:00"), format!("{previous}T10:30:00+08:00"), now()],
        ).unwrap();
        let saved = database.update_plan_block_time(PlanBlockTimeUpdate {
            plan_date:date.clone(), block_id:original.id.clone(), expected_starts_at:original.starts_at.clone(), expected_ends_at:original.ends_at.clone(),
            starts_at:format!("{date}T14:00:00+08:00"), ends_at:format!("{date}T15:00:00+08:00"),
        }).unwrap();
        assert_eq!(saved.task_blocks.iter().find(|block| block.task_id == task.id).unwrap().id, original.id);
        assert_eq!(serde_json::to_value(saved.task_blocks.iter().find(|block| block.task_id == other.id).unwrap()).unwrap(), other_original);
        let updated = database.get_task(&task.id).unwrap();
        assert_eq!(updated.earliest_start_time.as_deref(), Some("14:00"));
        assert_eq!(updated.due_time.as_deref(), Some("15:00"));
        assert_eq!(updated.total_workload_minutes, Some(60));
        assert!(database.get_day_schedule(&previous).unwrap().task_blocks.is_empty());
        assert_eq!(database.count("daily_plan_drafts").unwrap(), 0, "独立保存不创建日计划草案");
        let undo = database.latest_undo().unwrap().unwrap();
        database.apply_undo(&undo.id).unwrap();
        let restored = database.get_day_schedule(&date).unwrap();
        assert_eq!(restored.task_blocks.iter().find(|block| block.task_id == task.id).unwrap().starts_at, original.starts_at);
        assert_eq!(database.get_task(&task.id).unwrap().due_at, task.due_at);
        assert_eq!(database.get_day_schedule(&previous).unwrap().task_blocks[0].id, history_id);
    }

    #[test]
    fn direct_block_time_save_for_cross_day_preserves_execution_and_other_days() {
        let mut database = Database::in_memory().unwrap();
        let date = shanghai_today();
        let next = (parse_plan_date(&date).unwrap() + Duration::days(1)).to_string();
        let task = create_direct_task(&mut database, "跨日直接调时", &date);
        database.connection.execute("UPDATE tasks SET due_at = ?2, due_date = ?3 WHERE id = ?1",
            params![task.id, format!("{next}T18:00:00+08:00"), next]).unwrap();
        let original = database.get_day_schedule(&date).unwrap().task_blocks.remove(0);
        let transaction = database.connection.transaction().unwrap();
        insert_confirmed_plan(&transaction, &next, &[crate::domain::ProposedPlanBlock {
            task_id:task.id.clone(), starts_at:format!("{next}T09:00:00+08:00"), ends_at:format!("{next}T10:00:00+08:00"), source:crate::domain::ProposalSource::RuleBased,
        }], "rule_based").unwrap();
        transaction.commit().unwrap();
        let future = database.get_day_schedule(&next).unwrap().task_blocks.remove(0);
        {
            let _clock = TestToday::new(&next);
            database.save_execution_capture(&next, ExecutionCaptureInput { plan_block_id:future.id.clone(), outcome:Some(ReviewOutcome::Partial), note:Some("已有执行".into()) }).unwrap();
        }
        let captured = serde_json::to_value(database.get_day_schedule(&next).unwrap().task_blocks.remove(0)).unwrap();
        let before = database.get_task(&task.id).unwrap();
        let saved = database.update_plan_block_time(PlanBlockTimeUpdate {
            plan_date:date.clone(), block_id:original.id.clone(), expected_starts_at:original.starts_at.clone(), expected_ends_at:original.ends_at.clone(),
            starts_at:format!("{date}T07:00:00+08:00"), ends_at:format!("{date}T08:00:00+08:00"),
        }).unwrap();
        assert_eq!(saved.task_blocks[0].starts_at, format!("{date}T07:00:00+08:00"));
        assert_eq!(database.get_task(&task.id).unwrap().earliest_start_time.as_deref(), Some("07:00"));
        assert_eq!(database.get_task(&task.id).unwrap().total_workload_minutes, before.total_workload_minutes);
        assert_eq!(serde_json::to_value(database.get_day_schedule(&next).unwrap().task_blocks.remove(0)).unwrap(), captured);
        let undo_id: String = database.connection.query_row("SELECT id FROM undo_entries WHERE target_type = 'task' AND target_id = ?1 ORDER BY rowid DESC LIMIT 1", [&task.id], |row| row.get(0)).unwrap();
        database.apply_undo(&undo_id).unwrap();
        assert_eq!(database.get_task(&task.id).unwrap().earliest_start_at, before.earliest_start_at);
        assert_eq!(database.get_day_schedule(&date).unwrap().task_blocks[0].starts_at, original.starts_at);
        assert_eq!(serde_json::to_value(database.get_day_schedule(&next).unwrap().task_blocks.remove(0)).unwrap(), captured);
    }

    #[test]
    fn direct_block_time_save_rejects_stale_invalid_locked_and_pending_draft_changes() {
        let mut database = Database::in_memory().unwrap();
        let date = shanghai_today();
        let task = create_direct_task(&mut database, "直接保存保护", &date);
        let original = database.get_day_schedule(&date).unwrap().task_blocks.remove(0);
        let input = PlanBlockTimeUpdate {
            plan_date:date.clone(), block_id:original.id.clone(), expected_starts_at:original.starts_at.clone(), expected_ends_at:original.ends_at.clone(),
            starts_at:format!("{date}T14:00:00+08:00"), ends_at:format!("{date}T15:00:00+08:00"),
        };
        let before = serde_json::to_value(database.get_task(&task.id).unwrap()).unwrap();
        let change_count = database.count("task_changes").unwrap();
        let mut stale = input.clone(); stale.expected_starts_at = format!("{date}T08:00:00+08:00");
        assert!(database.update_plan_block_time(stale).is_err());
        let mut short = input.clone(); short.ends_at = format!("{date}T14:14:00+08:00");
        assert!(database.update_plan_block_time(short).is_err());
        let mut outside = input.clone(); outside.ends_at = format!("{}T01:00:00+08:00", (parse_plan_date(&date).unwrap() + Duration::days(1)));
        assert!(database.update_plan_block_time(outside).is_err());
        let draft = database.start_manual_plan_draft(&date).unwrap();
        assert!(database.update_plan_block_time(input.clone()).is_err());
        assert_eq!(database.get_rule_plan_draft(&date).unwrap().unwrap().confirmation_token, draft.confirmation_token);
        assert_eq!(serde_json::to_value(database.get_task(&task.id).unwrap()).unwrap(), before);
        assert_eq!(database.count("task_changes").unwrap(), change_count);
        database.discard_rule_plan_draft(&draft.preview_id, draft.version).unwrap();
        database.update_plan_block_time(input.clone()).unwrap();
        assert!(database.update_plan_block_time(input).is_err(), "第二次请求不能覆盖已变化的时间");
        let saved = database.get_day_schedule(&date).unwrap().task_blocks.remove(0);
        database.save_execution_capture(&date, ExecutionCaptureInput {plan_block_id:saved.id.clone(), outcome:Some(ReviewOutcome::Completed), note:None}).unwrap();
        let locked = serde_json::to_value(database.get_task(&task.id).unwrap()).unwrap();
        assert!(database.update_plan_block_time(PlanBlockTimeUpdate {
            plan_date:date.clone(), block_id:saved.id.clone(), expected_starts_at:saved.starts_at, expected_ends_at:saved.ends_at,
            starts_at:format!("{date}T16:00:00+08:00"), ends_at:format!("{date}T17:00:00+08:00"),
        }).is_err());
        assert_eq!(serde_json::to_value(database.get_task(&task.id).unwrap()).unwrap(), locked);
    }

    #[test]
    fn single_day_confirmation_creates_exact_block_atomically_and_is_idempotent() {
        let mut database = Database::in_memory().unwrap();
        let date = shanghai_today();
        let mut input = manual_draft("直接安排", Some(&date));
        input.earliest_start_time = Some("07:00".into());
        input.due_time = Some("08:30".into());
        let draft = database.create_manual_task_draft(input).unwrap();
        assert!(database.get_day_schedule(&date).unwrap().task_blocks.is_empty());
        let task = database.confirm_task_draft(&draft.id, &draft.confirmation_token).unwrap();
        assert_eq!(task.status, "scheduled");
        let schedule = database.get_day_schedule(&date).unwrap();
        assert_eq!(schedule.task_blocks.len(), 1);
        assert_eq!(schedule.task_blocks[0].starts_at, format!("{date}T07:00:00+08:00"));
        assert_eq!(schedule.task_blocks[0].ends_at, format!("{date}T08:30:00+08:00"));
        assert_eq!(task.reserved_minutes, 90);
        database.confirm_task_draft(&draft.id, &draft.confirmation_token).unwrap();
        assert_eq!(database.get_day_schedule(&date).unwrap().task_blocks[0].id, schedule.task_blocks[0].id);
        create_direct_task(&mut database, "允许重叠", &date);
        assert_eq!(database.get_day_schedule(&date).unwrap().task_blocks.len(), 2);
        assert_eq!(database.count("daily_plans").unwrap(), 1);
    }

    #[test]
    fn timeline_selection_creation_supports_short_overlap_and_day_end() {
        let mut database = Database::in_memory().unwrap();
        let date = shanghai_today();
        let original = create_direct_task(&mut database, "原任务", &date);
        for (start, end) in [("09:15", "09:30"), ("23:44", "23:59")] {
            let mut input = manual_draft("框选任务", Some(&date));
            input.priority = Some(Priority::High);
            input.earliest_start_time = Some(start.into());
            input.due_time = Some(end.into());
            input.total_workload_minutes = Some(15);
            input.remaining_workload_minutes = Some(15);
            let draft = database.create_manual_task_draft(input).unwrap();
            let task = database.confirm_task_draft(&draft.id, &draft.confirmation_token).unwrap();
            assert_eq!(task.priority.as_deref(), Some("high"));
            assert_eq!(task.total_workload_minutes, Some(15));
            assert_eq!(task.reserved_minutes, 15);
            let schedule = database.get_day_schedule(&date).unwrap();
            let block = schedule.task_blocks.iter().find(|block| block.task_id == task.id).unwrap();
            assert_eq!(task.earliest_start_at.as_deref(), Some(block.starts_at.as_str()));
            assert_eq!(task.due_at.as_deref(), Some(block.ends_at.as_str()));
            assert_eq!(block.ends_at, format!("{date}T{end}:00+08:00"));
        }
        assert_eq!(database.get_day_schedule(&date).unwrap().task_blocks.len(), 3);
        assert_eq!(database.get_task(&original.id).unwrap().earliest_start_at, original.earliest_start_at);
    }

    #[test]
    fn single_day_task_edit_moves_existing_block_between_dates_and_undo_restores_both() {
        let mut database = Database::in_memory().unwrap();
        let today = shanghai_today();
        let tomorrow = (parse_plan_date(&today).unwrap() + Duration::days(1)).to_string();
        let task = create_direct_task(&mut database, "明日安排", &tomorrow);
        assert!(database.get_day_schedule(&today).unwrap().task_blocks.is_empty());
        let original = database.get_day_schedule(&tomorrow).unwrap().task_blocks.remove(0);
        let changed = save_direct_task_time(&mut database, &task.id, &format!("{today}T14:00:00+08:00"), &format!("{today}T15:00:00+08:00")).unwrap();
        assert_eq!(changed.total_workload_minutes, Some(60));
        assert_eq!(changed.reserved_minutes, 60);
        assert!(database.get_day_schedule(&tomorrow).unwrap().task_blocks.is_empty());
        let moved = database.get_day_schedule(&today).unwrap().task_blocks.remove(0);
        assert_eq!(moved.id, original.id);
        let undo = database.latest_undo().unwrap().unwrap();
        database.apply_undo(&undo.id).unwrap();
        assert!(database.get_day_schedule(&today).unwrap().task_blocks.is_empty());
        let restored = database.get_day_schedule(&tomorrow).unwrap().task_blocks.remove(0);
        assert_eq!(restored.id, original.id);
        assert_eq!(restored.starts_at, original.starts_at);
        let restored_task = database.get_task(&task.id).unwrap();
        assert_eq!(restored_task.earliest_start_at, task.earliest_start_at);
        assert_eq!(restored_task.total_workload_minutes, Some(90));
    }

    #[test]
    fn single_day_time_sync_merges_unexecuted_history_and_undo_restores_it() {
        let mut database = Database::in_memory().unwrap();
        let date = shanghai_today();
        let previous_date = (parse_plan_date(&date).unwrap() - Duration::days(1)).to_string();
        let next_date = (parse_plan_date(&date).unwrap() + Duration::days(1)).to_string();
        let task = create_direct_task(&mut database, "带历史安排的单日任务", &date);
        let historical_plan = Uuid::new_v4().to_string();
        database.connection.execute(
            "INSERT INTO daily_plans (id, plan_date, status, source, created_at, confirmed_at) VALUES (?1, ?2, 'confirmed', 'manual', ?3, ?3)",
            params![historical_plan, previous_date, now()],
        ).unwrap();
        database.connection.execute(
            "INSERT INTO plan_blocks (id, daily_plan_id, task_id, starts_at, ends_at, source, review_required, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, 'manual', 1, ?6, ?6)",
            params![Uuid::new_v4().to_string(), historical_plan, task.id,
                format!("{previous_date}T16:00:00+08:00"), format!("{previous_date}T18:00:00+08:00"), now()],
        ).unwrap();
        let history_snapshot = |database: &Database| database.connection.query_row(
            "SELECT id, starts_at, ends_at, execution_status, actual_minutes, created_at, updated_at FROM plan_blocks WHERE daily_plan_id = ?1",
            [&historical_plan], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?,
                row.get::<_, String>(3)?, row.get::<_, Option<i64>>(4)?, row.get::<_, String>(5)?, row.get::<_, String>(6)?)),
        ).unwrap();
        let historical = history_snapshot(&database);
        let preview = database.start_manual_plan_draft(&date).unwrap();
        let mut blocks = preview.blocks;
        blocks[0].starts_at = format!("{date}T16:30:00+08:00");
        blocks[0].ends_at = format!("{date}T17:15:00+08:00");
        let edited = database.update_rule_plan_draft(&preview.preview_id, preview.version, blocks, preview.unscheduled).unwrap();
        assert_eq!(database.get_task(&task.id).unwrap().due_at, task.due_at, "草案不改变正式任务");
        let saved = database.confirm_rule_based_plan(edited).unwrap();
        let changed = database.get_task(&task.id).unwrap();
        assert_eq!(changed.earliest_start_at.as_deref(), Some(saved.task_blocks[0].starts_at.as_str()));
        assert_eq!(changed.due_at.as_deref(), Some(saved.task_blocks[0].ends_at.as_str()), "历史未执行块不应阻止同步");
        assert_eq!(changed.total_workload_minutes, Some(45));
        assert!(database.get_day_schedule(&previous_date).unwrap().task_blocks.is_empty());
        let undo = database.latest_undo().unwrap().unwrap();
        database.apply_undo(&undo.id).unwrap();
        assert_eq!(database.get_task(&task.id).unwrap().due_at, task.due_at);
        assert_eq!(history_snapshot(&database), historical);

        let current_block = database.get_day_schedule(&date).unwrap().task_blocks.remove(0);
        save_direct_task_time(&mut database, &task.id, &format!("{next_date}T14:00:00+08:00"), &format!("{next_date}T14:45:00+08:00")).unwrap();
        assert!(database.get_day_schedule(&date).unwrap().task_blocks.is_empty());
        let moved = database.get_day_schedule(&next_date).unwrap().task_blocks.remove(0);
        assert_eq!(moved.id, current_block.id, "优先移动当前块并合并历史未执行块");
        assert!(database.get_day_schedule(&previous_date).unwrap().task_blocks.is_empty());
        let undo = database.latest_undo().unwrap().unwrap();
        database.apply_undo(&undo.id).unwrap();
        assert_eq!(database.get_day_schedule(&date).unwrap().task_blocks[0].id, current_block.id);
        assert_eq!(history_snapshot(&database), historical);

        save_direct_task_time(&mut database, &task.id, &format!("{date}T16:30:00+08:00"), &format!("{date}T17:15:00+08:00")).unwrap();
        let regenerated = database.regenerate_confirmed_plan_adjustment(&date).unwrap();
        assert_eq!(regenerated.blocks.len(), 1, "历史未执行块的时长不应排除当前单日任务");
        assert_eq!(regenerated.blocks[0].starts_at, format!("{date}T16:30:00+08:00"));
        database.discard_rule_plan_draft(&regenerated.preview_id, regenerated.version).unwrap();
        assert!(database.get_day_schedule(&previous_date).unwrap().task_blocks.is_empty());
        let undo = database.latest_undo().unwrap().unwrap();
        database.apply_undo(&undo.id).unwrap();
        assert_eq!(history_snapshot(&database), historical);

        let duplicate = Uuid::new_v4().to_string();
        let current_plan = database.get_day_schedule(&date).unwrap().plan_id.unwrap();
        database.connection.execute(
            "INSERT INTO plan_blocks (id, daily_plan_id, task_id, starts_at, ends_at, source, review_required, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, 'manual', 1, ?6, ?6)",
            params![duplicate, current_plan, task.id, format!("{date}T18:00:00+08:00"), format!("{date}T18:30:00+08:00"), now()],
        ).unwrap();
        assert!(!can_sync_single_day_task(&database.connection, &task.id, Some(&format!("{date}T16:30:00+08:00")), Some(&format!("{date}T17:15:00+08:00"))).unwrap(), "多个当前块仍不能套用一对一同步");
        database.connection.execute("DELETE FROM plan_blocks WHERE id = ?1", [duplicate]).unwrap();
        database.connection.execute("UPDATE plan_blocks SET execution_status = 'completed' WHERE daily_plan_id = ?1", [&historical_plan]).unwrap();
        assert!(!can_sync_single_day_task(&database.connection, &task.id, Some(&format!("{date}T16:30:00+08:00")), Some(&format!("{date}T17:15:00+08:00"))).unwrap(), "历史执行记录仍受保护");
    }

    #[test]
    fn single_day_timeline_draft_defers_task_sync_until_confirmation_and_undo_restores_times() {
        let mut database = Database::in_memory().unwrap();
        let date = shanghai_today();
        let task = create_direct_task(&mut database, "双向同步", &date);
        let original = database.get_day_schedule(&date).unwrap().task_blocks.remove(0);
        for confirm in [false, true] {
            let preview = database.start_manual_plan_draft(&date).unwrap();
            let mut blocks = preview.blocks;
            blocks[0].starts_at = format!("{date}T{}:00+08:00", if confirm { "09:15" } else { "14:00" });
            blocks[0].ends_at = format!("{date}T{}:00+08:00", if confirm { "10:00" } else { "15:00" });
            let edited = database.update_rule_plan_draft(&preview.preview_id, preview.version, blocks, preview.unscheduled).unwrap();
            assert_eq!(database.get_task(&task.id).unwrap().earliest_start_at, task.earliest_start_at);
            assert_eq!(database.get_day_schedule(&date).unwrap().task_blocks[0].starts_at, original.starts_at);
            if !confirm {
                database.discard_rule_plan_draft(&edited.preview_id, edited.version).unwrap();
                assert_eq!(database.get_task(&task.id).unwrap().total_workload_minutes, Some(90));
                continue;
            }
            let saved = database.confirm_rule_based_plan(edited).unwrap();
            assert_eq!(saved.task_blocks[0].starts_at, format!("{date}T09:15:00+08:00"));
            let changed = database.get_task(&task.id).unwrap();
            assert_eq!(changed.earliest_start_at.as_deref(), Some(saved.task_blocks[0].starts_at.as_str()));
            assert_eq!(changed.due_at.as_deref(), Some(saved.task_blocks[0].ends_at.as_str()));
            assert_eq!(changed.total_workload_minutes, Some(45));
            let undo = database.latest_undo().unwrap().unwrap();
            database.apply_undo(&undo.id).unwrap();
            assert_eq!(database.get_day_schedule(&date).unwrap().task_blocks[0].id, original.id);
            assert_eq!(database.get_task(&task.id).unwrap().due_at, task.due_at);
            assert_eq!(database.get_task(&task.id).unwrap().total_workload_minutes, Some(90));
        }
    }

    #[test]
    fn direct_task_creation_merges_into_current_draft_without_losing_cross_day_edits() {
        let mut database = Database::in_memory().unwrap();
        let date = shanghai_today();
        let next = (parse_plan_date(&date).unwrap() + Duration::days(1)).to_string();
        let mut input = manual_draft("跨日安排", Some(&next));
        input.earliest_start_date = Some(date.clone());
        let draft = database.create_manual_task_draft(input).unwrap();
        let cross_day = database.confirm_task_draft(&draft.id, &draft.confirmation_token).unwrap();
        assert_eq!(cross_day.status, "scheduled");
        assert_eq!(database.get_day_schedule(&date).unwrap().task_blocks.len(), 1);
        let preview = database.start_manual_plan_draft(&date).unwrap();
        let mut blocks = preview.blocks;
        blocks[0].starts_at = format!("{date}T13:00:00+08:00");
        blocks[0].ends_at = format!("{date}T13:45:00+08:00");
        let preview = database.update_rule_plan_draft(&preview.preview_id, preview.version, blocks, preview.unscheduled).unwrap();
        let direct = create_direct_task(&mut database, "直接安排", &date);
        let refreshed = database.get_rule_plan_draft(&date).unwrap().unwrap();
        assert!(refreshed.base_plan_id.is_some());
        assert_eq!(refreshed.blocks.len(), 2);
        assert_eq!(refreshed.blocks.iter().find(|block| block.task_id == cross_day.id).unwrap().starts_at, format!("{date}T13:00:00+08:00"));
        assert!(database.confirm_rule_based_plan(preview).is_err(), "旧版本不能覆盖新建任务");
        let saved = database.confirm_rule_based_plan(refreshed).unwrap();
        assert_eq!(saved.task_blocks.len(), 2);
        assert_eq!(saved.task_blocks.iter().filter(|block| block.task_id == direct.id).count(), 1);
    }

    #[test]
    fn single_day_task_page_save_rebases_draft_and_preserves_other_task_edits() {
        let mut database = Database::in_memory().unwrap();
        let date = shanghai_today();
        let first = create_direct_task(&mut database, "修改第一项", &date);
        let second = create_direct_task(&mut database, "保留第二项", &date);
        let preview = database.start_manual_plan_draft(&date).unwrap();
        let mut blocks = preview.blocks;
        let other = blocks.iter_mut().find(|block| block.task_id == second.id).unwrap();
        other.starts_at = format!("{date}T16:00:00+08:00");
        other.ends_at = format!("{date}T17:00:00+08:00");
        let edited = database.update_rule_plan_draft(&preview.preview_id, preview.version, blocks, preview.unscheduled).unwrap();
        save_direct_task_time(&mut database, &first.id, &format!("{date}T12:00:00+08:00"), &format!("{date}T13:00:00+08:00")).unwrap();
        let refreshed = database.get_rule_plan_draft(&date).unwrap().unwrap();
        assert_eq!(refreshed.blocks.iter().find(|block| block.task_id == first.id).unwrap().starts_at, format!("{date}T12:00:00+08:00"));
        assert_eq!(refreshed.blocks.iter().find(|block| block.task_id == second.id).unwrap().starts_at, format!("{date}T16:00:00+08:00"));
        assert!(database.confirm_rule_based_plan(edited).is_err());
        database.discard_rule_plan_draft(&refreshed.preview_id, refreshed.version).unwrap();
        assert_eq!(database.get_task(&first.id).unwrap().earliest_start_time.as_deref(), Some("12:00"));
        assert_eq!(database.get_task(&second.id).unwrap().earliest_start_time.as_deref(), Some("09:00"));
    }

    #[test]
    fn single_day_to_cross_day_conversion_removes_direct_block_and_undo_restores_it() {
        let mut database = Database::in_memory().unwrap();
        let date = shanghai_today();
        let next = (parse_plan_date(&date).unwrap() + Duration::days(1)).to_string();
        let task = create_direct_task(&mut database, "改为跨日", &date);
        let original = database.get_day_schedule(&date).unwrap().task_blocks[0].id.clone();
        let changed = save_direct_task_time(&mut database, &task.id, task.earliest_start_at.as_deref().unwrap(), &format!("{next}T18:00:00+08:00")).unwrap();
        assert_eq!(changed.status, "open");
        assert!(database.get_day_schedule(&date).unwrap().task_blocks.is_empty());
        let undo = database.latest_undo().unwrap().unwrap();
        database.apply_undo(&undo.id).unwrap();
        assert_eq!(database.get_day_schedule(&date).unwrap().task_blocks[0].id, original);
        assert_eq!(database.get_task(&task.id).unwrap().status, "scheduled");
    }

    #[test]
    fn direct_task_regeneration_keeps_explicit_times_and_captured_history_is_locked() {
        let mut database = Database::in_memory().unwrap();
        let date = shanghai_today();
        let task = create_direct_task(&mut database, "确定时间", &date);
        save_direct_task_time(&mut database, &task.id, &format!("{date}T07:00:00+08:00"), &format!("{date}T08:00:00+08:00")).unwrap();
        let preview = database.regenerate_confirmed_plan_adjustment(&date).unwrap();
        assert_eq!(preview.blocks[0].starts_at, format!("{date}T07:00:00+08:00"));
        assert_eq!(preview.blocks[0].ends_at, format!("{date}T08:00:00+08:00"));
        let schedule = database.confirm_rule_based_plan(preview).unwrap();
        let block = &schedule.task_blocks[0];
        let undo = database.latest_undo().unwrap().unwrap();
        database.save_execution_capture(&date, ExecutionCaptureInput { plan_block_id: block.id.clone(), outcome: Some(ReviewOutcome::Completed), note: None }).unwrap();
        assert!(database.apply_undo(&undo.id).is_err());
        assert!(save_direct_task_time(&mut database, &task.id, &format!("{date}T14:00:00+08:00"), &format!("{date}T15:00:00+08:00")).is_err());
        assert!(database.get_task(&task.id).unwrap().execution_locked);
        assert_eq!(database.get_task(&task.id).unwrap().earliest_start_time.as_deref(), Some("07:00"));
        let locked = database.get_day_schedule(&date).unwrap();
        assert_eq!(locked.task_blocks.len(), 1);
        assert_eq!(locked.task_blocks[0].id, block.id);
        assert_eq!(locked.task_blocks[0].starts_at, block.starts_at);
        assert_eq!(locked.task_blocks[0].execution_status, "completed");
    }

    #[test]
    fn invalid_direct_time_rolls_back_and_creation_undo_removes_task_block() {
        let mut database = Database::in_memory().unwrap();
        let date = shanghai_today();
        let task = create_direct_task(&mut database, "原子保存", &date);
        let created_undo = database.latest_undo().unwrap().unwrap();
        assert!(save_direct_task_time(&mut database, &task.id, &format!("{date}T14:00:00+08:00"), &format!("{date}T14:14:00+08:00")).is_err());
        assert_eq!(database.get_task(&task.id).unwrap().earliest_start_at, task.earliest_start_at);
        assert_eq!(database.get_day_schedule(&date).unwrap().task_blocks[0].starts_at, task.earliest_start_at.unwrap());
        database.apply_undo(&created_undo.id).unwrap();
        assert_eq!(database.get_task(&task.id).unwrap().status, "deleted");
        assert!(database.get_day_schedule(&date).unwrap().task_blocks.is_empty());
        assert_eq!(database.count("plan_blocks").unwrap(), 0);
    }

    fn recurring_draft(title: &str) -> TaskDraftInput {
        let mut input = manual_draft(title, None);
        input.item_type = "recurring".into();
        input.recurring_settings = Some(RecurringDraftSettings {
            frequency: "weekly".into(), interval_value: 1, weekdays: vec![1, 3],
            month_day: None, starts_on: "2026-09-23".into(), ends_on: None,
            display_time: Some("09:00".into()), display_duration_minutes: Some(30),
        });
        input
    }

    #[test]
    fn creation_drafts_preserve_identity_and_both_settings_across_type_switches_and_reopen() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("creation.sqlite");
        let mut database = Database::open(&path).unwrap();
        let mut input = recurring_draft("周会");
        input.item_type = "task".into();
        input.earliest_start_date = Some("2026-09-25".into());
        input.earliest_start_time = Some("10:00".into());
        let first = database.create_manual_task_draft(input.clone()).unwrap();
        let mut current = first.clone();
        for item_type in ["recurring", "task", "recurring"] {
            input.item_type = item_type.into();
            current = database.save_task_draft(&current.id, current.version, input.clone()).unwrap();
            assert_eq!(current.id, first.id);
            assert_eq!(database.list_task_drafts(false).unwrap().len(), 1);
        }
        let other = database.create_manual_task_draft(recurring_draft("另一份重复任务")).unwrap();
        assert_ne!(current.id, other.id);
        drop(database);
        let mut database = Database::open(&path).unwrap();
        let drafts = database.list_task_drafts(false).unwrap();
        assert_eq!(drafts.len(), 2);
        let restored = drafts.iter().find(|draft| draft.id == first.id).unwrap();
        assert_eq!(restored.item_type, "recurring");
        assert_eq!(restored.earliest_start_time.as_deref(), Some("10:00"));
        assert_eq!(restored.recurring_settings.as_ref().unwrap().weekdays, vec![1, 3]);
        assert!(database.confirm_creation_draft(&first.id, &first.confirmation_token).is_err());
        assert!(database.save_task_draft(&first.id, first.version, input).is_err());
        drop(database);
    }

    #[test]
    fn recurring_draft_confirmation_is_atomic_idempotent_and_creates_only_selected_type() {
        let mut database = Database::in_memory().unwrap();
        let draft = database.create_manual_task_draft(recurring_draft("周会")).unwrap();
        assert!(database.confirm_task_draft(&draft.id, &draft.confirmation_token).is_err());
        database.connection.execute_batch("CREATE TRIGGER fail_draft_confirmation BEFORE UPDATE OF status ON task_drafts WHEN NEW.status = 'confirmed' BEGIN SELECT RAISE(ABORT, 'test failure'); END;").unwrap();
        assert!(database.confirm_creation_draft(&draft.id, &draft.confirmation_token).is_err());
        assert_eq!(database.list_task_drafts(false).unwrap().len(), 1);
        assert_eq!(database.list_recurring_items(true, true).unwrap().len(), 0);
        database.connection.execute_batch("DROP TRIGGER fail_draft_confirmation;").unwrap();
        let first = database.confirm_creation_draft(&draft.id, &draft.confirmation_token).unwrap();
        let retry = database.confirm_creation_draft(&draft.id, &draft.confirmation_token).unwrap();
        match (first, retry) {
            (ConfirmedCreation::Recurring(first), ConfirmedCreation::Recurring(retry)) => assert_eq!(first.id, retry.id),
            _ => panic!("wrong creation type"),
        }
        assert!(database.list_task_drafts(false).unwrap().is_empty());
        assert_eq!(database.list_recurring_items(true, true).unwrap().len(), 1);
        assert_eq!(database.connection.query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get::<_, i64>(0)).unwrap(), 0);
        let item = &database.list_recurring_items(true, true).unwrap()[0];
        database.set_recurring_item_status(&item.id, "ended").unwrap();
        database.soft_delete_recurring_item(&item.id, true).unwrap();
        database.permanently_delete_recurring_item(&item.id, true).unwrap();
        assert!(database.list_recurring_items(true, true).unwrap().is_empty());
    }

    #[test]
    fn recurring_item_keeps_the_creation_drafts_source() {
        let mut database = Database::in_memory().unwrap();
        let draft = database.create_manual_task_draft(recurring_draft("AI 建议的周会")).unwrap();
        database.connection.execute(
            "UPDATE task_drafts SET source_type = 'ai_assistant' WHERE id = ?1",
            [&draft.id],
        ).unwrap();
        let created = database.confirm_creation_draft(&draft.id, &draft.confirmation_token).unwrap();
        let ConfirmedCreation::Recurring(item) = created else { panic!("wrong creation type") };
        assert_eq!(item.source_type, "ai_assistant");
        assert_eq!(database.list_recurring_items(true, true).unwrap()[0].source_type, "ai_assistant");

        let manual = database.create_recurring_item(recurring_item("手动周会", "2026-09-23")).unwrap();
        assert_eq!(manual.source_type, "manual");
    }

    #[test]
    fn incomplete_recurring_drafts_and_discard_use_the_shared_draft_lifecycle() {
        let mut database = Database::in_memory().unwrap();
        let mut input = recurring_draft("");
        input.recurring_settings.as_mut().unwrap().weekdays.clear();
        let first = database.create_manual_task_draft(input).unwrap();
        let second = database.create_manual_task_draft(recurring_draft("另一份")).unwrap();
        assert_eq!(first.validation_status, "needs_confirmation");
        assert!(database.confirm_creation_draft(&first.id, &first.confirmation_token).is_err());
        database.discard_task_draft(&first.id, first.version).unwrap();
        assert!(database.confirm_creation_draft(&first.id, &first.confirmation_token).is_err());
        assert_eq!(database.list_task_drafts(false).unwrap()[0].id, second.id);
    }

    #[test]
    fn ordinary_confirmation_ignores_inactive_recurring_settings() {
        let mut database = Database::in_memory().unwrap();
        let mut input = manual_draft("普通任务", Some("2026-09-25"));
        input.recurring_settings = recurring_draft("").recurring_settings;
        input.recurring_settings.as_mut().unwrap().weekdays.clear();
        let draft = database.create_manual_task_draft(input).unwrap();
        assert!(matches!(database.confirm_creation_draft(&draft.id, &draft.confirmation_token).unwrap(), ConfirmedCreation::Task(_)));
        assert!(database.list_recurring_items(true, true).unwrap().is_empty());
    }

    #[test]
    fn legacy_recurring_draft_import_is_retry_safe_even_after_confirmation() {
        let mut database = Database::in_memory().unwrap();
        let first = database.import_legacy_recurring_draft(recurring_draft("旧草稿")).unwrap();
        let retry = database.import_legacy_recurring_draft(recurring_draft("旧草稿")).unwrap();
        assert_eq!(first.id, retry.id);
        assert_eq!(database.list_task_drafts(false).unwrap().len(), 1);
        database.confirm_creation_draft(&first.id, &first.confirmation_token).unwrap();
        database.import_legacy_recurring_draft(recurring_draft("旧草稿")).unwrap();
        assert!(database.list_task_drafts(false).unwrap().is_empty());
        assert_eq!(database.list_recurring_items(true, true).unwrap().len(), 1);
    }

    fn recurring_item(title: &str, starts_on: &str) -> RecurringItemInput {
        RecurringItemInput {
            title: title.into(),
            notes: None,
            frequency: "daily".into(),
            interval_value: 1,
            weekdays: Vec::new(),
            month_day: None,
            starts_on: starts_on.into(),
            ends_on: None,
            display_time: Some("09:00".into()),
            display_duration_minutes: Some(30),
            tags: vec!["习惯".into()],
        }
    }

    #[test]
    fn migration_is_idempotent_and_tracks_all_versions() {
        let mut database = Database::in_memory().unwrap();
        database.migrate().unwrap();
        let versions: i64 = database.connection.query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| row.get(0)).unwrap();
        assert_eq!(versions, MIGRATIONS.len() as i64, "迁移版本必须可追踪且重复执行不重复写入");
        for table in [
            "task_drafts", "ai_conversations", "ai_messages", "task_estimates",
            "recurrence_rules", "recurrence_instances", "review_entries",
            "recurring_items", "recurring_occurrences",
        ] {
            let exists: bool = database.connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
                [table],
                |row| row.get(0),
            ).unwrap();
            assert!(exists, "迁移必须创建 {table}");
        }
    }

    #[test]
    fn ai_conversation_stop_rejects_late_drafts_and_keeps_user_message() {
        let mut database = Database::in_memory().unwrap();
        let conversation = database.create_ai_conversation(None).unwrap();
        let context = database.start_ai_run(&conversation.id, "整理下周周报").unwrap();
        assert_eq!(context.run.run_status, "streaming");
        assert_eq!(context.messages.len(), 1);
        assert_eq!(context.messages[0].content, "整理下周周报");
        database.stop_ai_run(&context.run.id).unwrap();
        let result = database.complete_ai_run_with_drafts(
            &context.run.id,
            "已整理",
            vec![AiDraftCreationInput { draft_kind: "create".into(), target_task_id: None, input: manual_draft("发送周报", Some("2026-09-04")) }],
            "{}",
        );
        assert!(result.is_err(), "停止后的迟到结果不得生成草稿");
        assert_eq!(database.list_task_drafts(false).unwrap().len(), 0);
        assert_eq!(database.list_ai_messages(&conversation.id, 20).unwrap().len(), 1);
    }

    #[test]
    fn ai_settings_hide_key_and_conversation_archive_is_reversible() {
        let mut database = Database::in_memory().unwrap();
        let saved = database.save_ai_connection_settings(AiConnectionSettingsInput {
            api_type: "responses".into(), endpoint: "https://api.openai.com/v1/".into(),
            model: "gpt-5-mini".into(), api_key: Some("secret-value".into()),
        }).unwrap();
        assert!(saved.api_key_configured);
        assert_eq!(saved.endpoint, "https://api.openai.com/v1");
        let serialized = serde_json::to_string(&saved).unwrap();
        assert!(!serialized.contains("secret-value"));
        let conversation = database.create_ai_conversation(Some("项目整理".into())).unwrap();
        assert_eq!(database.set_ai_conversation_archived(&conversation.id, true).unwrap().status, "archived");
        assert!(database.list_ai_conversations(false, None).unwrap().is_empty());
        assert_eq!(database.set_ai_conversation_archived(&conversation.id, false).unwrap().status, "active");
    }

    #[test]
    fn legacy_task_migration_preserves_raw_values_and_marks_ambiguous_estimate() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);",
        ).unwrap();
        for (version, sql) in MIGRATIONS.iter().take(3) {
            connection.execute_batch(sql).unwrap();
            connection.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
                params![version, now()],
            ).unwrap();
        }
        connection.execute(
            "INSERT INTO tasks (
                id, title, earliest_start_at, due_at, estimated_minutes, splittable,
                status, created_at, updated_at
             ) VALUES (
                'legacy-task', '旧任务', '2026-08-21T09:30:00+08:00',
                '2026-08-28T17:45:00+08:00', 120, 1, 'open', ?1, ?1
             )",
            [now()],
        ).unwrap();
        connection.execute(
            "INSERT INTO task_changes
                (id, task_id, change_kind, source, created_at)
             VALUES ('legacy-change', 'legacy-task', 'created', 'ai', ?1)",
            [now()],
        ).unwrap();

        let mut database = Database { connection, holiday_calendar: CalendarState::bundled() };
        database.migrate().unwrap();
        let task = database.get_task("legacy-task").unwrap();
        assert_eq!(task.earliest_start_at.as_deref(), Some("2026-08-21T09:30:00+08:00"));
        assert_eq!(task.earliest_start_date.as_deref(), Some("2026-08-21"));
        assert_eq!(task.earliest_start_time.as_deref(), Some("09:30"));
        assert_eq!(task.due_date.as_deref(), Some("2026-08-28"));
        assert_eq!(task.due_time.as_deref(), Some("17:45"));
        assert_eq!(task.total_workload_minutes, Some(120));
        assert_eq!(task.remaining_workload_minutes, Some(120));
        assert!(task.migration_review_required, "旧 estimated_minutes 的语义不能由迁移脚本猜测");
        assert_eq!(task.source_type, "ai_assistant");
        let estimates: i64 = database.connection.query_row(
            "SELECT COUNT(*) FROM task_estimates WHERE task_id = 'legacy-task'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(estimates, 2, "迁移后的总量与剩余量必须留下可审计记录");
    }

    #[test]
    fn legacy_cancelled_tasks_merge_into_recycle_bin_and_restore_as_open() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);",
        ).unwrap();
        for (version, sql) in MIGRATIONS.iter().take(3) {
            connection.execute_batch(sql).unwrap();
            connection.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
                params![version, now()],
            ).unwrap();
        }
        let timestamp = now();
        connection.execute(
            "INSERT INTO tasks (id, title, splittable, status, created_at, updated_at)
             VALUES ('legacy-cancelled', '旧不再进行任务', 1, 'cancelled', ?1, ?1)",
            [&timestamp],
        ).unwrap();
        connection.execute(
            "INSERT INTO tasks (
                id, title, splittable, status, deleted_at, deleted_from_status, created_at, updated_at
             ) VALUES (
                'legacy-deleted-cancelled', '旧回收任务', 1, 'deleted', ?1, 'cancelled', ?1, ?1
             )",
            [&timestamp],
        ).unwrap();

        let mut database = Database { connection, holiday_calendar: CalendarState::bundled() };
        database.migrate().unwrap();
        for task_id in ["legacy-cancelled", "legacy-deleted-cancelled"] {
            let task = database.get_task(task_id).unwrap();
            assert_eq!(task.status, TaskStatus::Deleted.as_str());
            assert!(task.deleted_at.is_some());
            let restore_status: String = database.connection.query_row(
                "SELECT deleted_from_status FROM tasks WHERE id = ?1",
                [task_id],
                |row| row.get(0),
            ).unwrap();
            assert_eq!(restore_status, TaskStatus::Open.as_str());
            database.restore_task(task_id).unwrap();
            assert_eq!(database.task_status(task_id).unwrap(), TaskStatus::Open.as_str());
        }
        let migrated_changes: i64 = database.connection.query_row(
            "SELECT COUNT(*) FROM task_changes
             WHERE task_id = 'legacy-cancelled' AND change_kind = 'soft_deleted'
               AND old_value = 'cancelled' AND new_value = 'deleted' AND source = 'migration'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(migrated_changes, 1);
    }

    #[test]
    fn legacy_inbox_tasks_and_saved_filter_migrate_to_open_without_inventing_time() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);",
        ).unwrap();
        for (version, sql) in MIGRATIONS.iter().take(17) {
            connection.execute_batch(sql).unwrap();
            connection.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
                params![version, now()],
            ).unwrap();
        }
        let timestamp = now();
        connection.execute(
            "INSERT INTO tasks (id, title, splittable, status, created_at, updated_at)
             VALUES ('legacy-inbox', '旧 Inbox 任务', 1, 'inbox', ?1, ?1)",
            [&timestamp],
        ).unwrap();
        connection.execute(
            "INSERT INTO tasks (
                id, title, splittable, status, deleted_at, deleted_from_status, created_at, updated_at
             ) VALUES (
                'legacy-deleted-inbox', '旧 Inbox 回收任务', 1, 'deleted', ?1, 'inbox', ?1, ?1
             )",
            [&timestamp],
        ).unwrap();
        connection.execute(
            "INSERT INTO settings (key, value, updated_at)
             VALUES ('ui.task_queue_view', 'inbox', ?1)",
            [&timestamp],
        ).unwrap();

        let mut database = Database { connection, holiday_calendar: CalendarState::bundled() };
        database.migrate().unwrap();

        let task = database.get_task("legacy-inbox").unwrap();
        assert_eq!(task.status, TaskStatus::Open.as_str());
        assert!(task.earliest_start_at.is_none());
        assert!(task.due_at.is_none(), "迁移不得为历史任务猜测时间");
        let migrated_changes: i64 = database.connection.query_row(
            "SELECT COUNT(*) FROM task_changes
             WHERE task_id = 'legacy-inbox' AND change_kind = 'status_changed'
               AND old_value = 'inbox' AND new_value = 'open' AND source = 'migration'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(migrated_changes, 1, "移除 Inbox 的状态迁移必须可审计");

        database.restore_task("legacy-deleted-inbox").unwrap();
        assert_eq!(database.task_status("legacy-deleted-inbox").unwrap(), TaskStatus::Open.as_str());
        let saved_filter: String = database.connection.query_row(
            "SELECT value FROM settings WHERE key = 'ui.task_queue_view'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(saved_filter, TaskStatus::Open.as_str());
        assert!(database.preview_rule_based_plan("2026-09-10").unwrap().blocks.is_empty(),
            "时间不完整的历史任务不得成为计划候选");
    }

    #[test]
    fn invalid_or_unknown_ai_payload_never_creates_a_task() {
        let mut database = Database::in_memory().unwrap();
        let invalid = json!({
            "proposal_id": "bad-output",
            "operation": { "type": "proposed_task_create", "title": "不应写入", "unsafe_sql": "DELETE FROM tasks" }
        }).to_string();
        assert!(database.preview_ai_proposal(&invalid).is_err());
        assert_eq!(database.count("tasks").unwrap(), 0);
        assert_eq!(database.count("daily_plans").unwrap(), 0);
    }

    #[test]
    fn legacy_ai_task_create_requires_complete_start_and_end_time() {
        let mut database = Database::in_memory().unwrap();
        for (earliest_start_at, due_at) in [
            (None, None),
            (Some("2026-08-28T09:00:00+08:00"), None),
            (None, Some("2026-08-28T09:45:00+08:00")),
        ] {
            let payload = json!({
                "proposal_id": Uuid::new_v4().to_string(),
                "operation": {
                    "type": "proposed_task_create",
                    "title": "时间不完整的旧 AI 创建",
                    "notes": null,
                    "priority": "high",
                    "earliest_start_at": earliest_start_at,
                    "due_at": due_at,
                    "estimated_minutes": 45,
                    "splittable": false
                }
            }).to_string();
            let error = database.preview_ai_proposal(&payload).unwrap_err();
            assert!(error.to_string().contains("任务开始和结束时间都必须填写"));
        }

        let stale_payload = json!({
            "proposal_id": "stale-create-without-time",
            "operation": {
                "type": "proposed_task_create",
                "title": "升级前已进入确认队列",
                "notes": null,
                "priority": "high",
                "earliest_start_at": null,
                "due_at": null,
                "estimated_minutes": 45,
                "splittable": false
            }
        }).to_string();
        database.connection.execute(
            "INSERT INTO ai_runs (
                id, operation_type, structured_result_json, validation_status,
                confirmation_token, created_at, updated_at
             ) VALUES (
                'stale-ai-run', 'proposed_task_create', ?1, 'validated',
                'stale-token', ?2, ?2
             )",
            params![stale_payload, now()],
        ).unwrap();
        let stale_error = database.apply_confirmed_ai_proposal(
            "stale-ai-run", "stale-token", false,
        ).unwrap_err();
        assert!(stale_error.to_string().contains("任务开始和结束时间都必须填写"));
        assert_eq!(database.count("tasks").unwrap(), 0);
        assert_eq!(database.count("ai_runs").unwrap(), 1,
            "当前预览不得接受不完整时间；升级前的待确认记录应保留审计但不能提交");
        let stale_status: String = database.connection.query_row(
            "SELECT validation_status FROM ai_runs WHERE id = 'stale-ai-run'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(stale_status, "validated", "确认失败不得伪造已提交状态");
    }

    #[test]
    fn ai_create_requires_preview_then_confirmation_and_commits_final_state() {
        let _clock = TestNow::new("2026-09-01T12:00:00+08:00");
        let mut database = Database::in_memory().unwrap();
        let preview = database.preview_ai_proposal(&task_create("提交周报")).unwrap();
        assert_eq!(database.count("tasks").unwrap(), 0, "预览不能改变任务最终状态");
        assert_eq!(database.count("ai_runs").unwrap(), 1);

        let result = database.apply_confirmed_ai_proposal(&preview.ai_run_id, &preview.confirmation_token, false).unwrap();
        assert_eq!(result.affected_task_ids.len(), 1);
        let task_id = &result.affected_task_ids[0];
        assert_eq!(database.task_status(task_id).unwrap(), "done");
        assert_eq!(database.get_task(task_id).unwrap().source_type, "ai_assistant");
        assert_eq!(database.count("task_changes").unwrap(), 2);
        assert_eq!(database.get_day_schedule("2026-08-28").unwrap().task_blocks[0].execution_note.as_deref(), Some("创建历史任务自动完成"));
        let audit_status: String = database.connection.query_row("SELECT validation_status FROM ai_runs WHERE id = ?1", [&preview.ai_run_id], |row| row.get(0)).unwrap();
        assert_eq!(audit_status, "committed");
    }

    #[test]
    fn conversation_proposal_persists_until_confirmation_then_disappears() {
        let _clock = TestNow::new("2026-09-01T12:00:00+08:00");
        let mut database = Database::in_memory().unwrap();
        let conversation = database.create_ai_conversation(Some("整理发布计划".into())).unwrap();
        let other_conversation = database.create_ai_conversation(Some("其他对话".into())).unwrap();
        let preview = database.preview_ai_proposal(&task_create("发布新版本")).unwrap();

        database.attach_ai_proposal_to_conversation(&preview.ai_run_id, &conversation.id).unwrap();
        assert_eq!(database.count("tasks").unwrap(), 0, "挂载到对话仍只是待确认提议");
        assert!(database.list_ai_conversation_proposals(&other_conversation.id).unwrap().is_empty());
        let pending = database.list_ai_conversation_proposals(&conversation.id).unwrap();
        assert_eq!(pending.len(), 1, "切换回原对话后必须能从 SQLite 重新读取提议");
        assert_eq!(pending[0].ai_run_id, preview.ai_run_id);
        assert_eq!(pending[0].confirmation_token, preview.confirmation_token);

        let result = database.apply_confirmed_ai_proposal(
            &pending[0].ai_run_id,
            &pending[0].confirmation_token,
            false,
        ).unwrap();
        assert!(database.list_ai_conversation_proposals(&conversation.id).unwrap().is_empty());
        assert_eq!(result.affected_task_ids.len(), 1);
        let task = database.get_task(&result.affected_task_ids[0]).unwrap();
        assert_eq!(task.title, "发布新版本");
        assert_eq!(task.status, "done");
        assert_eq!(task.source_type, "ai_assistant");
    }

    #[test]
    fn persisted_draft_is_not_a_task_and_blank_title_cannot_be_confirmed() {
        let mut database = Database::in_memory().unwrap();
        let draft = database.create_manual_task_draft(manual_draft("", None)).unwrap();
        assert_eq!(draft.status, "active");
        assert_eq!(draft.validation_status, "needs_confirmation");
        assert_eq!(database.count("task_drafts").unwrap(), 1);
        assert_eq!(database.count("tasks").unwrap(), 0, "自动保存草稿不得提前创建正式任务");

        assert!(database.confirm_task_draft(&draft.id, &draft.confirmation_token).is_err());
        assert_eq!(database.count("tasks").unwrap(), 0, "无效草稿确认失败后 SQLite 不得有副作用");
    }

    #[test]
    fn draft_confirmation_requires_complete_time_and_is_idempotent() {
        let _clock = TestNow::new("2026-09-01T12:00:00+08:00");
        let mut database = Database::in_memory().unwrap();
        let incomplete = database.create_manual_task_draft(manual_draft("整理灵感", None)).unwrap();
        assert_eq!(incomplete.validation_status, "needs_confirmation");
        assert!(database.confirm_task_draft(&incomplete.id, &incomplete.confirmation_token).is_err());
        assert_eq!(database.count("tasks").unwrap(), 0, "时间不完整的草稿不得创建正式任务");

        let dated_draft = database.create_manual_task_draft(manual_draft("周五交稿", Some("2026-08-28"))).unwrap();
        let dated_task = database.confirm_task_draft(&dated_draft.id, &dated_draft.confirmation_token).unwrap();
        let retry = database.confirm_task_draft(&dated_draft.id, &dated_draft.confirmation_token).unwrap();
        assert_eq!(retry.id, dated_task.id, "重复确认必须返回同一正式任务");
        assert_eq!(dated_task.status, "done");
        assert_eq!(dated_task.earliest_start_date.as_deref(), Some("2026-08-28"));
        assert_eq!(dated_task.earliest_start_time.as_deref(), Some("09:00"));
        assert_eq!(dated_task.due_date.as_deref(), Some("2026-08-28"));
        assert_eq!(dated_task.due_time.as_deref(), Some("10:30"));
        assert_eq!(dated_task.due_at.as_deref(), Some("2026-08-28T10:30:00+08:00"));
        assert_eq!(dated_task.source_type, "manual");
        assert_eq!(dated_task.total_workload_minutes, Some(90));
        assert_eq!(dated_task.remaining_workload_minutes, Some(0));
        assert_eq!(dated_task.actual_minutes, 0);
        assert_eq!(database.count("tasks").unwrap(), 1);
    }

    #[test]
    fn draft_save_uses_optimistic_version_and_rotates_confirmation_token() {
        let mut database = Database::in_memory().unwrap();
        let draft = database.create_manual_task_draft(manual_draft("初稿", None)).unwrap();
        let old_token = draft.confirmation_token.clone();
        let saved = database.save_task_draft(&draft.id, draft.version, manual_draft("最终标题", Some("2026-08-28"))).unwrap();
        assert_eq!(saved.version, draft.version + 1);
        assert_ne!(saved.confirmation_token, old_token);
        assert!(database.save_task_draft(&draft.id, draft.version, manual_draft("过期覆盖", None)).is_err());
        assert!(database.confirm_task_draft(&draft.id, &old_token).is_err());
        let task = database.confirm_task_draft(&saved.id, &saved.confirmation_token).unwrap();
        assert_eq!(task.title, "最终标题");
        assert_eq!(database.count("tasks").unwrap(), 1);
    }

    #[test]
    fn confirmed_plan_is_atomic_and_draft_preview_creates_no_plan_blocks() {
        let _clock = TestToday::new("2026-08-15");
        let mut database = Database::in_memory().unwrap();
        let task_id = database.create_manual_task("专注开发").unwrap();
        database.update_manual_task(&task_id, ManualTaskUpdate {
            title: "专注开发".into(), notes: None, priority: None,
            earliest_start_at: Some("2026-08-14T09:00:00+08:00".into()),
            due_at: Some("2026-08-14T10:00:00+08:00".into()), estimated_minutes: Some(60),
        }).unwrap();
        let proposal = json!({
            "proposal_id": "morning-plan-1",
            "operation": { "type": "proposed_plan", "plan_date": "2026-08-14", "blocks": [{
                "task_id": task_id.clone(), "starts_at": "2026-08-14T09:00:00+08:00",
                "ends_at": "2026-08-14T10:00:00+08:00", "source": "ai"
            }] }
        }).to_string();
        let preview = database.preview_ai_proposal(&proposal).unwrap();
        assert_eq!(database.count("daily_plans").unwrap(), 0);
        assert_eq!(database.count("plan_blocks").unwrap(), 0);

        let result = database.apply_confirmed_ai_proposal(&preview.ai_run_id, &preview.confirmation_token, false).unwrap();
        assert!(result.plan_id.is_some());
        assert_eq!(database.count("daily_plans").unwrap(), 1);
        assert_eq!(database.count("plan_blocks").unwrap(), 1);
        assert_eq!(database.task_status(&task_id).unwrap(), "scheduled");
        assert_eq!(database.get_day_schedule("2026-08-14").unwrap().task_blocks[0].task_status, "scheduled");
        let changes_before_status_round_trip = database.count("task_changes").unwrap();

        let _completion_clock = TestToday::new("2026-08-14");
        database.transition_manual_task(&task_id, TaskStatus::Done).unwrap();
        assert_eq!(database.task_status(&task_id).unwrap(), "done");
        assert_eq!(database.get_day_schedule("2026-08-14").unwrap().task_blocks[0].task_status, "done");

        assert!(database.transition_manual_task(&task_id, TaskStatus::Scheduled).is_err());
        assert_eq!(database.task_status(&task_id).unwrap(), "done");

        database.reopen_manual_task(&task_id, "2026-08-14").unwrap();
        assert_eq!(database.task_status(&task_id).unwrap(), "scheduled");
        assert_eq!(database.get_day_schedule("2026-08-14").unwrap().task_blocks[0].task_status, "scheduled");
        assert_eq!(database.count("plan_blocks").unwrap(), 1, "取消完成不得删除或重复创建原时间块");
         assert_eq!(database.count("task_changes").unwrap(), changes_before_status_round_trip + 4,
             "完成与恢复两个状态变化、取消完成前的结果快照以及取消完成的历史事件都必须保留");
    }

    #[test]
    fn reopening_an_unplanned_completed_task_restores_open_sqlite_state() {
        let mut database = Database::in_memory().unwrap();
        let task_id = database.create_manual_task("未排程任务").unwrap();
        database.transition_manual_task(&task_id, TaskStatus::Done).unwrap();

        let committed = database.reopen_manual_task(&task_id, "2026-08-14").unwrap();

        assert_eq!(committed.status, "open");
        assert_eq!(database.task_status(&task_id).unwrap(), "open");
        assert_eq!(database.count("plan_blocks").unwrap(), 0);
         assert_eq!(database.count("task_changes").unwrap(), 4);
    }

    #[test]
    fn overlapping_fixed_event_and_task_block_are_allowed_before_confirmation() {
        let mut database = Database::in_memory().unwrap();
        let task_id = database.create_manual_task("被会议阻挡").unwrap();
        database.update_manual_task(&task_id, ManualTaskUpdate {
            title: "被会议阻挡".into(), notes: None, priority: None,
            earliest_start_at: Some("2026-08-14T09:00:00+08:00".into()),
            due_at: Some("2026-08-14T10:30:00+08:00".into()), estimated_minutes: Some(60),
        }).unwrap();
        database.create_fixed_event(ManualCalendarEventInput {
            title: "会议".into(), starts_at: "2026-08-14T09:00:00+08:00".into(),
            ends_at: "2026-08-14T10:00:00+08:00".into(), is_all_day: false, blocks_scheduling: true,
        }).unwrap();
        let proposal = json!({ "proposal_id": "conflict", "operation": { "type": "proposed_plan", "plan_date": "2026-08-14", "blocks": [{
            "task_id": task_id, "starts_at": "2026-08-14T09:30:00+08:00", "ends_at": "2026-08-14T10:30:00+08:00", "source": "ai"
        }] } }).to_string();
        let preview = database.preview_ai_proposal(&proposal).unwrap();
        assert_eq!(database.count("daily_plans").unwrap(), 0);
        assert_eq!(database.count("plan_blocks").unwrap(), 0);
        let saved = database.apply_confirmed_ai_proposal(&preview.ai_run_id, &preview.confirmation_token, false).unwrap();
        assert!(saved.plan_id.is_some());
        assert_eq!(database.get_day_schedule("2026-08-14").unwrap().fixed_events.len(), 1);
        assert_eq!(database.count("plan_blocks").unwrap(), 1);
    }

    #[test]
    fn ai_soft_delete_requires_second_confirmation_and_preserves_audit_trail() {
        let mut database = Database::in_memory().unwrap();
        let task_id = database.create_manual_task("待删除任务").unwrap();
        let proposal = json!({ "proposal_id": "delete-one", "operation": {
            "type": "proposed_task_soft_delete", "task_ids": [task_id.clone()], "precise_target_count": 1
        }}).to_string();
        let preview = database.preview_ai_proposal(&proposal).unwrap();
        assert!(database.apply_confirmed_ai_proposal(&preview.ai_run_id, &preview.confirmation_token, false).is_err());
        assert_eq!(database.task_status(&task_id).unwrap(), "open");
        database.apply_confirmed_ai_proposal(&preview.ai_run_id, &preview.confirmation_token, true).unwrap();
        assert_eq!(database.task_status(&task_id).unwrap(), "deleted");
        let deleted_at: Option<String> = database.connection.query_row("SELECT deleted_at FROM tasks WHERE id = ?1", [&task_id], |row| row.get(0)).unwrap();
        assert!(deleted_at.is_some());
        assert_eq!(database.count("task_changes").unwrap(), 2);
    }

    #[test]
    fn task_state_machine_refuses_completion_after_soft_delete() {
        let mut database = Database::in_memory().unwrap();
        let task_id = database.create_manual_task("已删除任务").unwrap();
        let delete = json!({ "proposal_id": "delete", "operation": { "type": "proposed_task_soft_delete", "task_ids": [task_id.clone()], "precise_target_count": 1 } }).to_string();
        let deletion = database.preview_ai_proposal(&delete).unwrap();
        database.apply_confirmed_ai_proposal(&deletion.ai_run_id, &deletion.confirmation_token, true).unwrap();
        let complete = json!({ "proposal_id": "complete", "operation": { "type": "proposed_task_complete", "task_id": task_id.clone() } }).to_string();
        assert!(database.preview_ai_proposal(&complete).is_err());
        assert_eq!(database.task_status(&task_id).unwrap(), "deleted");
    }

    #[test]
    fn recycle_bin_restore_and_permanent_delete_obey_their_boundaries() {
        let mut database = Database::in_memory().unwrap();
        let task_id = database.create_manual_task("回收站边界").unwrap();
        assert!(database.permanently_delete_task(&task_id, true).is_err(), "正常任务不可被永久删除");
        let delete = json!({ "proposal_id": "delete", "operation": { "type": "proposed_task_soft_delete", "task_ids": [task_id.clone()], "precise_target_count": 1 } }).to_string();
        let preview = database.preview_ai_proposal(&delete).unwrap();
        database.apply_confirmed_ai_proposal(&preview.ai_run_id, &preview.confirmation_token, true).unwrap();
        database.restore_task(&task_id).unwrap();
        assert_eq!(database.task_status(&task_id).unwrap(), "open");
        let second_preview = database.preview_ai_proposal(&delete).unwrap();
        database.apply_confirmed_ai_proposal(&second_preview.ai_run_id, &second_preview.confirmation_token, true).unwrap();
        database.permanently_delete_task(&task_id, true).unwrap();
        assert_eq!(database.count("tasks").unwrap(), 0);
    }

    #[test]
    fn manual_task_survives_database_reopen() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("persistence.sqlite3");
        let task_id = {
            let mut database = Database::open(&path).unwrap();
            database.create_manual_task("重启后仍存在").unwrap()
        };
        let database = Database::open(&path).unwrap();
        let task = database.get_task(&task_id).unwrap();
        assert_eq!(task.title, "重启后仍存在");
        assert_eq!(task.status, "open");
        assert_eq!(database.list_tasks(false, None).unwrap().len(), 1);
    }

    #[test]
    fn ui_setting_round_trips_and_updates_sqlite_final_state() {
        let mut database = Database::in_memory().unwrap();
        database.set_ui_setting("ui.task_ledger_list_width", "320").unwrap();
        database.set_ui_setting("ui.task_ledger_list_width", "364").unwrap();
        assert_eq!(
            database.get_ui_setting("ui.task_ledger_list_width").unwrap().as_deref(),
            Some("364")
        );
        let persisted: String = database.connection.query_row(
            "SELECT value FROM settings WHERE key = 'ui.task_ledger_list_width'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(persisted, "364");
        assert!(database.set_ui_setting("ai.api_key", "secret").is_err());
    }

    #[test]
    fn manual_update_commits_fields_and_immutable_change_history() {
        let mut database = Database::in_memory().unwrap();
        let task_id = database.create_manual_task("初始标题").unwrap();
        let updated = database.update_manual_task(&task_id, ManualTaskUpdate {
            title: "整理发布说明".into(),
            notes: Some("覆盖本周已完成事项".into()),
            priority: Some(Priority::High),
            earliest_start_at: Some("2026-08-14T09:00:00+08:00".into()),
            due_at: Some("2026-08-14T18:00:00+08:00".into()),
            estimated_minutes: Some(45),
        }).unwrap();
        assert_eq!(updated.title, "整理发布说明");
        assert_eq!(updated.priority.as_deref(), Some("high"));
        assert_eq!(updated.estimated_minutes, Some(45));
        assert!(updated.splittable);
        let changes: i64 = database.connection.query_row(
            "SELECT COUNT(*) FROM task_changes WHERE task_id = ?1", [&task_id], |row| row.get(0),
        ).unwrap();
        assert_eq!(changes, 7, "创建记录加六项字段变化必须全部留痕");
    }

    #[test]
    fn completed_tasks_reject_content_edits_until_explicitly_reopened() {
        let mut database = Database::in_memory().unwrap();
        let task_id = database.create_manual_task("保留原任务记录").unwrap();
        database.set_task_tags(&task_id, vec!["历史标签".into()]).unwrap();
        database.transition_manual_task(&task_id, TaskStatus::Done).unwrap();
        let before = serde_json::to_value(database.get_task(&task_id).unwrap()).unwrap();
        let change_count = database.count("task_changes").unwrap();
        let update = || ManualTaskUpdate {
            title: "取消完成后的修改".into(), notes: Some("新的备注".into()),
            priority: Some(Priority::High), earliest_start_at: Some("2026-09-09T09:00:00+08:00".into()),
            due_at: Some("2026-09-09T09:45:00+08:00".into()), estimated_minutes: Some(45),
        };
        assert!(database.update_manual_task(&task_id, update()).unwrap_err().to_string().contains("请先取消完成"));
        assert!(database.set_task_tags(&task_id, vec!["替换标签".into()]).unwrap_err().to_string().contains("请先取消完成"));
        assert!(database.update_recurring_task(&task_id, manual_draft("不应修改", None), "this")
            .unwrap_err().to_string().contains("请先取消完成"));
        assert_eq!(serde_json::to_value(database.get_task(&task_id).unwrap()).unwrap(), before);
        assert_eq!(database.count("task_changes").unwrap(), change_count, "拒绝修改不能留下部分变更");

        database.soft_delete_manual_task(&task_id, true).unwrap();
        assert!(database.update_manual_task(&task_id, update()).is_err());
        database.restore_task(&task_id).unwrap();
        assert_eq!(database.task_status(&task_id).unwrap(), TaskStatus::Done.as_str(), "恢复已完成任务不等于取消完成");
        assert!(database.update_manual_task(&task_id, update()).is_err());
        database.reopen_manual_task(&task_id, "2026-09-09").unwrap();
        assert_eq!(database.update_manual_task(&task_id, update()).unwrap().title, "取消完成后的修改");
    }

    #[test]
    fn recycle_bin_tasks_are_read_only_until_restored() {
        let mut database = Database::in_memory().unwrap();
        let task_id = database.create_manual_task("暂时不做").unwrap();
        database.soft_delete_manual_task(&task_id, true).unwrap();
        let update = ManualTaskUpdate {
            title: "恢复后的修改".into(), notes: None, priority: None,
            earliest_start_at: Some("2026-09-09T09:00:00+08:00".into()),
            due_at: Some("2026-09-09T09:30:00+08:00".into()), estimated_minutes: Some(30),
        };
        assert!(database.update_manual_task(&task_id, update.clone()).unwrap_err().to_string().contains("必须先恢复"));
        assert!(database.set_task_tags(&task_id, vec!["替换标签".into()]).unwrap_err().to_string().contains("必须先恢复"));
        database.restore_task(&task_id).unwrap();
        assert_eq!(database.task_status(&task_id).unwrap(), TaskStatus::Open.as_str());
        assert_eq!(database.update_manual_task(&task_id, update).unwrap().title, "恢复后的修改");
    }

    #[test]
    fn ai_task_updates_recheck_terminal_state_at_confirmation() {
        for recycle in [false, true] {
            let mut database = Database::in_memory().unwrap();
            let task_id = database.create_manual_task("确认前结束的任务").unwrap();
            let proposal = json!({ "proposal_id": "stale-task-update", "operation": {
                "type": "proposed_task_update", "task_id": task_id,
                "title": "不能覆盖的标题", "priority": "high", "estimated_minutes": 45
            }}).to_string();
            let preview = database.preview_ai_proposal(&proposal).unwrap();
            if recycle {
                database.soft_delete_manual_task(&task_id, true).unwrap();
            } else {
                database.transition_manual_task(&task_id, TaskStatus::Done).unwrap();
            }
            let before = serde_json::to_value(database.get_task(&task_id).unwrap()).unwrap();
            let change_count = database.count("task_changes").unwrap();
            assert!(database.preview_ai_proposal(&proposal).is_err());
            assert!(database.apply_confirmed_ai_proposal(&preview.ai_run_id, &preview.confirmation_token, false).is_err());
            assert_eq!(serde_json::to_value(database.get_task(&task_id).unwrap()).unwrap(), before);
            assert_eq!(database.count("task_changes").unwrap(), change_count);
        }
    }

    #[test]
    fn ai_update_draft_cannot_modify_a_task_that_became_terminal() {
        for recycle in [false, true] {
            let mut database = Database::in_memory().unwrap();
            let task_id = database.create_manual_task("保留正式任务").unwrap();
            let conversation = database.create_ai_conversation(None).unwrap();
            let run = database.start_ai_run(&conversation.id, "修改任务").unwrap();
            let (_, drafts) = database.complete_ai_run_with_drafts(
                &run.run.id, "已整理为修改草稿。", vec![AiDraftCreationInput {
                    draft_kind: "update".into(), target_task_id: Some(task_id.clone()),
                    input: manual_draft("草稿中的修改", Some("2026-09-10")),
                }], "{}",
            ).unwrap();
            if recycle {
                database.soft_delete_manual_task(&task_id, true).unwrap();
            } else {
                database.transition_manual_task(&task_id, TaskStatus::Done).unwrap();
            }
            let before = serde_json::to_value(database.get_task(&task_id).unwrap()).unwrap();
            let change_count = database.count("task_changes").unwrap();
            assert!(database.confirm_task_draft(&drafts[0].id, &drafts[0].confirmation_token).is_err());
            assert_eq!(serde_json::to_value(database.get_task(&task_id).unwrap()).unwrap(), before);
            assert_eq!(database.count("task_changes").unwrap(), change_count);
            let draft_status: String = database.connection.query_row(
                "SELECT status FROM task_drafts WHERE id = ?1", [&drafts[0].id], |row| row.get(0),
            ).unwrap();
            assert_eq!(draft_status, "active", "确认失败应保留草稿供用户后续处理");
        }
    }

    #[test]
    fn list_hides_recycle_bin_and_searches_persisted_content() {
        let mut database = Database::in_memory().unwrap();
        let visible_id = database.create_manual_task("准备季度复盘").unwrap();
        let deleted_id = database.create_manual_task("废弃草稿").unwrap();
        database.soft_delete_manual_task(&deleted_id, true).unwrap();
        let visible = database.list_tasks(false, Some("季度")).unwrap();
        assert_eq!(visible.len(), 1);
        assert_eq!(visible[0].id, visible_id);
        assert!(database.list_tasks(false, None).unwrap().iter().all(|task| task.status != "deleted"));
        assert_eq!(database.list_tasks(true, None).unwrap().iter().filter(|task| task.status == "deleted").count(), 1);
    }

    #[test]
    fn manual_state_changes_and_confirmation_guards_use_database_state() {
        let mut database = Database::in_memory().unwrap();
        let task_id = database.create_manual_task("状态流转").unwrap();
        database.transition_manual_task(&task_id, TaskStatus::Done).unwrap();
        assert_eq!(database.task_status(&task_id).unwrap(), "done");
        database.transition_manual_task(&task_id, TaskStatus::Open).unwrap();
        assert_eq!(database.task_status(&task_id).unwrap(), "open");
        assert!(database.soft_delete_manual_task(&task_id, false).is_err());
        assert_eq!(database.task_status(&task_id).unwrap(), "open");
        database.soft_delete_manual_task(&task_id, true).unwrap();
        assert!(database.permanently_delete_task(&task_id, false).is_err());
        assert_eq!(database.task_status(&task_id).unwrap(), "deleted");
    }

    #[test]
    fn invalid_manual_time_constraints_leave_sqlite_unchanged() {
        let mut database = Database::in_memory().unwrap();
        let task_id = database.create_manual_task("时间约束保护").unwrap();
        let result = database.update_manual_task(&task_id, ManualTaskUpdate {
            title: "不应写入的新标题".into(), notes: None, priority: None,
            earliest_start_at: Some("2026-08-14T18:00:00+08:00".into()),
            due_at: Some("2026-08-14T09:00:00+08:00".into()),
            estimated_minutes: None,
        });
        assert!(result.is_err());
        assert_eq!(database.get_task(&task_id).unwrap().title, "时间约束保护");
        assert_eq!(database.count("task_changes").unwrap(), 1);
    }

    #[test]
    fn soft_deleted_task_blocks_do_not_participate_in_future_scheduling() {
        let mut database = Database::in_memory().unwrap();
        let first_id = database.create_manual_task("原任务").unwrap();
        database.update_manual_task(&first_id, ManualTaskUpdate {
            title: "原任务".into(), notes: None, priority: None,
            earliest_start_at: Some("2026-08-14T13:00:00+08:00".into()),
            due_at: Some("2026-08-14T14:00:00+08:00".into()), estimated_minutes: Some(60),
        }).unwrap();
        let first_plan = json!({ "proposal_id": "first-plan", "operation": { "type": "proposed_plan", "plan_date": "2026-08-14", "blocks": [{
            "task_id": first_id.clone(), "starts_at": "2026-08-14T13:00:00+08:00", "ends_at": "2026-08-14T14:00:00+08:00", "source": "ai"
        }] } }).to_string();
        let preview = database.preview_ai_proposal(&first_plan).unwrap();
        database.apply_confirmed_ai_proposal(&preview.ai_run_id, &preview.confirmation_token, false).unwrap();
        database.soft_delete_manual_task(&first_id, true).unwrap();

        let replacement_id = database.create_manual_task("替代任务").unwrap();
        database.update_manual_task(&replacement_id, ManualTaskUpdate {
            title: "替代任务".into(), notes: None, priority: None,
            earliest_start_at: Some("2026-08-14T13:00:00+08:00".into()),
            due_at: Some("2026-08-14T14:00:00+08:00".into()), estimated_minutes: Some(60),
        }).unwrap();
        let replacement_plan = json!({ "proposal_id": "replacement-plan", "operation": { "type": "proposed_plan", "plan_date": "2026-08-14", "blocks": [{
            "task_id": replacement_id, "starts_at": "2026-08-14T13:00:00+08:00", "ends_at": "2026-08-14T14:00:00+08:00", "source": "ai"
        }] } }).to_string();
        assert!(database.preview_ai_proposal(&replacement_plan).is_ok());
    }

    #[test]
    fn makeup_workday_preference_migrates_without_changing_weekly_settings() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);").unwrap();
        for (version, sql) in MIGRATIONS.iter().take(20) {
            connection.execute_batch(sql).unwrap();
            connection.execute("INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)", params![version, now()]).unwrap();
        }
        connection.execute("UPDATE availability_settings SET weekdays_json = '[2,4,6]', workday_start = '08:30' WHERE id = 1", []).unwrap();
        let mut database = Database { connection, holiday_calendar: CalendarState::bundled() };
        database.migrate().unwrap();
        let settings = database.get_availability_settings().unwrap();
        assert!(settings.makeup_workdays_as_workdays);
        assert_eq!(settings.weekdays, vec![2, 4, 6]);
        assert_eq!(settings.workday_start, "08:30");
        database.save_availability_settings(AvailabilitySettings { makeup_workdays_as_workdays: false, ..settings }).unwrap();
        database.migrate().unwrap();
        assert!(!database.get_availability_settings().unwrap().makeup_workdays_as_workdays);
    }

    #[test]
    fn makeup_workday_preference_survives_reopen_and_accepts_legacy_requests() {
        let path = std::env::temp_dir().join(format!("dayweave-availability-{}.sqlite", Uuid::new_v4()));
        {
            let mut database = Database::open(&path).unwrap();
            let mut settings = database.get_availability_settings().unwrap();
            settings.makeup_workdays_as_workdays = false;
            let saved = database.save_availability_settings(settings).unwrap();
            assert!(!saved.makeup_workdays_as_workdays);
            assert_eq!(serde_json::to_value(&saved).unwrap()["makeup_workdays_as_workdays"], false);
        }
        {
            let mut database = Database::open(&path).unwrap();
            assert!(!database.get_availability_settings().unwrap().makeup_workdays_as_workdays);
            let legacy: AvailabilitySettings = serde_json::from_value(json!({
                "weekdays": [1, 2, 3, 4, 5], "workday_start": "09:00", "workday_end": "18:00"
            })).unwrap();
            assert!(database.save_availability_settings(legacy).unwrap().makeup_workdays_as_workdays);
        }
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn fixed_event_crud_and_availability_settings_persist_final_sqlite_state() {
        let mut database = Database::in_memory().unwrap();
        let created = database.create_fixed_event(ManualCalendarEventInput {
            title: "产品例会".into(), starts_at: "2026-08-14T10:00:00+08:00".into(),
            ends_at: "2026-08-14T11:00:00+08:00".into(), is_all_day: false, blocks_scheduling: true,
        }).unwrap();
        let updated = database.update_fixed_event(&created.id, ManualCalendarEventInput {
            title: "产品周会".into(), starts_at: "2026-08-14T10:30:00+08:00".into(),
            ends_at: "2026-08-14T11:30:00+08:00".into(), is_all_day: false, blocks_scheduling: false,
        }).unwrap();
        assert_eq!(updated.title, "产品周会");
        assert!(!updated.blocks_scheduling);
        assert_eq!(database.list_calendar_events(
            "2026-08-14T00:00:00+08:00", "2026-08-15T00:00:00+08:00"
        ).unwrap().len(), 1);

        let legacy_before: (Option<String>, Option<String>, String, i64) = database.connection.query_row(
            "SELECT lunch_start, lunch_end, lunch_reason, buffer_minutes FROM availability_settings WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        ).unwrap();
        let saved = database.save_availability_settings(AvailabilitySettings {
            makeup_workdays_as_workdays: true,
            weekdays: vec![1, 2, 3, 4, 5, 6], workday_start: "08:30".into(), workday_end: "19:00".into(),
            lunch_start: Some("12:00".into()), lunch_end: Some("13:30".into()), lunch_reason: "  用餐休息  ".into(), buffer_minutes: 15,
        }).unwrap();
        assert_eq!(saved.weekdays, vec![1, 2, 3, 4, 5, 6]);
        assert_eq!(saved.workday_start, "08:30");
        assert_eq!(saved.workday_end, "19:00");
        assert_eq!(database.get_availability_settings().unwrap(), saved);
        let legacy_after: (Option<String>, Option<String>, String, i64) = database.connection.query_row(
            "SELECT lunch_start, lunch_end, lunch_reason, buffer_minutes FROM availability_settings WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        ).unwrap();
        assert_eq!(legacy_after, legacy_before, "已废弃的午休和缓冲字段不能被新设置覆盖");

        database.soft_delete_fixed_event(&created.id, true).unwrap();
        assert!(database.list_calendar_events(
            "2026-08-14T00:00:00+08:00", "2026-08-15T00:00:00+08:00"
        ).unwrap().is_empty());
        let deleted_at: Option<String> = database.connection.query_row(
            "SELECT deleted_at FROM calendar_events WHERE id = ?1", [&created.id], |row| row.get(0)
        ).unwrap();
        assert!(deleted_at.is_some(), "固定日程必须软删除而不是直接消失");
    }

    #[test]
    fn all_day_fixed_event_normalizes_to_full_day_without_blocking_rule_plan() {
        let mut database = Database::in_memory().unwrap();
        let created = database.create_fixed_event(ManualCalendarEventInput {
            title: "全天外出".into(), starts_at: "2026-08-14T09:00:00+08:00".into(),
            ends_at: "2026-08-14T10:00:00+08:00".into(), is_all_day: true, blocks_scheduling: true,
        }).unwrap();
        assert_eq!(created.starts_at, "2026-08-14T00:00:00+08:00");
        assert_eq!(created.ends_at, "2026-08-15T00:00:00+08:00");

        let task_id = database.create_manual_task("当天无法排入").unwrap();
        database.update_manual_task(&task_id, ManualTaskUpdate {
            title: "当天无法排入".into(), notes: None, priority: Some(Priority::High),
            earliest_start_at: Some("2026-08-14T09:00:00+08:00".into()),
            due_at: Some("2026-08-14T10:00:00+08:00".into()), estimated_minutes: Some(60),
        }).unwrap();
        let preview = database.preview_rule_based_plan("2026-08-14").unwrap();
        assert_eq!(preview.blocks.len(), 1);
        assert!(preview.unscheduled.is_empty());
        assert_eq!(preview.blocks[0].task_id, task_id);
        assert_eq!(preview.blocks[0].starts_at, "2026-08-14T09:00:00+08:00");
        assert_eq!(database.count("daily_plans").unwrap(), 0);
        assert_eq!(database.count("plan_blocks").unwrap(), 0);
    }

    #[test]
    fn fixed_event_can_overlap_confirmed_task_block() {
        let mut database = Database::in_memory().unwrap();
        let task_id = database.create_manual_task("已确认任务").unwrap();
        database.update_manual_task(&task_id, ManualTaskUpdate {
            title: "已确认任务".into(), notes: None, priority: None,
            earliest_start_at: Some("2026-08-14T09:00:00+08:00".into()),
            due_at: Some("2026-08-14T10:00:00+08:00".into()), estimated_minutes: Some(60),
        }).unwrap();
        let proposal = json!({ "proposal_id": "confirmed-before-event", "operation": {
            "type": "proposed_plan", "plan_date": "2026-08-14", "blocks": [{
                "task_id": task_id, "starts_at": "2026-08-14T09:00:00+08:00",
                "ends_at": "2026-08-14T10:00:00+08:00", "source": "ai"
            }]
        }}).to_string();
        let preview = database.preview_ai_proposal(&proposal).unwrap();
        database.apply_confirmed_ai_proposal(&preview.ai_run_id, &preview.confirmation_token, false).unwrap();

        let overlapping = database.create_fixed_event(ManualCalendarEventInput {
            title: "同步会议".into(), starts_at: "2026-08-14T09:30:00+08:00".into(),
            ends_at: "2026-08-14T10:30:00+08:00".into(), is_all_day: false, blocks_scheduling: true,
        }).unwrap();
        assert_eq!(database.count("calendar_events").unwrap(), 1);
        assert!(!overlapping.blocks_scheduling, "兼容列必须始终保存为不占用时间");

        let updated = database.update_fixed_event(&overlapping.id, ManualCalendarEventInput {
            title: "同步会议（更新）".into(), starts_at: "2026-08-14T09:30:00+08:00".into(),
            ends_at: "2026-08-14T10:30:00+08:00".into(), is_all_day: false, blocks_scheduling: true,
        }).unwrap();
        assert_eq!(updated.title, "同步会议（更新）");
        assert!(!updated.blocks_scheduling);
    }

    #[test]
    fn rule_plan_preview_is_read_only_and_confirmation_is_one_transaction() {
        let mut database = Database::in_memory().unwrap();
        database.save_availability_settings(AvailabilitySettings {
            makeup_workdays_as_workdays: true,
            weekdays: vec![5], workday_start: "09:00".into(), workday_end: "12:00".into(),
            lunch_start: None, lunch_end: None, lunch_reason: "午休".into(), buffer_minutes: 0,
        }).unwrap();
        database.create_fixed_event(ManualCalendarEventInput {
            title: "不可移动会议".into(), starts_at: "2026-08-14T10:00:00+08:00".into(),
            ends_at: "2026-08-14T11:00:00+08:00".into(), is_all_day: false, blocks_scheduling: true,
        }).unwrap();
        let first = database.create_manual_task("完成方案").unwrap();
        let second = database.create_manual_task("整理记录").unwrap();
        let missing_estimate = database.create_manual_task("尚未估时").unwrap();
        for (id, title) in [(&first, "完成方案"), (&second, "整理记录")] {
            database.update_manual_task(id, ManualTaskUpdate {
                title: title.into(), notes: None, priority: Some(Priority::High),
                earliest_start_at: Some("2026-08-14T09:00:00+08:00".into()),
                due_at: Some("2026-08-14T10:00:00+08:00".into()), estimated_minutes: Some(60),
            }).unwrap();
        }
        database.update_manual_task(&missing_estimate, ManualTaskUpdate {
            title: "尚未估时".into(), notes: None, priority: None,
            earliest_start_at: Some("2026-08-14T09:00:00+08:00".into()),
            due_at: Some("2026-08-14T12:00:00+08:00".into()), estimated_minutes: None,
        }).unwrap();

        let preview = database.preview_rule_based_plan("2026-08-14").unwrap();
        assert_eq!(preview.blocks.len(), 2);
        assert_eq!(preview.unscheduled.len(), 1);
        assert_eq!(preview.unscheduled[0].task_id, missing_estimate);
        assert_eq!(preview.unscheduled[0].reason, "尚未填写预计时长");
        assert_eq!(preview.blocks[0].starts_at, "2026-08-14T09:00:00+08:00");
        assert_eq!(preview.blocks[1].starts_at, "2026-08-14T09:00:00+08:00");
        assert_eq!(database.count("daily_plan_drafts").unwrap(), 1, "草案必须独立持久化");
        assert_eq!(database.count("daily_plans").unwrap(), 0, "规则草案不得创建日计划");
        assert_eq!(database.count("plan_blocks").unwrap(), 0, "规则草案不得创建时间块");

        let schedule = database.confirm_rule_based_plan(preview).unwrap();
        assert!(schedule.plan_id.is_some());
        assert_eq!(schedule.plan_source.as_deref(), Some("rule_based"));
        assert_eq!(schedule.task_blocks.len(), 2);
        assert_eq!(database.count("daily_plans").unwrap(), 1);
        assert_eq!(database.count("plan_blocks").unwrap(), 2);
        assert_eq!(database.task_status(&first).unwrap(), "scheduled");
        assert_eq!(database.task_status(&second).unwrap(), "scheduled");
    }

    #[test]
    fn manual_plan_draft_adds_only_the_selected_task_and_resumes_without_regenerating() {
        let mut database = Database::in_memory().unwrap();
        let first = database.create_manual_task("手动加入的任务").unwrap();
        let second = database.create_manual_task("保留在待安排池").unwrap();
        let unknown = database.create_manual_task("尚未估时").unwrap();
        for (id, title, minutes) in [
            (&first, "手动加入的任务", Some(60)),
            (&second, "保留在待安排池", Some(90)),
            (&unknown, "尚未估时", None),
        ] {
            database.update_manual_task(id, ManualTaskUpdate {
                title: title.into(), notes: None, priority: None,
                earliest_start_at: Some("2026-09-08T09:00:00+08:00".into()),
                due_at: Some("2026-09-08T18:00:00+08:00".into()), estimated_minutes: minutes,
            }).unwrap();
        }
        let empty = database.start_manual_plan_draft("2026-09-08").unwrap();
        assert!(empty.blocks.is_empty());
        assert_eq!(empty.unscheduled.len(), 3);
        assert_eq!(empty.unscheduled.iter().find(|item| item.task_id == unknown).unwrap().estimated_minutes, None);
        assert_eq!(database.count("daily_plans").unwrap(), 0);
        assert_eq!(database.count("plan_blocks").unwrap(), 0);
        let resumed_empty = database.start_manual_plan_draft("2026-09-08").unwrap();
        assert_eq!(resumed_empty.version, empty.version);
        assert_eq!(resumed_empty.confirmation_token, empty.confirmation_token);
        let added = database.update_rule_plan_draft(
            &empty.preview_id, empty.version,
            vec![RulePlanBlock {
                task_id: first.clone(), task_title: "手动加入的任务".into(),
                starts_at: "2026-09-08T09:00:00+08:00".into(),
                ends_at: "2026-09-08T10:00:00+08:00".into(), estimated_minutes: 60,
            }],
            empty.unscheduled.into_iter().filter(|item| item.task_id != first).collect(),
        ).unwrap();
        let resumed = database.start_manual_plan_draft("2026-09-08").unwrap();
        assert_eq!(resumed.version, added.version);
        assert_eq!(resumed.confirmation_token, added.confirmation_token);
        assert_eq!(resumed.blocks.len(), 1);
        let schedule = database.confirm_rule_based_plan(resumed).unwrap();
        assert_eq!(schedule.task_blocks.len(), 1);
        assert_eq!(schedule.task_blocks[0].task_id, first);
        assert_eq!(database.task_status(&second).unwrap(), "open");
        assert_eq!(database.task_status(&unknown).unwrap(), "open");
    }

    #[test]
    fn empty_manual_plan_draft_can_be_discarded_without_changing_the_calendar() {
        let mut database = Database::in_memory().unwrap();
        assert!(database.start_manual_plan_draft("invalid-date").is_err());
        let draft = database.start_manual_plan_draft("2026-09-08").unwrap();
        database.discard_rule_plan_draft(&draft.preview_id, draft.version).unwrap();
        assert!(database.get_rule_plan_draft("2026-09-08").unwrap().is_none());
        assert_eq!(database.count("daily_plans").unwrap(), 0);
        assert_eq!(database.count("plan_blocks").unwrap(), 0);
    }

    #[test]
    fn rule_plan_draft_edit_persists_and_rotates_confirmation_token() {
        let mut database = Database::in_memory().unwrap();
        database.save_availability_settings(AvailabilitySettings {
            makeup_workdays_as_workdays: true,
            weekdays: vec![5], workday_start: "09:00".into(), workday_end: "12:00".into(),
            lunch_start: None, lunch_end: None, lunch_reason: "午休".into(), buffer_minutes: 0,
        }).unwrap();
        let task_id = database.create_manual_task("调整草案时间").unwrap();
        database.update_manual_task(&task_id, ManualTaskUpdate {
            title: "调整草案时间".into(), notes: None, priority: Some(Priority::High),
            earliest_start_at: Some("2026-08-14T09:00:00+08:00".into()),
            due_at: Some("2026-08-14T10:00:00+08:00".into()), estimated_minutes: Some(60),
        }).unwrap();

        let original = database.preview_rule_based_plan("2026-08-14").unwrap();
        let mut edited_blocks = original.blocks.clone();
        edited_blocks[0].starts_at = "2026-08-14T10:07:00+08:00".into();
        edited_blocks[0].ends_at = "2026-08-14T11:07:00+08:00".into();
        let edited = database.update_rule_plan_draft(
            &original.preview_id,
            original.version,
            edited_blocks,
            original.unscheduled.clone(),
        ).unwrap();

        assert_eq!(edited.version, original.version + 1);
        assert_ne!(edited.confirmation_token, original.confirmation_token);
        assert_eq!(database.get_rule_plan_draft("2026-08-14").unwrap().unwrap().blocks[0].starts_at, "2026-08-14T10:07:00+08:00");
        assert!(database.confirm_rule_based_plan(original).is_err(), "旧令牌不得确认更新后的草案");
        assert_eq!(database.count("daily_plans").unwrap(), 0);

        let schedule = database.confirm_rule_based_plan(edited).unwrap();
        assert_eq!(schedule.task_blocks[0].starts_at, "2026-08-14T10:07:00+08:00");
        assert!(database.get_rule_plan_draft("2026-08-14").unwrap().is_none());
        assert_eq!(database.count("daily_plans").unwrap(), 1);
    }

    #[test]
    fn rule_plan_keeps_sub_fifteen_minute_workload_unscheduled() {
        let mut database = Database::in_memory().unwrap();
        let short_id = database.create_manual_task("十分钟剩余工作").unwrap();
        let minimum_id = database.create_manual_task("十五分钟工作").unwrap();
        let narrow_window_id = database.create_manual_task("当天仅剩十分钟窗口").unwrap();
        for (task_id, title, minutes) in [
            (&short_id, "十分钟剩余工作", 10),
            (&minimum_id, "十五分钟工作", 15),
        ] {
            database.update_manual_task(task_id, ManualTaskUpdate {
                title: title.into(), notes: None, priority: None,
                earliest_start_at: Some("2026-09-08T09:00:00+08:00".into()),
                due_at: Some("2026-09-08T12:00:00+08:00".into()), estimated_minutes: Some(minutes),
            }).unwrap();
        }
        let creation_clock = TestNow::new("2026-09-07T00:00:00+08:00");
        database.update_manual_task(&narrow_window_id, ManualTaskUpdate {
            title: "当天仅剩十分钟窗口".into(), notes: None, priority: None,
            earliest_start_at: Some("2026-09-07T09:00:00+08:00".into()),
            due_at: Some("2026-09-08T09:10:00+08:00".into()),
            estimated_minutes: Some(60),
        }).unwrap();
        drop(creation_clock);

        let preview = database.preview_rule_based_plan("2026-09-08").unwrap();
        assert_eq!(preview.blocks.len(), 1);
        assert_eq!(preview.blocks[0].task_id, minimum_id);
        assert_eq!(preview.blocks[0].estimated_minutes, MIN_TASK_BLOCK_MINUTES);
        assert_eq!(preview.unscheduled.len(), 2);
        let short = preview.unscheduled.iter().find(|item| item.task_id == short_id).unwrap();
        assert_eq!(short.estimated_minutes, Some(10));
        assert!(short.reason.contains("至少需要 15 分钟"));
        let narrow_window = preview.unscheduled.iter()
            .find(|item| item.task_id == narrow_window_id)
            .unwrap();
        assert_eq!(narrow_window.estimated_minutes, Some(60));
        assert!(narrow_window.reason.contains("当天允许时间不足 15 分钟"));
    }

    #[test]
    fn rule_plan_draft_rejects_manual_blocks_shorter_than_fifteen_minutes() {
        let mut database = Database::in_memory().unwrap();
        let task_id = database.create_manual_task("检查手动短块边界").unwrap();
        database.update_manual_task(&task_id, ManualTaskUpdate {
            title: "检查手动短块边界".into(), notes: None, priority: None,
            earliest_start_at: Some("2026-09-08T09:00:00+08:00".into()),
            due_at: Some("2026-09-08T12:00:00+08:00".into()), estimated_minutes: Some(60),
        }).unwrap();

        let preview = database.preview_rule_based_plan("2026-09-08").unwrap();
        let mut too_short = preview.blocks.clone();
        too_short[0].starts_at = "2026-09-08T09:00:00+08:00".into();
        too_short[0].ends_at = "2026-09-08T09:10:00+08:00".into();
        let error = database.update_rule_plan_draft(
            &preview.preview_id, preview.version, too_short, preview.unscheduled.clone(),
        ).unwrap_err();
        assert!(error.to_string().contains("至少需要 15 分钟"));

        let mut minimum = preview.blocks.clone();
        minimum[0].starts_at = "2026-09-08T09:00:00+08:00".into();
        minimum[0].ends_at = "2026-09-08T09:15:00+08:00".into();
        let saved = database.update_rule_plan_draft(
            &preview.preview_id, preview.version, minimum, preview.unscheduled,
        ).unwrap();
        assert_eq!(saved.blocks[0].estimated_minutes, MIN_TASK_BLOCK_MINUTES);
    }

    #[test]
    fn confirmed_plan_can_be_adjusted_without_replacing_execution_history() {
        let mut database = Database::in_memory().unwrap();
        database.save_availability_settings(AvailabilitySettings {
            makeup_workdays_as_workdays: true,
            weekdays: vec![5], workday_start: "09:00".into(), workday_end: "12:00".into(),
            lunch_start: None, lunch_end: None, lunch_reason: "午休".into(), buffer_minutes: 0,
        }).unwrap();
        let completed_task_id = database.create_manual_task("已经执行的时间块").unwrap();
        let pending_task_id = database.create_manual_task("尚未执行的时间块").unwrap();
        for (task_id, title) in [
            (&completed_task_id, "已经执行的时间块"),
            (&pending_task_id, "尚未执行的时间块"),
        ] {
            database.update_manual_task(task_id, ManualTaskUpdate {
                title: title.into(), notes: None, priority: Some(Priority::High),
                earliest_start_at: Some("2026-08-14T09:00:00+08:00".into()),
                due_at: Some("2026-08-14T12:00:00+08:00".into()), estimated_minutes: Some(60),
            }).unwrap();
        }
        let original = database.preview_rule_based_plan("2026-08-14").unwrap();
        let original_schedule = database.confirm_rule_based_plan(original).unwrap();
        let original_plan_id = original_schedule.plan_id.clone().unwrap();
        let completed_block = original_schedule.task_blocks.iter()
            .find(|block| block.task_id == completed_task_id).unwrap();
        let completed_block_id = completed_block.id.clone();
        let clock = TestToday::new("2026-08-14");
        database.save_execution_capture("2026-08-14", ExecutionCaptureInput {
            plan_block_id: completed_block_id.clone(),
            outcome: Some(ReviewOutcome::Completed),
            note: None,
        }).unwrap();
        drop(clock);

        let adjustment = database.start_manual_plan_draft("2026-08-14").unwrap();
        assert_eq!(database.start_manual_plan_draft("2026-08-14").unwrap().confirmation_token, adjustment.confirmation_token);
        assert_eq!(adjustment.base_plan_id.as_deref(), Some(original_plan_id.as_str()));
        assert_eq!(adjustment.blocks.len(), 1, "只有尚未执行的时间块应进入调整草案");
        assert_eq!(adjustment.blocks[0].task_id, pending_task_id);
        let mut adjusted_blocks = adjustment.blocks.clone();
        adjusted_blocks[0].starts_at = "2026-08-14T11:00:00+08:00".into();
        adjusted_blocks[0].ends_at = "2026-08-14T12:00:00+08:00".into();
        let adjusted = database.update_rule_plan_draft(
            &adjustment.preview_id,
            adjustment.version,
            adjusted_blocks,
            adjustment.unscheduled.clone(),
        ).unwrap();
        let saved = database.confirm_rule_based_plan(adjusted).unwrap();

        assert_eq!(saved.plan_id.as_deref(), Some(original_plan_id.as_str()), "调整应保留原计划身份");
        assert_eq!(saved.plan_source.as_deref(), Some("manual"));
        let preserved = saved.task_blocks.iter().find(|block| block.task_id == completed_task_id).unwrap();
        assert_eq!(preserved.id, completed_block_id, "已有执行事实的时间块必须保留原身份");
        assert_eq!(preserved.execution_status, "completed");
        let adjusted_block = saved.task_blocks.iter().find(|block| block.task_id == pending_task_id).unwrap();
        assert_eq!(adjusted_block.starts_at, "2026-08-14T11:00:00+08:00");
        assert_eq!(adjusted_block.source, "manual");
        assert_eq!(database.count("daily_plans").unwrap(), 1, "调整不得创建重复日计划");
        assert_eq!(database.count("plan_blocks").unwrap(), 2);

        let clock = TestToday::new("2026-08-14");
        database.save_execution_capture("2026-08-14", ExecutionCaptureInput {
            plan_block_id: adjusted_block.id.clone(),
            outcome: Some(ReviewOutcome::Completed),
            note: None,
        }).unwrap();
        drop(clock);
        let newly_available_task_id = database.create_manual_task("执行后新增的待安排任务").unwrap();
        database.update_manual_task(&newly_available_task_id, ManualTaskUpdate {
            title: "执行后新增的待安排任务".into(), notes: None, priority: Some(Priority::High),
            earliest_start_at: Some("2026-08-14T09:00:00+08:00".into()),
            due_at: Some("2026-08-14T12:00:00+08:00".into()), estimated_minutes: Some(60),
        }).unwrap();

        let addition = database.start_confirmed_plan_adjustment("2026-08-14").unwrap();
        assert!(addition.blocks.is_empty(), "已执行时间块不得重新进入调整草案");
        assert_eq!(addition.unscheduled.len(), 1, "新增的可安排任务应进入调整草案");
        assert_eq!(addition.unscheduled[0].task_id, newly_available_task_id);
        assert_eq!(addition.unscheduled[0].estimated_minutes, Some(60));
        let added = database.update_rule_plan_draft(
            &addition.preview_id,
            addition.version,
            vec![RulePlanBlock {
                task_id: newly_available_task_id.clone(),
                task_title: "执行后新增的待安排任务".into(),
                starts_at: "2026-08-14T10:00:00+08:00".into(),
                ends_at: "2026-08-14T11:00:00+08:00".into(),
                estimated_minutes: 60,
            }],
            Vec::new(),
        ).unwrap();
        let expanded = database.confirm_rule_based_plan(added).unwrap();
        assert_eq!(expanded.plan_id.as_deref(), Some(original_plan_id.as_str()));
        assert_eq!(expanded.task_blocks.len(), 3, "调整应在保留执行历史的同时加入新时间块");
        assert!(expanded.task_blocks.iter().any(|block| {
            block.task_id == newly_available_task_id
                && block.starts_at == "2026-08-14T10:00:00+08:00"
                && block.execution_status == "planned"
        }));
        assert_eq!(expanded.task_blocks.iter().filter(|block| block.execution_status == "completed").count(), 2);
        assert_eq!(database.count("plan_blocks").unwrap(), 3);
    }

    #[test]
    fn confirmed_plan_adjustment_can_be_regenerated_without_moving_locked_history() {
        let mut database = Database::in_memory().unwrap();
        database.save_availability_settings(AvailabilitySettings {
            makeup_workdays_as_workdays: true,
            weekdays: vec![5], workday_start: "09:00".into(), workday_end: "12:00".into(),
            lunch_start: None, lunch_end: None, lunch_reason: "午休".into(), buffer_minutes: 0,
        }).unwrap();
        let locked_task_id = database.create_manual_task("已有执行记录").unwrap();
        database.update_manual_task(&locked_task_id, ManualTaskUpdate {
            title: "已有执行记录".into(), notes: None, priority: Some(Priority::High),
            earliest_start_at: Some("2026-09-04T09:00:00+08:00".into()),
            due_at: Some("2026-09-04T12:00:00+08:00".into()), estimated_minutes: Some(60),
        }).unwrap();
        let original = database.preview_rule_based_plan("2026-09-04").unwrap();
        let confirmed = database.confirm_rule_based_plan(original).unwrap();
        let plan_id = confirmed.plan_id.clone().unwrap();
        let locked_block = confirmed.task_blocks[0].clone();
        let clock = TestToday::new("2026-09-04");
        database.save_execution_capture("2026-09-04", ExecutionCaptureInput {
            plan_block_id: locked_block.id.clone(), outcome: Some(ReviewOutcome::Completed), note: None,
        }).unwrap();
        drop(clock);

        let new_task_id = database.create_manual_task("重新生成时加入").unwrap();
        database.update_manual_task(&new_task_id, ManualTaskUpdate {
            title: "重新生成时加入".into(), notes: None, priority: Some(Priority::High),
            earliest_start_at: Some("2026-09-04T09:30:00+08:00".into()),
            due_at: Some("2026-09-04T10:30:00+08:00".into()), estimated_minutes: Some(60),
        }).unwrap();
        let adjustment = database.start_confirmed_plan_adjustment("2026-09-04").unwrap();
        assert!(adjustment.blocks.is_empty());
        assert_eq!(adjustment.unscheduled[0].task_id, new_task_id);

        let edited = database.update_rule_plan_draft(
            &adjustment.preview_id,
            adjustment.version,
            vec![RulePlanBlock {
                task_id: new_task_id.clone(),
                task_title: "重新生成时加入".into(),
                starts_at: "2026-09-04T09:00:00+08:00".into(),
                ends_at: "2026-09-04T11:00:00+08:00".into(),
                estimated_minutes: 120,
            }],
            Vec::new(),
        ).unwrap();
        let widened_task = database.get_task(&new_task_id).unwrap();
        assert_eq!(widened_task.earliest_start_at.as_deref(), Some("2026-09-04T09:00:00+08:00"));
        assert_eq!(widened_task.due_at.as_deref(), Some("2026-09-04T11:00:00+08:00"));

        let regenerated = database.regenerate_confirmed_plan_adjustment("2026-09-04").unwrap();
        assert_eq!(regenerated.preview_id, adjustment.preview_id, "重新生成应更新同一份调整草案");
        assert_eq!(regenerated.version, edited.version + 1);
        assert_eq!(regenerated.base_plan_id.as_deref(), Some(plan_id.as_str()));
        assert_eq!(regenerated.blocks.len(), 1);
        assert_eq!(regenerated.blocks[0].task_id, new_task_id);
        assert_eq!(regenerated.blocks[0].starts_at, "2026-09-04T09:30:00+08:00", "重新生成前应撤销本轮草案放宽的任务时间");
        assert_eq!(regenerated.blocks[0].ends_at, "2026-09-04T10:30:00+08:00");
        let restored_task = database.get_task(&new_task_id).unwrap();
        assert_eq!(restored_task.earliest_start_at.as_deref(), Some("2026-09-04T09:30:00+08:00"));
        assert_eq!(restored_task.due_at.as_deref(), Some("2026-09-04T10:30:00+08:00"));

        let saved = database.confirm_rule_based_plan(regenerated).unwrap();
        let preserved = saved.task_blocks.iter().find(|block| block.id == locked_block.id).unwrap();
        assert_eq!(preserved.execution_status, "completed");
        assert!(saved.task_blocks.iter().any(|block| block.task_id == new_task_id));
    }

    #[test]
    fn tasks_outside_the_selected_date_are_absent_and_confirmation_matches_preview() {
        let mut database = Database::in_memory().unwrap();
        database.save_availability_settings(AvailabilitySettings {
            makeup_workdays_as_workdays: true,
            weekdays: vec![5], workday_start: "09:00".into(), workday_end: "12:00".into(),
            lunch_start: None, lunch_end: None, lunch_reason: "午休".into(), buffer_minutes: 0,
        }).unwrap();
        for title in ["9月3日任务一", "9月3日任务二", "9月3日任务三"] {
            let task_id = database.create_manual_task(title).unwrap();
            database.update_manual_task(&task_id, ManualTaskUpdate {
                title: title.into(), notes: None, priority: Some(Priority::High),
                earliest_start_at: Some("2026-09-03T11:00:00+08:00".into()),
                due_at: Some("2026-09-03T12:00:00+08:00".into()),
                estimated_minutes: Some(60),
            }).unwrap();
        }
        let future_task_id = database.create_manual_task("9月23日到期任务").unwrap();
        let creation_clock = TestNow::new("2026-08-28T00:00:00+08:00");
        database.update_manual_task(&future_task_id, ManualTaskUpdate {
            title: "9月23日到期任务".into(), notes: None, priority: Some(Priority::Low),
            earliest_start_at: Some("2026-08-28T11:00:00+08:00".into()),
            due_at: Some("2026-09-23T17:00:00+08:00".into()), estimated_minutes: Some(70),
        }).unwrap();
        drop(creation_clock);

        let preview = database.preview_rule_based_plan("2026-09-04").unwrap();
        assert_eq!(preview.blocks.len(), 1);
        assert_eq!(preview.blocks[0].task_id, future_task_id);
        assert!(preview.unscheduled.is_empty(), "9 月 3 日已截止的任务不属于 9 月 4 日，不应显示在未排入中");
        let preview_block = preview.blocks[0].clone();

        let confirmed = database.confirm_rule_based_plan(preview).unwrap();
        assert_eq!(confirmed.task_blocks.len(), 1);
        assert_eq!(confirmed.task_blocks[0].task_id, preview_block.task_id);
        assert_eq!(confirmed.task_blocks[0].starts_at, preview_block.starts_at);
        assert_eq!(confirmed.task_blocks[0].ends_at, preview_block.ends_at);
    }

    #[test]
    fn confirmed_plan_adjustment_can_remove_all_pending_blocks_from_the_day() {
        let mut database = Database::in_memory().unwrap();
        database.save_availability_settings(AvailabilitySettings {
            makeup_workdays_as_workdays: true,
            weekdays: vec![5], workday_start: "09:00".into(), workday_end: "12:00".into(),
            lunch_start: None, lunch_end: None, lunch_reason: "午休".into(), buffer_minutes: 0,
        }).unwrap();
        let task_id = database.create_manual_task("移出本日的任务").unwrap();
        database.update_manual_task(&task_id, ManualTaskUpdate {
            title: "移出本日的任务".into(), notes: None, priority: Some(Priority::High),
            earliest_start_at: Some("2026-08-14T09:00:00+08:00".into()),
            due_at: Some("2026-08-14T12:00:00+08:00".into()), estimated_minutes: Some(60),
        }).unwrap();
        let initial = database.preview_rule_based_plan("2026-08-14").unwrap();
        let confirmed = database.confirm_rule_based_plan(initial).unwrap();
        let plan_id = confirmed.plan_id.unwrap();

        let adjustment = database.start_confirmed_plan_adjustment("2026-08-14").unwrap();
        let block = adjustment.blocks[0].clone();
        let emptied = database.update_rule_plan_draft(
            &adjustment.preview_id,
            adjustment.version,
            Vec::new(),
            vec![UnscheduledTask {
                task_id: block.task_id,
                task_title: block.task_title,
                reason: "手动移出今日 · 60 分钟待安排".into(),
                estimated_minutes: Some(block.estimated_minutes),
            }],
        ).unwrap();
        let saved = database.confirm_rule_based_plan(emptied).unwrap();

        assert_eq!(saved.plan_id.as_deref(), Some(plan_id.as_str()), "移空后仍应保留原计划身份");
        assert!(saved.task_blocks.is_empty(), "所有未执行时间块应从本日计划移除");
        assert_eq!(database.task_status(&task_id).unwrap(), "open", "移出本日后任务应恢复为待处理");
        assert_eq!(database.count("daily_plans").unwrap(), 1, "移空调整不得创建重复日计划");
        assert_eq!(database.count("plan_blocks").unwrap(), 0);
    }

    #[test]
    fn rule_plan_draft_allows_overlaps_and_non_working_dates_and_expands_task_bounds() {
        let mut database = Database::in_memory().unwrap();
        database.save_availability_settings(AvailabilitySettings {
            makeup_workdays_as_workdays: true,
            weekdays: vec![5], workday_start: "09:00".into(), workday_end: "13:00".into(),
            lunch_start: None, lunch_end: None, lunch_reason: "午休".into(), buffer_minutes: 15,
        }).unwrap();
        let bounded_id = database.create_manual_task("有时间边界的任务").unwrap();
        database.update_manual_task(&bounded_id, ManualTaskUpdate {
            title: "有时间边界的任务".into(), notes: None, priority: Some(Priority::High),
            earliest_start_at: Some("2026-08-14T09:10:00+08:00".into()),
            due_at: Some("2026-08-14T11:00:00+08:00".into()), estimated_minutes: Some(60),
        }).unwrap();
        let second_id = database.create_manual_task("需要缓冲的任务").unwrap();
        database.update_manual_task(&second_id, ManualTaskUpdate {
            title: "需要缓冲的任务".into(), notes: None, priority: Some(Priority::Medium),
            earliest_start_at: Some("2026-08-14T09:00:00+08:00".into()),
            due_at: Some("2026-08-14T13:00:00+08:00".into()), estimated_minutes: Some(60),
        }).unwrap();

        let original = database.preview_rule_based_plan("2026-08-14").unwrap();
        assert_eq!(original.blocks.len(), 2);
        let mut precise_blocks = original.blocks.clone();
        let bounded = precise_blocks.iter_mut().find(|block| block.task_id == bounded_id).unwrap();
        bounded.starts_at = "2026-08-14T09:11:00+08:00".into();
        bounded.ends_at = "2026-08-14T10:09:00+08:00".into();
        let precise = database.update_rule_plan_draft(
            &original.preview_id, original.version, precise_blocks, original.unscheduled.clone(),
        ).unwrap();
        assert_eq!(precise.blocks.iter().find(|block| block.task_id == bounded_id).unwrap().estimated_minutes, 58);

        let mut before_earliest = precise.blocks.clone();
        let bounded = before_earliest.iter_mut().find(|block| block.task_id == bounded_id).unwrap();
        bounded.starts_at = "2026-08-14T09:00:00+08:00".into();
        bounded.ends_at = "2026-08-14T10:09:00+08:00".into();
        let expanded_early = database.update_rule_plan_draft(
            &precise.preview_id, precise.version, before_earliest, precise.unscheduled.clone(),
        ).unwrap();
        let task = database.get_task(&bounded_id).unwrap();
        assert_eq!(task.earliest_start_at.as_deref(), Some("2026-08-14T09:00:00+08:00"));
        assert_eq!(task.earliest_start_date.as_deref(), Some("2026-08-14"));
        assert_eq!(task.earliest_start_time.as_deref(), Some("09:00"));
        assert_eq!(task.due_at.as_deref(), Some("2026-08-14T11:00:00+08:00"));

        let mut after_due = expanded_early.blocks.clone();
        let bounded = after_due.iter_mut().find(|block| block.task_id == bounded_id).unwrap();
        bounded.starts_at = "2026-08-14T10:01:00+08:00".into();
        bounded.ends_at = "2026-08-14T11:15:00+08:00".into();
        let expanded_due = database.update_rule_plan_draft(
            &expanded_early.preview_id, expanded_early.version, after_due, expanded_early.unscheduled.clone(),
        ).unwrap();
        let task = database.get_task(&bounded_id).unwrap();
        assert_eq!(task.earliest_start_at.as_deref(), Some("2026-08-14T09:00:00+08:00"));
        assert_eq!(task.due_at.as_deref(), Some("2026-08-14T11:15:00+08:00"));
        assert_eq!(task.due_date.as_deref(), Some("2026-08-14"));
        assert_eq!(task.due_time.as_deref(), Some("11:15"));

        let mut overlapping = expanded_due.blocks.clone();
        let bounded = overlapping.iter_mut().find(|block| block.task_id == bounded_id).unwrap();
        bounded.starts_at = "2026-08-14T09:30:00+08:00".into();
        bounded.ends_at = "2026-08-14T10:30:00+08:00".into();
        let second = overlapping.iter_mut().find(|block| block.task_id == second_id).unwrap();
        second.starts_at = "2026-08-14T09:30:00+08:00".into();
        second.ends_at = "2026-08-14T10:30:00+08:00".into();
        let overlapping = database.update_rule_plan_draft(
            &expanded_due.preview_id, expanded_due.version, overlapping, expanded_due.unscheduled.clone(),
        ).unwrap();
        let task = database.get_task(&bounded_id).unwrap();
        assert_eq!(task.earliest_start_at.as_deref(), Some("2026-08-14T09:00:00+08:00"), "向内移动不得收窄任务开始边界");
        assert_eq!(task.due_at.as_deref(), Some("2026-08-14T11:15:00+08:00"), "向内移动不得收窄任务截止边界");
        let bounded = overlapping.blocks.iter().find(|block| block.task_id == bounded_id).unwrap();
        let second = overlapping.blocks.iter().find(|block| block.task_id == second_id).unwrap();
        assert!(bounded.starts_at < second.ends_at && second.starts_at < bounded.ends_at, "草案必须允许部分重叠");

        let residual = database.update_rule_plan_draft(
            &overlapping.preview_id,
            overlapping.version,
            overlapping.blocks.clone(),
            vec![UnscheduledTask {
                task_id: bounded_id.clone(), task_title: String::new(),
                reason: "手动移出今日 · 7 分钟待安排".into(), estimated_minutes: Some(7),
            }],
        ).unwrap();
        assert_eq!(residual.unscheduled[0].estimated_minutes, Some(7));
        assert!(residual.blocks.iter().any(|block| block.task_id == bounded_id), "同一任务的剩余工作量可与已排块并存");

        let creation_clock = TestNow::new("2026-08-14T00:00:00+08:00");
        database.update_manual_task(&second_id, ManualTaskUpdate {
            title: "需要缓冲的任务".into(), notes: None, priority: Some(Priority::Medium),
            earliest_start_at: Some("2026-08-14T09:00:00+08:00".into()),
            due_at: Some("2026-08-15T13:00:00+08:00".into()), estimated_minutes: Some(120),
        }).unwrap();
        drop(creation_clock);
        let saturday = database.preview_rule_based_plan("2026-08-15").unwrap();
        let saturday_blocks = vec![RulePlanBlock {
            task_id: second_id.clone(), task_title: String::new(),
            starts_at: "2026-08-15T09:10:00+08:00".into(),
            ends_at: "2026-08-15T10:10:00+08:00".into(), estimated_minutes: 60,
        }];
        let saturday_unscheduled = saturday.unscheduled.into_iter()
            .filter(|item| item.task_id != second_id)
            .collect::<Vec<_>>();
        let saturday_saved = database.update_rule_plan_draft(
            &saturday.preview_id, saturday.version, saturday_blocks, saturday_unscheduled,
        ).unwrap();
        assert_eq!(saturday_saved.blocks.len(), 1, "非工作日仅是偏好，仍可手动安排");
    }

    #[test]
    fn rule_plan_draft_boundary_expansion_keeps_confirmation_current() {
        let mut database = Database::in_memory().unwrap();
        database.save_availability_settings(AvailabilitySettings {
            makeup_workdays_as_workdays: true,
            weekdays: vec![5], workday_start: "09:00".into(), workday_end: "12:00".into(),
            lunch_start: None, lunch_end: None, lunch_reason: String::new(), buffer_minutes: 0,
        }).unwrap();
        let task_id = database.create_manual_task("同步任务时间").unwrap();
        database.update_manual_task(&task_id, ManualTaskUpdate {
            title: "同步任务时间".into(), notes: None, priority: None,
            earliest_start_at: Some("2026-08-14T09:30:00+08:00".into()),
            due_at: Some("2026-08-14T10:30:00+08:00".into()),
            estimated_minutes: Some(60),
        }).unwrap();

        let preview = database.preview_rule_based_plan("2026-08-14").unwrap();
        let mut blocks = preview.blocks.clone();
        blocks[0].starts_at = "2026-08-14T09:00:00+08:00".into();
        blocks[0].ends_at = "2026-08-14T11:00:00+08:00".into();
        let edited = database.update_rule_plan_draft(
            &preview.preview_id, preview.version, blocks, preview.unscheduled,
        ).unwrap();

        let task = database.get_task(&task_id).unwrap();
        assert_eq!(task.earliest_start_at.as_deref(), Some("2026-08-14T09:00:00+08:00"));
        assert_eq!(task.due_at.as_deref(), Some("2026-08-14T11:00:00+08:00"));
        let boundary_changes: i64 = database.connection.query_row(
            "SELECT COUNT(*) FROM task_changes WHERE task_id = ?1 AND source = 'plan_draft'",
            [&task_id],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(boundary_changes, 2, "草案带动的两项任务时间变化必须留痕");

        let schedule = database.confirm_rule_based_plan(edited).unwrap();
        assert_eq!(schedule.task_blocks[0].starts_at, "2026-08-14T09:00:00+08:00");
        assert_eq!(schedule.task_blocks[0].ends_at, "2026-08-14T11:00:00+08:00");
    }

    #[test]
    fn discarding_rule_plan_draft_restores_task_boundaries_changed_by_that_draft() {
        let mut database = Database::in_memory().unwrap();
        let task_id = database.create_manual_task("放弃草案后恢复时间").unwrap();
        database.update_manual_task(&task_id, ManualTaskUpdate {
            title: "放弃草案后恢复时间".into(), notes: None, priority: None,
            earliest_start_at: Some("2026-09-08T09:30:00+08:00".into()),
            due_at: Some("2026-09-08T10:30:00+08:00".into()),
            estimated_minutes: Some(60),
        }).unwrap();

        let preview = database.preview_rule_based_plan("2026-09-08").unwrap();
        let mut blocks = preview.blocks.clone();
        blocks[0].starts_at = "2026-09-08T09:00:00+08:00".into();
        blocks[0].ends_at = "2026-09-08T11:00:00+08:00".into();
        let edited = database.update_rule_plan_draft(
            &preview.preview_id, preview.version, blocks, preview.unscheduled,
        ).unwrap();

        let result = database.discard_rule_plan_draft(&edited.preview_id, edited.version).unwrap();
        assert_eq!(result.restored_task_count, 1);
        assert!(result.conflicted_task_titles.is_empty());
        let task = database.get_task(&task_id).unwrap();
        assert_eq!(task.earliest_start_at.as_deref(), Some("2026-09-08T09:30:00+08:00"));
        assert_eq!(task.due_at.as_deref(), Some("2026-09-08T10:30:00+08:00"));
        assert_eq!(task.earliest_start_time.as_deref(), Some("09:30"));
        assert_eq!(task.due_time.as_deref(), Some("10:30"));
        assert!(database.get_rule_plan_draft("2026-09-08").unwrap().is_none());
        let pending_boundaries: i64 = database.connection.query_row(
            "SELECT COUNT(*) FROM daily_plan_draft_task_boundaries WHERE draft_id = ?1",
            [&edited.preview_id],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(pending_boundaries, 0);
    }

    #[test]
    fn discarding_rule_plan_draft_preserves_later_manual_task_time_changes() {
        let mut database = Database::in_memory().unwrap();
        let task_id = database.create_manual_task("保留后来修改的时间").unwrap();
        database.update_manual_task(&task_id, ManualTaskUpdate {
            title: "保留后来修改的时间".into(), notes: None, priority: None,
            earliest_start_at: Some("2026-09-08T09:30:00+08:00".into()),
            due_at: Some("2026-09-08T10:30:00+08:00".into()),
            estimated_minutes: Some(60),
        }).unwrap();

        let preview = database.preview_rule_based_plan("2026-09-08").unwrap();
        let mut blocks = preview.blocks.clone();
        blocks[0].starts_at = "2026-09-08T09:00:00+08:00".into();
        blocks[0].ends_at = "2026-09-08T11:00:00+08:00".into();
        let edited = database.update_rule_plan_draft(
            &preview.preview_id, preview.version, blocks, preview.unscheduled,
        ).unwrap();

        database.update_manual_task(&task_id, ManualTaskUpdate {
            title: "保留后来修改的时间".into(), notes: None, priority: None,
            earliest_start_at: Some("2026-09-08T08:30:00+08:00".into()),
            due_at: Some("2026-09-08T11:30:00+08:00".into()),
            estimated_minutes: Some(60),
        }).unwrap();
        let result = database.discard_rule_plan_draft(&edited.preview_id, edited.version).unwrap();

        assert_eq!(result.restored_task_count, 0);
        assert_eq!(result.conflicted_task_titles, vec!["保留后来修改的时间"]);
        let task = database.get_task(&task_id).unwrap();
        assert_eq!(task.earliest_start_at.as_deref(), Some("2026-09-08T08:30:00+08:00"));
        assert_eq!(task.due_at.as_deref(), Some("2026-09-08T11:30:00+08:00"));
        assert!(database.get_rule_plan_draft("2026-09-08").unwrap().is_none());
    }

    #[test]
    fn invalid_rule_plan_draft_edit_does_not_change_task_or_draft() {
        let mut database = Database::in_memory().unwrap();
        let task_id = database.create_manual_task("拒绝半保存").unwrap();
        database.update_manual_task(&task_id, ManualTaskUpdate {
            title: "拒绝半保存".into(), notes: None, priority: None,
            earliest_start_at: Some("2026-09-08T09:30:00+08:00".into()),
            due_at: Some("2026-09-08T11:00:00+08:00".into()),
            estimated_minutes: Some(60),
        }).unwrap();
        let preview = database.preview_rule_based_plan("2026-09-08").unwrap();
        let mut invalid = preview.blocks.clone();
        invalid[0].starts_at = "2026-09-08T09:00:00+08:00".into();
        invalid[0].ends_at = "2026-09-08T09:10:00+08:00".into();

        let error = database.update_rule_plan_draft(
            &preview.preview_id, preview.version, invalid, preview.unscheduled.clone(),
        ).unwrap_err();
        assert!(error.to_string().contains("至少需要 15 分钟"));
        let task = database.get_task(&task_id).unwrap();
        assert_eq!(task.earliest_start_at.as_deref(), Some("2026-09-08T09:30:00+08:00"));
        assert_eq!(task.due_at.as_deref(), Some("2026-09-08T11:00:00+08:00"));
        let stored = database.get_rule_plan_draft("2026-09-08").unwrap().unwrap();
        assert_eq!(stored.version, preview.version);
        assert_eq!(stored.blocks, preview.blocks);
        let boundary_changes: i64 = database.connection.query_row(
            "SELECT COUNT(*) FROM task_changes WHERE task_id = ?1 AND source = 'plan_draft'",
            [&task_id],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(boundary_changes, 0);
    }

    #[test]
    fn stale_rule_plan_never_partially_commits_even_when_time_overlaps() {
        let _clock = TestNow::new("2026-10-22T18:00:00+08:00");
        let mut database = Database::in_memory().unwrap();
        database.save_availability_settings(AvailabilitySettings {
            makeup_workdays_as_workdays: true,
            weekdays: vec![5], workday_start: "09:00".into(), workday_end: "10:00".into(),
            lunch_start: None, lunch_end: None, lunch_reason: "午休".into(), buffer_minutes: 0,
        }).unwrap();
        let first = database.create_manual_task("可排任务").unwrap();
        let second = database.create_manual_task("可重叠任务").unwrap();
        for (id, title) in [(&first, "可排任务"), (&second, "可重叠任务")] {
            database.update_manual_task(id, ManualTaskUpdate {
                title: title.into(), notes: None, priority: None,
                earliest_start_at: Some("2026-08-14T09:00:00+08:00".into()),
                due_at: Some("2026-08-14T12:00:00+08:00".into()), estimated_minutes: Some(60),
            }).unwrap();
        }
        let preview = database.preview_rule_based_plan("2026-08-14").unwrap();
        assert_eq!(preview.blocks.len(), 2);
        assert!(preview.unscheduled.is_empty());
        assert_eq!(preview.blocks[0].starts_at, preview.blocks[1].starts_at, "相同偏好时间应并列安排");
        database.transition_manual_task(&first, TaskStatus::Done).unwrap();
        let before = fact_fingerprint(&database.connection, "task_completion", &first).unwrap();
        let untouched = fact_fingerprint(&database.connection, "task_completion", &second).unwrap();
        assert!(database.confirm_rule_based_plan(preview).is_err());
        assert_eq!(database.count("daily_plans").unwrap(), 1, "only the completed historical task has a plan");
        assert_eq!(database.count("plan_blocks").unwrap(), 1, "stale preview must not add its blocks");
        assert_eq!(fact_fingerprint(&database.connection, "task_completion", &first).unwrap(), before);
        assert_eq!(fact_fingerprint(&database.connection, "task_completion", &second).unwrap(), untouched);
        assert_eq!(database.task_status(&second).unwrap(), "open");
    }

    #[test]
    fn cross_day_task_reserves_workload_without_duplicate_allocation() {
        let mut database = Database::in_memory().unwrap();
        database.save_availability_settings(AvailabilitySettings {
            makeup_workdays_as_workdays: true,
            weekdays: vec![5, 6], workday_start: "09:00".into(), workday_end: "12:00".into(),
            lunch_start: None, lunch_end: None, lunch_reason: "午休".into(), buffer_minutes: 0,
        }).unwrap();
        let task_id = database.create_manual_task("跨两天整理完整项目资料").unwrap();
        let creation_clock = TestNow::new("2026-08-28T00:00:00+08:00");
        let updated = database.update_manual_task(&task_id, ManualTaskUpdate {
            title: "跨两天整理完整项目资料".into(), notes: None, priority: Some(Priority::High),
            earliest_start_at: Some("2026-08-28T09:00:00+08:00".into()),
            due_at: Some("2026-08-29T12:00:00+08:00".into()),
            estimated_minutes: Some(240),
        }).unwrap();
        drop(creation_clock);
        assert!(updated.splittable, "拆分已是系统排程能力，不再由任务开关决定");

        let first_preview = database.preview_rule_based_plan("2026-08-28").unwrap();
        assert_eq!(first_preview.blocks.len(), 1);
        assert_eq!(first_preview.blocks[0].estimated_minutes, 120, "跨日首日优先采用平均每日投入");
        database.confirm_rule_based_plan(first_preview).unwrap();
        assert_eq!(database.task_status(&task_id).unwrap(), "scheduled");
        assert_eq!(database.get_task(&task_id).unwrap().reserved_minutes, 120);

        let second_preview = database.preview_rule_based_plan("2026-08-29").unwrap();
        assert_eq!(second_preview.blocks.len(), 1);
        assert_eq!(second_preview.blocks[0].estimated_minutes, 120);
        database.confirm_rule_based_plan(second_preview).unwrap();
        assert_eq!(database.get_task(&task_id).unwrap().reserved_minutes, 240);

        let planned_minutes: i64 = database.connection.query_row(
            "SELECT SUM(CAST(ROUND((julianday(ends_at) - julianday(starts_at)) * 1440) AS INTEGER))
             FROM plan_blocks WHERE task_id = ?1",
            [&task_id],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(planned_minutes, 240, "跨日安排不得重复分配同一份工作量");
        assert_eq!(database.count("daily_plans").unwrap(), 2);
        let expected_dates = vec!["2026-08-28".to_string(), "2026-08-29".to_string()];
        assert_eq!(database.get_task(&task_id).unwrap().scheduled_dates, expected_dates);
        let listed = database.list_tasks(false, None).unwrap();
        assert_eq!(listed.iter().find(|task| task.id == task_id).unwrap().scheduled_dates, expected_dates);
    }

    #[test]
    fn confirmed_plan_adjustment_does_not_repeat_a_cross_day_task_in_unscheduled() {
        let mut database = Database::in_memory().unwrap();
        let task_id = database.create_manual_task("跨天任务不重复出现").unwrap();
        let creation_clock = TestNow::new("2026-09-09T00:00:00+08:00");
        database.update_manual_task(&task_id, ManualTaskUpdate {
            title: "跨天任务不重复出现".into(), notes: None, priority: Some(Priority::High),
            earliest_start_at: Some("2026-09-09T09:00:00+08:00".into()),
            due_at: Some("2026-09-10T18:00:00+08:00".into()),
            estimated_minutes: Some(240),
        }).unwrap();
        drop(creation_clock);

        let preview = database.preview_rule_based_plan("2026-09-09").unwrap();
        assert_eq!(preview.blocks[0].estimated_minutes, 120);
        database.confirm_rule_based_plan(preview).unwrap();

        let adjustment = database.start_confirmed_plan_adjustment("2026-09-09").unwrap();
        assert!(adjustment.blocks.iter().any(|block| block.task_id == task_id));
        assert!(adjustment.unscheduled.iter().all(|item| item.task_id != task_id),
            "已在时间线上的跨天任务不得再次出现在未排入区域");

        database.connection.execute(
            "UPDATE daily_plan_drafts SET unscheduled_json = ?2 WHERE id = ?1",
            params![adjustment.preview_id, serde_json::to_string(&vec![UnscheduledTask {
                task_id: task_id.clone(),
                task_title: "跨天任务不重复出现".into(),
                reason: "尚未排入当前计划".into(),
                estimated_minutes: Some(120),
            }]).unwrap()],
        ).unwrap();
        let restored = database.get_rule_plan_draft("2026-09-09").unwrap().unwrap();
        assert!(restored.unscheduled.is_empty(), "旧版本留下的重复草案也应在读取时修正");
    }

    #[test]
    fn confirmed_plan_adjustment_uses_fresh_daily_minutes_for_a_cross_day_candidate() {
        let mut database = Database::in_memory().unwrap();
        let baseline_id = database.create_manual_task("第二天已有安排").unwrap();
        database.update_manual_task(&baseline_id, ManualTaskUpdate {
            title: "第二天已有安排".into(), notes: None, priority: Some(Priority::High),
            earliest_start_at: Some("2026-09-10T09:00:00+08:00".into()),
            due_at: Some("2026-09-10T10:00:00+08:00".into()),
            estimated_minutes: Some(60),
        }).unwrap();
        let second_day = database.preview_rule_based_plan("2026-09-10").unwrap();
        database.confirm_rule_based_plan(second_day).unwrap();

        let cross_day_id = database.create_manual_task("跨天任务刷新剩余时间").unwrap();
        let creation_clock = TestNow::new("2026-09-09T00:00:00+08:00");
        database.update_manual_task(&cross_day_id, ManualTaskUpdate {
            title: "跨天任务刷新剩余时间".into(), notes: None, priority: Some(Priority::High),
            earliest_start_at: Some("2026-09-09T09:00:00+08:00".into()),
            due_at: Some("2026-09-10T18:00:00+08:00".into()),
            estimated_minutes: Some(240),
        }).unwrap();
        drop(creation_clock);
        let first_day = database.preview_rule_based_plan("2026-09-09").unwrap();
        assert_eq!(first_day.blocks.iter()
            .find(|block| block.task_id == cross_day_id)
            .unwrap().estimated_minutes, 120);
        database.confirm_rule_based_plan(first_day).unwrap();
        let mut first_day_adjustment = database.start_confirmed_plan_adjustment("2026-09-09").unwrap();
        let adjusted_block = first_day_adjustment.blocks.iter_mut()
            .find(|block| block.task_id == cross_day_id)
            .unwrap();
        adjusted_block.ends_at = "2026-09-09T12:45:00+08:00".into();
        adjusted_block.estimated_minutes = 225;
        let first_day_adjustment = database.update_rule_plan_draft(
            &first_day_adjustment.preview_id,
            first_day_adjustment.version,
            first_day_adjustment.blocks,
            first_day_adjustment.unscheduled,
        ).unwrap();
        database.confirm_rule_based_plan(first_day_adjustment).unwrap();

        let second_day_adjustment = database.start_confirmed_plan_adjustment("2026-09-10").unwrap();
        let candidate = second_day_adjustment.unscheduled.iter()
            .find(|item| item.task_id == cross_day_id)
            .unwrap();
        assert_eq!(candidate.estimated_minutes, Some(15),
            "第二天展示和加入时间线都应采用调整后的实时剩余时长");
    }

    #[test]
    fn cross_day_task_accepts_total_workload_over_one_day_and_plans_the_daily_average() {
        let mut database = Database::in_memory().unwrap();
        let task_id = database.create_manual_task("跨三天准备发布").unwrap();
        let creation_clock = TestNow::new("2026-09-09T00:00:00+08:00");
        let updated = database.update_manual_task(&task_id, ManualTaskUpdate {
            title: "跨三天准备发布".into(), notes: None, priority: Some(Priority::High),
            earliest_start_at: Some("2026-09-09T09:00:00+08:00".into()),
            due_at: Some("2026-09-11T18:00:00+08:00".into()),
            estimated_minutes: Some(1800),
        }).unwrap();
        drop(creation_clock);
        assert_eq!(updated.total_workload_minutes, Some(1800));

        let preview = database.preview_rule_based_plan("2026-09-09").unwrap();
        assert_eq!(preview.blocks.len(), 1);
        assert_eq!(preview.blocks[0].estimated_minutes, 600);
    }

    #[test]
    fn overdue_task_is_excluded_from_another_day_plan() {
        let mut database = Database::in_memory().unwrap();
        database.save_availability_settings(AvailabilitySettings {
            makeup_workdays_as_workdays: true,
            weekdays: vec![1], workday_start: "09:00".into(), workday_end: "18:00".into(),
            lunch_start: Some("12:00".into()), lunch_end: Some("13:00".into()),
            lunch_reason: "午休".into(), buffer_minutes: 10,
        }).unwrap();
        let task_id = database.create_manual_task("已过截止时间的跨天任务").unwrap();
        let creation_clock = TestNow::new("2026-08-28T00:00:00+08:00");
        database.update_manual_task(&task_id, ManualTaskUpdate {
            title: "已过截止时间的跨天任务".into(), notes: None, priority: Some(Priority::High),
            earliest_start_at: Some("2026-08-28T11:00:00+08:00".into()),
            due_at: Some("2026-08-29T12:00:00+08:00".into()),
            estimated_minutes: Some(1000),
        }).unwrap();
        drop(creation_clock);

        let preview = database.preview_rule_based_plan("2026-08-31").unwrap();
        assert!(preview.blocks.is_empty());
        assert!(preview.unscheduled.is_empty());
    }

    #[test]
    fn all_scheduled_execution_blocks_completed_persist_review_and_complete_task() {
        let mut database = Database::in_memory().unwrap();
        let task_id = database.create_manual_task("推进长期方案").unwrap();
        database.update_manual_task(&task_id, ManualTaskUpdate {
            title: "推进长期方案".into(), notes: None, priority: Some(Priority::High),
            earliest_start_at: Some("2026-08-14T09:00:00+08:00".into()),
            due_at: Some("2026-08-14T12:00:00+08:00".into()), estimated_minutes: Some(120),
        }).unwrap();
        let preview = database.preview_rule_based_plan("2026-08-14").unwrap();
        let schedule = database.confirm_rule_based_plan(preview).unwrap();
        let block_id = schedule.task_blocks[0].id.clone();

        let _clock = TestToday::new("2026-08-14");
        let saved = database.save_review_entry("2026-08-14", ReviewEntryInput {
            plan_block_id: block_id.clone(), outcome: ReviewOutcome::Completed,
            actual_minutes: Some(45), defer_reason: None, notes: Some("完成了今天约定的范围".into()),
            remaining_workload_minutes: Some(75),
        }).unwrap();

        assert_eq!(saved.outcome, "completed");
        assert_eq!(database.count("review_entries").unwrap(), 1);
        let task = database.get_task(&task_id).unwrap();
        assert_eq!(task.status, "done", "全部已确认排期块完成后自动完成任务");
        assert_eq!(task.actual_minutes, 45);
        assert_eq!(task.remaining_workload_minutes, Some(0));
        let persisted = database.get_day_schedule("2026-08-14").unwrap();
        assert_eq!(persisted.task_blocks[0].execution_status, "completed");
        assert_eq!(persisted.task_blocks[0].actual_minutes, Some(45));
        assert_eq!(persisted.task_blocks[0].review.as_ref().unwrap().notes.as_deref(), Some("完成了今天约定的范围"));

        let duplicate = database.save_review_entry("2026-08-14", ReviewEntryInput {
            plan_block_id: block_id, outcome: ReviewOutcome::Partial, actual_minutes: Some(90),
            defer_reason: None, notes: None, remaining_workload_minutes: Some(30),
        });
        assert!(duplicate.is_err(), "已保存的历史事实不得被无痕覆盖");
        assert_eq!(database.get_task(&task_id).unwrap().actual_minutes, 45);
    }

    #[test]
    fn execution_capture_is_reviewable_and_does_not_guess_actual_minutes() {
        let mut database = Database::in_memory().unwrap();
        let task_id = database.create_manual_task("核对轻量执行记录").unwrap();
        database.update_manual_task(&task_id, ManualTaskUpdate {
            title: "核对轻量执行记录".into(), notes: None, priority: None,
            earliest_start_at: Some("2026-08-14T09:00:00+08:00".into()),
            due_at: Some("2026-08-14T12:00:00+08:00".into()), estimated_minutes: Some(120),
        }).unwrap();
        let preview = database.preview_rule_based_plan("2026-08-14").unwrap();
        let schedule = database.confirm_rule_based_plan(preview).unwrap();
        let block_id = schedule.task_blocks[0].id.clone();

        let _clock = TestToday::new("2026-08-14");
        database.save_execution_capture("2026-08-14", ExecutionCaptureInput {
            plan_block_id: block_id.clone(), outcome: Some(ReviewOutcome::Completed),
            note: Some("先记下一句".into()),
        }).unwrap();
        let captured = database.get_day_schedule("2026-08-14").unwrap();
        assert_eq!(captured.task_blocks[0].execution_status, "completed");
        assert_eq!(captured.task_blocks[0].actual_minutes, None, "日间勾选不得把计划时长伪装成实际耗时");
        assert_eq!(captured.task_blocks[0].execution_note.as_deref(), Some("先记下一句"));
        assert!(captured.task_blocks[0].review.is_none(), "轻量执行记录不得提前创建最终复盘事实");
        let task = database.get_task(&task_id).unwrap();
        assert_eq!(task.actual_minutes, 0);
        assert_eq!(task.remaining_workload_minutes, Some(0));

        database.clear_execution_capture("2026-08-14", &block_id).unwrap();
        let cleared = database.get_day_schedule("2026-08-14").unwrap();
        assert_eq!(cleared.task_blocks[0].execution_status, "planned");
        assert!(cleared.task_blocks[0].execution_note.is_none());
        assert!(cleared.task_blocks[0].execution_captured_at.is_none());
        assert!(!cleared.task_blocks[0].review_required);

        database.save_execution_capture("2026-08-14", ExecutionCaptureInput {
            plan_block_id: block_id.clone(), outcome: Some(ReviewOutcome::Partial),
            note: Some("复盘前修正为部分完成".into()),
        }).unwrap();
        let corrected = database.get_day_schedule("2026-08-14").unwrap();
        assert_eq!(corrected.task_blocks[0].execution_status, "partial");

        database.save_review_entry("2026-08-14", ReviewEntryInput {
            plan_block_id: block_id.clone(), outcome: ReviewOutcome::Partial,
            actual_minutes: Some(40), defer_reason: None, notes: Some("复盘后确认".into()),
            remaining_workload_minutes: Some(80),
        }).unwrap();
        assert!(database.clear_execution_capture("2026-08-14", &block_id).is_err(), "未完成的最终复盘仍不可清除");
        assert!(database.save_execution_capture("2026-08-14", ExecutionCaptureInput {
            plan_block_id: block_id.clone(), outcome: Some(ReviewOutcome::Completed), note: None,
        }).is_ok(), "窗口内只修正结果，保留独立复盘详情");
        let reviewed_task = database.get_task(&task_id).unwrap();
        assert_eq!(reviewed_task.actual_minutes, 40);
        assert_eq!(reviewed_task.remaining_workload_minutes, Some(0));
    }

    #[test]
    fn completing_whole_task_needs_neither_review_nor_extra_confirmation() {
        let mut database = Database::in_memory().unwrap();
        let task_id = database.create_manual_task("完成整项研究").unwrap();
        database.update_manual_task(&task_id, ManualTaskUpdate {
            title: "完成整项研究".into(), notes: None, priority: None,
            earliest_start_at: Some("2026-08-14T09:00:00+08:00".into()),
            due_at: Some("2026-08-14T12:00:00+08:00".into()), estimated_minutes: Some(60),
        }).unwrap();
        let preview = database.preview_rule_based_plan("2026-08-14").unwrap();
        let schedule = database.confirm_rule_based_plan(preview).unwrap();
        let _clock = TestToday::new("2026-08-14");
        let completed = database.complete_task_from_review(&task_id, "2026-08-14", false).unwrap();
        assert_eq!(completed.status, "done");
        assert_eq!(completed.remaining_workload_minutes, Some(0));
        assert_eq!(database.count("review_entries").unwrap(), 0);
        assert_eq!(database.count("plan_blocks").unwrap(), 1);
        assert_eq!(database.get_day_schedule("2026-08-14").unwrap().task_blocks[0].execution_status, "completed");
        let undo_id: String = database.connection.query_row("SELECT id FROM undo_entries WHERE target_type = 'task_completion' AND target_id = ?1 ORDER BY rowid DESC LIMIT 1", [&task_id], |row| row.get(0)).unwrap();
        database.apply_undo(&undo_id).unwrap();
        assert_eq!(database.get_task(&task_id).unwrap().remaining_workload_minutes, Some(60));
        assert_eq!(database.get_day_schedule("2026-08-14").unwrap().task_blocks[0].id, schedule.task_blocks[0].id);
        assert_eq!(database.get_day_schedule("2026-08-14").unwrap().task_blocks[0].execution_status, "planned");
    }

    #[test]
    fn recurring_item_creation_writes_one_rule_without_tasks_or_plan_blocks() {
        let mut database = Database::in_memory().unwrap();
        let today = shanghai_today();
        let item = database.create_recurring_item(recurring_item("晨间拉伸", &today)).unwrap();
        assert_eq!(item.title, "晨间拉伸");
        assert_eq!(item.display_time.as_deref(), Some("09:00"));
        assert_eq!(item.display_duration_minutes, Some(30));
        assert_eq!(database.count("recurring_items").unwrap(), 1);
        assert_eq!(database.count("recurring_occurrences").unwrap(), 0, "创建时不得预生成发生记录");
        assert_eq!(database.count("tasks").unwrap(), 0, "重复事项不得生成普通任务");
        assert_eq!(database.count("plan_blocks").unwrap(), 0, "展示时间不得占用日计划排程");

        let occurrences = database.list_recurring_occurrences(&today).unwrap();
        assert_eq!(occurrences.len(), 1, "到期日按需生成一条轻量发生记录");
        assert_eq!(occurrences[0].display_duration_minutes, Some(30));
        assert_eq!(database.count("tasks").unwrap(), 0);
        assert_eq!(database.count("plan_blocks").unwrap(), 0);
        let saved = database.save_recurring_occurrence_review(
            &occurrences[0].id,
            RecurringOccurrenceReviewInput { outcome: Some("partial".into()), notes: Some("完成了一半".into()) },
        ).unwrap();
        assert_eq!(saved.outcome.as_deref(), Some("partial"));
        assert_eq!(saved.review_notes.as_deref(), Some("完成了一半"));
    }

    #[test]
    fn weekday_recurring_interval_counts_legal_workdays() {
        let mut database = Database::in_memory().unwrap();
        let mut input = recurring_item("每三个工作日", "2026-09-28");
        input.frequency = "weekdays".into();
        input.interval_value = 3;
        let item = database.create_recurring_item(input).unwrap();
        for (date, expected) in [
            ("2026-09-28", true),
            ("2026-09-30", false),
            ("2026-10-01", false),
            ("2026-10-07", false),
            ("2026-10-08", true),
            ("2026-10-10", false),
            ("2026-10-12", true),
            ("2027-01-04", false),
        ] {
            assert_eq!(recurring_item_occurs_on(&database.get_holiday_calendar(), &item, parse_plan_date(date).unwrap()).unwrap(), expected, "{date}");
        }

        let holiday_start = parse_plan_date("2026-10-01").unwrap();
        let calendar = database.get_holiday_calendar();
        assert!(weekday_interval_matches(&calendar, holiday_start, parse_plan_date("2026-10-08").unwrap(), 2));
        assert!(!weekday_interval_matches(&calendar, holiday_start, parse_plan_date("2026-10-09").unwrap(), 2));
        assert!(weekday_interval_matches(&calendar, holiday_start, parse_plan_date("2026-10-10").unwrap(), 2));
        assert!(!weekday_interval_matches(&calendar, parse_plan_date("2025-12-31").unwrap(), parse_plan_date("2026-01-04").unwrap(), 1));
    }

    #[test]
    fn ended_recurring_item_recycle_bin_preserves_history_and_enforces_boundaries() {
        let mut database = Database::in_memory().unwrap();
        let today = shanghai_today();
        let item = database.create_recurring_item(recurring_item("晚间复盘", &today)).unwrap();
        let occurrence_id = database.list_recurring_occurrences(&today).unwrap()[0].id.clone();

        assert!(database.soft_delete_recurring_item(&item.id, true).is_err(), "生效中的重复事项不能直接删除");
        database.set_recurring_item_status(&item.id, "ended").unwrap();
        assert!(database.set_recurring_item_status(&item.id, "active").is_err(), "已结束重复事项不得重新激活");
        assert!(database.set_recurring_item_status(&item.id, "paused").is_err(), "已结束重复事项不得改为暂停");
        assert!(database.soft_delete_recurring_item(&item.id, false).is_err());
        database.soft_delete_recurring_item(&item.id, true).unwrap();

        assert!(database.list_recurring_items(true, false).unwrap().is_empty());
        let deleted = database.list_recurring_items(true, true).unwrap();
        assert_eq!(deleted.len(), 1);
        assert_eq!(deleted[0].status, "ended");
        assert!(deleted[0].deleted_at.is_some());
        assert!(database.update_recurring_item(&item.id, recurring_item("不可修改", &today)).is_err());
        assert!(database.set_recurring_item_status(&item.id, "active").is_err());
        assert_eq!(database.list_recurring_occurrences(&today).unwrap()[0].id, occurrence_id, "软删除必须保留发生记录");

        database.restore_recurring_item(&item.id).unwrap();
        let restored = database.list_recurring_items(true, false).unwrap();
        assert_eq!(restored.len(), 1);
        assert_eq!(restored[0].status, "ended", "恢复不应重新启用重复规则");
        assert!(restored[0].deleted_at.is_none());
        assert_eq!(database.list_recurring_occurrences(&today).unwrap().len(), 1);

        database.soft_delete_recurring_item(&item.id, true).unwrap();
        assert!(database.permanently_delete_recurring_item(&item.id, false).is_err());
        database.permanently_delete_recurring_item(&item.id, true).unwrap();
        assert_eq!(database.count("recurring_items").unwrap(), 0);
        assert_eq!(database.count("recurring_occurrences").unwrap(), 0, "永久删除时发生记录应级联清理");
    }

    #[test]
    fn paused_recurring_item_trash_ends_atomically_and_preserves_execution_history() {
        let mut database = Database::in_memory().unwrap();
        let today = shanghai_today();
        let item = database.create_recurring_item(recurring_item("暂停后收尾", &today)).unwrap();
        let occurrence = database.list_recurring_occurrences(&today).unwrap()[0].clone();
        let saved = database.save_recurring_occurrence_review(&occurrence.id, RecurringOccurrenceReviewInput {
            outcome: Some("completed".into()), notes: Some("已经执行的记录".into()),
        }).unwrap();
        database.set_recurring_item_status(&item.id, "paused").unwrap();
        let events_before = database.list_recurring_execution_history(&item.id).unwrap();
        let status_count: i64 = database.connection.query_row("SELECT COUNT(*) FROM recurring_status_versions WHERE recurring_item_id=?1", [&item.id], |r| r.get(0)).unwrap();
        assert!(database.soft_delete_recurring_item(&item.id, false).is_err());
        let unchanged = database.list_recurring_items(true, false).unwrap().remove(0);
        assert_eq!(unchanged.status, "paused");
        assert!(unchanged.deleted_at.is_none());
        // A failed lifecycle append must roll back the item update as well.
        database.connection.execute_batch("CREATE TRIGGER reject_test_end BEFORE INSERT ON recurring_status_versions WHEN NEW.status='ended' BEGIN SELECT RAISE(ABORT, 'test end failure'); END;").unwrap();
        assert!(database.soft_delete_recurring_item(&item.id, true).is_err());
        let unchanged = database.list_recurring_items(true, false).unwrap().remove(0);
        assert_eq!(unchanged.status, "paused");
        assert!(unchanged.deleted_at.is_none());
        database.connection.execute_batch("DROP TRIGGER reject_test_end").unwrap();
        database.soft_delete_recurring_item(&item.id, true).unwrap();
        let deleted = database.list_recurring_items(true, true).unwrap().remove(0);
        assert_eq!(deleted.status, "ended");
        assert!(deleted.deleted_at.is_some());
        assert!(database.soft_delete_recurring_item(&item.id, true).is_err());
        let events_after = database.list_recurring_execution_history(&item.id).unwrap();
        assert_eq!(&events_after[..events_before.len()], events_before.as_slice());
        assert_eq!(events_after.len(), events_before.len() + 2);
        assert_eq!(events_after[events_after.len() - 2].kind, "ended");
        assert_eq!(events_after.last().unwrap().kind, "soft_deleted");
        assert_eq!(load_occurrence(&database.connection, &occurrence.id).unwrap(), saved);
        database.restore_recurring_item(&item.id).unwrap();
        let restored = database.list_recurring_items(true, false).unwrap().remove(0);
        assert_eq!(restored.status, "ended");
        assert!(restored.deleted_at.is_none());
        let tomorrow = parse_plan_date(&today).unwrap().succ_opt().unwrap().to_string();
        assert!(database.list_recurring_occurrences(&tomorrow).unwrap().is_empty());
        database.soft_delete_recurring_item(&item.id, true).unwrap();
        let final_count: i64 = database.connection.query_row("SELECT COUNT(*) FROM recurring_status_versions WHERE recurring_item_id=?1", [&item.id], |r| r.get(0)).unwrap();
        assert_eq!(final_count, status_count + 1, "recycling an ended item must not duplicate its end event");
    }

    #[test]
    fn recurring_item_timeline_window_requires_a_valid_non_crossing_duration() {
        let mut database = Database::in_memory().unwrap();
        let today = shanghai_today();

        let mut missing_duration = recurring_item("缺少时长", &today);
        missing_duration.display_duration_minutes = None;
        assert!(database.create_recurring_item(missing_duration).is_err());

        let mut missing_time = recurring_item("缺少时间", &today);
        missing_time.display_time = None;
        assert!(database.create_recurring_item(missing_time).is_err());

        let mut crosses_midnight = recurring_item("跨日展示", &today);
        crosses_midnight.display_time = Some("23:45".into());
        crosses_midnight.display_duration_minutes = Some(30);
        assert!(database.create_recurring_item(crosses_midnight).is_err());

        let mut valid = recurring_item("非阻塞展示", &today);
        valid.display_time = Some("14:00".into());
        valid.display_duration_minutes = Some(45);
        let item = database.create_recurring_item(valid).unwrap();
        assert_eq!(item.display_duration_minutes, Some(45));
        assert_eq!(database.count("plan_blocks").unwrap(), 0, "重复事项展示窗口不得占用排程");
    }

    #[test]
    fn ordinary_task_draft_rejects_legacy_recurrence_batch_creation() {
        let mut database = Database::in_memory().unwrap();
        let mut input = manual_draft("每周整理项目周报", Some("2026-09-01"));
        input.earliest_start_date = Some("2026-09-01".into());
        input.tags = vec!["项目".into(), "周报".into(), "项目".into()];
        input.recurrence = Some(RecurrenceInput {
            frequency: "weekly".into(), interval_value: 1, weekdays: vec![2],
            month_day: None, starts_on: "2026-09-01".into(), ends_on: Some("2026-09-15".into()),
        });
        let draft = database.create_manual_task_draft(input).unwrap();
        assert!(database.confirm_task_draft(&draft.id, &draft.confirmation_token).is_err());
        assert_eq!(database.count("tasks").unwrap(), 0);
        assert_eq!(database.count("recurrence_instances").unwrap(), 0);
    }

    #[test]
    fn recycle_bin_cleanup_removes_only_items_older_than_thirty_days() {
        let mut database = Database::in_memory().unwrap();
        let old = database.create_manual_task("旧回收任务").unwrap();
        let fresh = database.create_manual_task("新回收任务").unwrap();
        database.connection.execute(
            "UPDATE tasks SET status = 'deleted', deleted_at = ?2 WHERE id = ?1",
            params![old, (Utc::now() - Duration::days(31)).to_rfc3339()],
        ).unwrap();
        database.connection.execute(
            "UPDATE tasks SET status = 'deleted', deleted_at = ?2 WHERE id = ?1",
            params![fresh, (Utc::now() - Duration::days(1)).to_rfc3339()],
        ).unwrap();
        let old_recurring = database.create_recurring_item(recurring_item("旧回收重复事项", &shanghai_today())).unwrap();
        let fresh_recurring = database.create_recurring_item(recurring_item("新回收重复事项", &shanghai_today())).unwrap();
        for item in [&old_recurring, &fresh_recurring] {
            database.set_recurring_item_status(&item.id, "ended").unwrap();
            database.soft_delete_recurring_item(&item.id, true).unwrap();
        }
        database.connection.execute(
            "UPDATE recurring_items SET deleted_at = ?2 WHERE id = ?1",
            params![old_recurring.id, (Utc::now() - Duration::days(31)).to_rfc3339()],
        ).unwrap();
        database.connection.execute(
            "UPDATE recurring_items SET deleted_at = ?2 WHERE id = ?1",
            params![fresh_recurring.id, (Utc::now() - Duration::days(1)).to_rfc3339()],
        ).unwrap();

        assert_eq!(purge_expired_deleted_items(&mut database).unwrap(), 2);
        assert!(database.get_task(&old).is_err());
        assert_eq!(database.get_task(&fresh).unwrap().status, "deleted");
        assert!(database.list_recurring_items(true, true).unwrap().iter().all(|item| item.id != old_recurring.id));
        assert!(database.list_recurring_items(true, true).unwrap().iter().any(|item| item.id == fresh_recurring.id));
    }

    #[test]
    fn short_undo_uses_new_transaction_and_refuses_later_conflicts() {
        let _clock = TestNow::new("2026-09-01T12:00:00+08:00");
        let mut database = Database::in_memory().unwrap();
        let draft = database.create_manual_task_draft(manual_draft("可撤销创建", Some("2026-09-01"))).unwrap();
        let task = database.confirm_task_draft(&draft.id, &draft.confirmation_token).unwrap();
        let undo = database.latest_undo().unwrap().unwrap();
        database.apply_undo(&undo.id).unwrap();
        assert_eq!(database.get_task(&task.id).unwrap().status, "deleted");
        assert_eq!(database.latest_undo().unwrap(), None);

        let task_id = database.create_manual_task("可撤销修改").unwrap();
        let before = database.get_task(&task_id).unwrap();
        database.update_manual_task(&task_id, ManualTaskUpdate {
            title: "第一次修改".into(), notes: None, priority: None,
            earliest_start_at: Some("2026-09-01T09:00:00+08:00".into()),
            due_at: Some("2026-09-01T10:00:00+08:00".into()), estimated_minutes: None,
        }).unwrap();
        let update_undo = database.latest_undo().unwrap().unwrap();
        database.connection.execute(
            "UPDATE tasks SET title = '后续修改', updated_at = ?2 WHERE id = ?1",
            params![task_id, now()],
        ).unwrap();
        assert!(database.apply_undo(&update_undo.id).is_err());
        assert_ne!(database.get_task(&task_id).unwrap().title, before.title);
    }

    #[test]
    fn ai_update_draft_changes_existing_task_preserves_source_and_is_atomic() {
        let mut database = Database::in_memory().unwrap();
        let task_id = database.create_manual_task("原任务标题").unwrap();
        let before = database.get_task(&task_id).unwrap();
        let conversation = database.create_ai_conversation(None).unwrap();
        let run = database.start_ai_run(&conversation.id, "把原任务修改为高优先级").unwrap();
        let mut input = manual_draft("更新后的任务标题", Some("2026-09-08"));
        input.notes = Some("由 AI 整理、等待确认".into());
        input.priority = Some(Priority::High);
        let (_, drafts) = database.complete_ai_run_with_drafts(
            &run.run.id,
            "已整理为一条修改草稿。",
            vec![AiDraftCreationInput { draft_kind: "update".into(), target_task_id: Some(task_id.clone()), input }],
            "{}",
        ).unwrap();
        assert_eq!(database.get_task(&task_id).unwrap().title, before.title, "确认前不能修改正式任务");
        let updated = database.confirm_task_draft(&drafts[0].id, &drafts[0].confirmation_token).unwrap();
        assert_eq!(updated.title, "更新后的任务标题");
        assert_eq!(updated.priority.as_deref(), Some("high"));
        assert_eq!(updated.source_type, before.source_type, "修改不得覆盖任务首次来源");

        let undo = database.latest_undo().unwrap().unwrap();
        database.apply_undo(&undo.id).unwrap();
        let restored = database.get_task(&task_id).unwrap();
        assert_eq!(restored.title, before.title);
        assert_eq!(restored.source_type, before.source_type);

        let invalid_run = database.start_ai_run(&conversation.id, "修改不存在的任务").unwrap();
        let invalid = database.complete_ai_run_with_drafts(
            &invalid_run.run.id,
            "已整理修改。",
            vec![AiDraftCreationInput {
                draft_kind: "update".into(), target_task_id: Some("missing-task".into()),
                input: manual_draft("不应写入", Some("2026-09-09")),
            }],
            "{}",
        );
        assert!(invalid.is_err(), "无效目标应在草案写入事务中被外键拒绝");
        assert_eq!(database.get_task(&task_id).unwrap().title, before.title, "无效目标不得部分更新其他任务");
    }

    #[test]
    fn confirmed_plan_can_be_undone_and_later_execution_blocks_unsafe_undo() {
        let mut database = Database::in_memory().unwrap();
        let task_id = database.create_manual_task("可撤销排程").unwrap();
        database.update_manual_task(&task_id, ManualTaskUpdate {
            title: "可撤销排程".into(), notes: None, priority: Some(Priority::High),
            earliest_start_at: Some("2026-09-01T09:00:00+08:00".into()),
            due_at: Some("2026-09-01T12:00:00+08:00".into()), estimated_minutes: Some(60),
        }).unwrap();
        let preview = database.preview_rule_based_plan("2026-09-01").unwrap();
        let schedule = database.confirm_rule_based_plan(preview).unwrap();
        let undo = database.latest_undo().unwrap().unwrap();
        assert_eq!(undo.action_kind, "plan_created");
        database.apply_undo(&undo.id).unwrap();
        assert!(database.get_day_schedule("2026-09-01").unwrap().plan_id.is_none());
        assert_eq!(database.get_task(&task_id).unwrap().status, "open");

        let next = database.preview_rule_based_plan("2026-09-01").unwrap();
        let confirmed = database.confirm_rule_based_plan(next).unwrap();
        let unsafe_undo = database.latest_undo().unwrap().unwrap();
        let _clock = TestToday::new("2026-09-01");
        database.save_execution_capture("2026-09-01", ExecutionCaptureInput {
            plan_block_id: confirmed.task_blocks[0].id.clone(), outcome: Some(ReviewOutcome::Completed), note: None,
        }).unwrap();
        assert!(database.apply_undo(&unsafe_undo.id).is_err(), "已有执行事实后必须拒绝撤销计划");
        assert_eq!(database.get_day_schedule("2026-09-01").unwrap().plan_id, confirmed.plan_id);
        assert_eq!(schedule.task_blocks.len(), 1);
    }

    #[test]
    fn adjusted_plan_undo_restores_previous_blocks() {
        let mut database = Database::in_memory().unwrap();
        let task_id = database.create_manual_task("调整后可撤销").unwrap();
        database.update_manual_task(&task_id, ManualTaskUpdate {
            title: "调整后可撤销".into(), notes: None, priority: Some(Priority::High),
            earliest_start_at: Some("2026-09-01T09:00:00+08:00".into()),
            due_at: Some("2026-09-01T12:00:00+08:00".into()), estimated_minutes: Some(60),
        }).unwrap();
        let original_preview = database.preview_rule_based_plan("2026-09-01").unwrap();
        let original = database.confirm_rule_based_plan(original_preview).unwrap();
        let original_start = original.task_blocks[0].starts_at.clone();
        let adjustment = database.start_confirmed_plan_adjustment("2026-09-01").unwrap();
        let mut blocks = adjustment.blocks.clone();
        blocks[0].starts_at = "2026-09-01T15:00:00+08:00".into();
        blocks[0].ends_at = "2026-09-01T16:00:00+08:00".into();
        let edited = database.update_rule_plan_draft(
            &adjustment.preview_id, adjustment.version, blocks, adjustment.unscheduled.clone(),
        ).unwrap();
        let adjusted = database.confirm_rule_based_plan(edited).unwrap();
        assert_eq!(adjusted.task_blocks[0].starts_at, "2026-09-01T15:00:00+08:00");
        let undo = database.latest_undo().unwrap().unwrap();
        assert_eq!(undo.action_kind, "plan_updated");
        database.apply_undo(&undo.id).unwrap();
        let restored = database.get_day_schedule("2026-09-01").unwrap();
        assert_eq!(restored.task_blocks[0].starts_at, original_start);
        assert_eq!(restored.plan_id, original.plan_id);
    }

    #[test]
    fn formal_task_tags_are_searchable_without_creating_recurrence_instances() {
        let mut database = Database::in_memory().unwrap();
        let mut initial = manual_draft("每周同步", Some("2026-09-01"));
        initial.earliest_start_date = Some("2026-09-01".into());
        initial.tags = vec!["项目甲".into()];
        let draft = database.create_manual_task_draft(initial).unwrap();
        database.confirm_task_draft(&draft.id, &draft.confirmation_token).unwrap();
        assert_eq!(database.list_tasks(false, Some("项目甲")).unwrap().len(), 1, "标签必须参与正式任务搜索");
        assert_eq!(database.count("recurrence_instances").unwrap(), 0);
    }

    #[test]
    fn task_block_notifications_use_lead_window_and_block_level_deduplication() {
        let mut database = Database::in_memory().unwrap();
        let task_id = database.create_manual_task("九点开始的任务").unwrap();
        database.update_manual_task(&task_id, ManualTaskUpdate {
            title: "九点开始的任务".into(), notes: None, priority: None,
            earliest_start_at: Some("2026-09-01T09:00:00+08:00".into()),
            due_at: Some("2026-09-01T10:00:00+08:00".into()), estimated_minutes: Some(60),
        }).unwrap();
        let proposal = json!({ "proposal_id": "notification-plan", "operation": {
            "type": "proposed_plan", "plan_date": "2026-09-01", "blocks": [{
                "task_id": task_id, "starts_at": "2026-09-01T09:00:00+08:00",
                "ends_at": "2026-09-01T10:00:00+08:00", "source": "ai"
            }]
        }}).to_string();
        let preview = database.preview_ai_proposal(&proposal).unwrap();
        database.apply_confirmed_ai_proposal(&preview.ai_run_id, &preview.confirmation_token, false).unwrap();
        assert!(database.claim_due_task_block_notifications_at(5, "2026-09-01T08:54:59+08:00").unwrap().is_empty());
        let claimed = database.claim_due_task_block_notifications_at(5, "2026-09-01T08:55:00+08:00").unwrap();
        assert_eq!(claimed.len(), 1);
        assert_eq!(claimed[0].task_title, "九点开始的任务");
        assert!(database.claim_due_task_block_notifications_at(5, "2026-09-01T08:56:00+08:00").unwrap().is_empty());
        assert!(database.claim_due_task_block_notifications_at(0, "2026-09-01T08:55:00+08:00").unwrap().is_empty());
        let block_id = &claimed[0].block_id;
        database.connection.execute("UPDATE plan_blocks SET starts_at = ?1, ends_at = ?2 WHERE id = ?3", params!["2026-09-01T16:00:00+08:00", "2026-09-01T17:00:00+08:00", block_id]).unwrap();
        let moved = database.claim_due_task_block_notifications_at(3, "2026-09-01T15:57:00+08:00").unwrap();
        assert_eq!(moved.len(), 1);
        assert!(!moved[0].is_end);
        assert!(database.claim_due_task_block_notifications_at(3, "2026-09-01T15:58:00+08:00").unwrap().is_empty());
        let ending = database.claim_due_task_block_notifications_at(3, "2026-09-01T16:57:00+08:00").unwrap();
        assert_eq!(ending.len(), 1);
        assert!(ending[0].is_end);
        assert!(database.claim_due_task_block_notifications_at(3, "2026-09-01T16:58:00+08:00").unwrap().is_empty());
    }

}

#[cfg(test)]
#[path = "database_review_tests.rs"]
mod review_tests;

#[cfg(test)]
#[path = "database_tag_tests.rs"]
mod database_tag_tests;

#[cfg(test)]
#[path = "database_execution_tests.rs"]
mod execution_tests;

#[cfg(test)]
#[path = "database_followup_tests.rs"]
mod followup_tests;

#[cfg(test)]
#[path = "database_task_state_tests.rs"]
mod task_state_tests;

#[cfg(test)]
#[path = "database_results_tests.rs"]
mod results_tests;

#[cfg(test)]
#[path = "database_completion_tests.rs"]
mod completion_tests;

#[cfg(test)]
#[path = "database_historical_creation_tests.rs"]
mod historical_creation_tests;

#[cfg(test)]
#[path = "database_recurring_tests.rs"]
mod database_recurring_tests;

#[cfg(test)]
#[path = "database_cross_day_tests.rs"]
mod cross_day_tests;

#[cfg(test)]
#[path = "database_recurring_execution_tests.rs"]
mod recurring_execution_tests;

#[cfg(test)]
#[path = "database_recycled_execution_tests.rs"]
mod recycled_execution_tests;

#[cfg(test)]
#[path = "holiday_calendar_database_tests.rs"]
mod holiday_calendar_database_tests;
