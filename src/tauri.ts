import { invoke } from "@tauri-apps/api/core";

const desktopRuntimeMessage = "请在今序桌面应用中打开；网页预览无法使用保存在这台电脑上的数据。";

export function setAppLogoMode(mode: "light" | "dark") {
  return invokeDesktop<void>("set_app_logo_mode", { mode });
}

export function setAppWindowTitle(title: string) {
  document.title = title;
  if (!("__TAURI_INTERNALS__" in window)) return Promise.resolve();
  return invokeDesktop<void>("set_app_window_title", { title });
}

function invokeDesktop<T>(command: string, args?: Record<string, unknown>) {
  if (!("__TAURI_INTERNALS__" in window)) return Promise.reject(desktopRuntimeMessage);
  return invoke<T>(command, args);
}

export type TaskStatus = "open" | "scheduled" | "done" | "deleted";
export type Priority = "low" | "medium" | "high";
export type ReviewOutcome = "completed" | "partial" | "not_started" | "cancelled" | "blocked";
export type RecurrenceFrequency = "daily" | "weekdays" | "weekly" | "monthly";
export type RecurrenceInput = {
  frequency: RecurrenceFrequency;
  interval_value: number;
  weekdays: number[];
  month_day: number | null;
  starts_on: string;
  ends_on: string | null;
};

export type RecurringItemStatus = "active" | "paused" | "ended";
export type RecurringItemInput = {
  title: string;
  notes: string | null;
  frequency: RecurrenceFrequency;
  interval_value: number;
  weekdays: number[];
  month_day: number | null;
  starts_on: string;
  ends_on: string | null;
  display_time: string | null;
  display_duration_minutes: number | null;
  tags: string[];
};

export type RecurringItem = RecurringItemInput & {
  id: string;
  source_type: "manual" | "ai_assistant";
  status: RecurringItemStatus;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type RecurringOccurrenceOutcome = "completed" | "partial" | "not_completed";
export type RecurringOccurrence = {
  id: string;
  recurring_item_id: string;
  title: string;
  notes: string | null;
  occurrence_date: string;
  display_time: string | null;
  display_duration_minutes: number | null;
  tags: string[];
  outcome: RecurringOccurrenceOutcome | null;
  review_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Task = {
  id: string;
  title: string;
  notes: string | null;
  priority: Priority | null;
  earliest_start_at: string | null;
  due_at: string | null;
  estimated_minutes: number | null;
  earliest_start_date: string | null;
  earliest_start_time: string | null;
  due_date: string | null;
  due_time: string | null;
  total_workload_minutes: number | null;
  remaining_workload_minutes: number | null;
  actual_minutes: number;
  source_type: "manual" | "ai_assistant";
  migration_review_required: boolean;
  splittable: boolean;
  status: TaskStatus;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  reserved_minutes: number;
  scheduled_dates: string[];
  tags: string[];
  execution_locked: boolean;
  result_date: string | null;
  result_ends_at: string | null;
  is_incomplete: boolean;
};

export type TaskDraftInput = {
  item_type?: "task" | "recurring";
  recurring_settings?: Omit<RecurringItemInput, "title" | "notes" | "tags"> | null;
  title: string;
  notes: string | null;
  priority: Priority | null;
  earliest_start_date: string | null;
  earliest_start_time: string | null;
  due_date: string | null;
  due_time: string | null;
  total_workload_minutes: number | null;
  remaining_workload_minutes: number | null;
  field_states_json: string;
  tags: string[];
  recurrence: RecurrenceInput | null;
};

export type TaskDraft = TaskDraftInput & {
  id: string;
  draft_kind: "create" | "update";
  target_task_id: string | null;
  source_type: "manual" | "ai_assistant";
  conversation_id: string | null;
  validation_status: "valid" | "needs_confirmation" | "invalid";
  version: number;
  confirmation_token: string;
  status: "active" | "confirmed" | "discarded";
  confirmed_task_id: string | null;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
};

export type TaskHistoryEvent = {
  id: string;
  occurred_at: string | null;
  plan_date: string | null;
  kind: "created" | "execution" | "status" | "automatic_status" | "restored" | "cleared" | "cleared_incomplete" | "reopened";
  status: TaskStatus | "not_completed" | null;
  note: string | null;
  review_note: string | null;
};

export type TaskMetadata = {
  task_id: string;
  tags: string[];
  recurrence: RecurrenceInput | null;
  latest_execution?: TaskExecutionFact | null;
  completion_date?: string | null;
  completion_ends_at?: string | null;
  completion_backfill_allowed?: boolean;
  completion_recorded_at?: string | null;
  history?: TaskHistoryEvent[];
};

export type TaskExecutionFact = { plan_block_id: string; plan_date: string; ends_at: string; outcome: ReviewOutcome; note: string | null };

export type UndoEntry = {
  id: string;
  action_kind: "task_created" | "task_updated" | string;
  target_type: string;
  target_id: string;
  expires_at: string;
  status: "available" | "applied" | "expired" | "conflicted";
};

export type ManualTaskUpdate = {
  title: string;
  notes: string | null;
  priority: Priority | null;
  earliest_start_at: string | null;
  due_at: string | null;
  estimated_minutes: number | null;
};

export type CalendarEvent = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  is_all_day: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ManualCalendarEventInput = {
  title: string;
  starts_at: string;
  ends_at: string;
  is_all_day: boolean;
};

export type AvailabilitySettings = {
    weekdays: number[];
    workday_start: string;
    workday_end: string;
    makeup_workdays_as_workdays: boolean;
};

export type RulePlanBlock = {
  task_id: string;
  task_title: string;
  starts_at: string;
  ends_at: string;
  estimated_minutes: number;
};

export type RuleUnscheduledTask = {
  task_id: string;
  task_title: string;
  reason: string;
  estimated_minutes: number | null;
};

export type RulePlanPreview = {
  preview_id: string;
  plan_date: string;
  base_plan_id: string | null;
  blocks: RulePlanBlock[];
  unscheduled: RuleUnscheduledTask[];
  generated_at: string;
  version: number;
  confirmation_token: string;
};

export type RulePlanDraftDiscardResult = {
  restored_task_count: number;
  conflicted_task_titles: string[];
};

export type PlanBlock = {
  id: string;
  daily_plan_id: string;
  task_id: string;
  task_title: string;
  task_status: TaskStatus;
  starts_at: string;
  ends_at: string;
  result_date?: string | null;
  result_ends_at?: string | null;
  source: "ai" | "rule_based" | "manual";
  execution_status: "planned" | ReviewOutcome;
  actual_minutes: number | null;
  review_required: boolean;
  execution_note: string | null;
  execution_captured_at: string | null;
  remaining_workload_minutes: number | null;
  review: ReviewEntry | null;
};

export type ExecutionCaptureInput = {
  plan_block_id: string;
  outcome: ReviewOutcome;
  note: string | null;
};

export type TaskExecutionResolutionInput = ExecutionCaptureInput & {
  expected_task_updated_at: string;
  next_action: "schedule" | "wait" | "stop" | null;
  starts_at: string | null;
  ends_at: string | null;
  remaining_workload_minutes: number | null;
};

export type ReviewEntryInput = {
  plan_block_id: string;
  outcome: ReviewOutcome;
  actual_minutes: number | null;
  defer_reason: string | null;
  notes: string | null;
  remaining_workload_minutes: number | null;
};

export type ReviewEntry = ReviewEntryInput & {
  id: string;
  review_date: string;
  task_id: string;
  created_at: string;
  updated_at: string;
  followup_action?: "schedule" | "wait" | "stop" | null;
};

export type ReviewFormDraft = {
  review_date: string;
  item_type: "task" | "recurring";
  item_id: string;
  payload_json: string;
  revision: number;
  updated_at: string;
};

export type DaySchedule = {
  plan_id: string | null;
  plan_status: string | null;
  plan_source: string | null;
  fixed_events: CalendarEvent[];
  task_blocks: PlanBlock[];
};

export type ProposalPreview = {
  ai_run_id: string;
  confirmation_token: string;
  proposal: { proposal_id: string; operation:
    | { type: "proposed_task_complete"; task_id: string }
    | { type: "proposed_task_soft_delete"; task_ids: string[]; precise_target_count: number }
    | { type: "proposed_plan"; plan_date: string; blocks: { task_id: string; starts_at: string; ends_at: string; source: "ai" }[] }
    | { type: "proposed_task_create"; title: string }
    | { type: "proposed_task_update"; task_id: string }
  };
};

export type AiApiType = "chat_completions" | "responses";
export type AiConnectionSettings = {
  api_type: AiApiType;
  endpoint: string;
  model: string;
  api_key_configured: boolean;
};
export type AiConnectionSettingsInput = {
  api_type: AiApiType;
  endpoint: string;
  model: string;
  api_key: string | null;
};
export type AiConversation = {
  id: string;
  title: string;
  status: "active" | "archived";
  message_count: number;
  draft_count: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};
export type AiMessage = {
  id: string;
  conversation_id: string;
  run_id: string | null;
  role: "user" | "assistant" | "system";
  content: string;
  stream_status: "complete" | "streaming" | "stopped" | "failed";
  created_at: string;
  updated_at: string;
};
export type AiRun = {
  id: string;
  conversation_id: string;
  run_status: "pending" | "streaming" | "completed" | "stopped" | "failed" | "expired";
  assistant_message: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  stopped_at: string | null;
};
export type AiAssistantResult = { run: AiRun; drafts: TaskDraft[]; proposal: ProposalPreview | null };

export function createManualTaskDraft(input: TaskDraftInput) {
  return invokeDesktop<TaskDraft>("create_manual_task_draft", { input });
}

export function importLegacyRecurringDraft(input: TaskDraftInput) {
  return invokeDesktop<TaskDraft>("import_legacy_recurring_draft", { input });
}

export function confirmCreationDraft(draft: TaskDraft) {
  return invokeDesktop<{ item_type: "task"; item: Task } | { item_type: "recurring"; item: RecurringItem }>("confirm_creation_draft", {
    draftId: draft.id, confirmationToken: draft.confirmation_token
  });
}

export function saveTaskDraft(draftId: string, expectedVersion: number, input: TaskDraftInput) {
  return invokeDesktop<TaskDraft>("save_task_draft", { draftId, expectedVersion, input });
}

export function listTaskDrafts(includeDiscarded = false) {
  return invokeDesktop<TaskDraft[]>("list_task_drafts", { includeDiscarded });
}

export function confirmTaskDraft(draft: TaskDraft) {
  return invokeDesktop<Task>("confirm_task_draft", {
    draftId: draft.id,
    confirmationToken: draft.confirmation_token
  });
}

export function discardTaskDraft(draft: TaskDraft) {
  return invokeDesktop<void>("discard_task_draft", {
    draftId: draft.id,
    expectedVersion: draft.version
  });
}

export function listTasks(includeDeleted = false, search?: string) {
  return invokeDesktop<Task[]>("list_tasks", { includeDeleted, search: search?.trim() || null });
}

export function createRecurringItem(input: RecurringItemInput) {
  return invokeDesktop<RecurringItem>("create_recurring_item", { input });
}

export function listRecurringItems(includeEnded = false, includeDeleted = false) {
  return invokeDesktop<RecurringItem[]>("list_recurring_items", { includeEnded, includeDeleted });
}

export function updateRecurringItem(itemId: string, input: RecurringItemInput) {
  return invokeDesktop<RecurringItem>("update_recurring_item", { itemId, input });
}

export function setRecurringItemStatus(itemId: string, status: RecurringItemStatus) {
  return invokeDesktop<RecurringItem>("set_recurring_item_status", { itemId, status });
}

export function softDeleteRecurringItem(itemId: string, confirmed: boolean) {
  return invokeDesktop<void>("soft_delete_recurring_item", { itemId, confirmed });
}

export function restoreRecurringItem(itemId: string) {
  return invokeDesktop<void>("restore_recurring_item", { itemId });
}

export function permanentlyDeleteRecurringItem(itemId: string, confirmed: boolean) {
  return invokeDesktop<void>("permanently_delete_recurring_item", { itemId, confirmed });
}

export function listRecurringOccurrences(occurrenceDate: string) {
  return invokeDesktop<RecurringOccurrence[]>("list_recurring_occurrences", { occurrenceDate });
}

export function saveRecurringOccurrenceReview(
  occurrenceId: string,
  input: { outcome: RecurringOccurrenceOutcome; notes: string | null }
) {
  return invokeDesktop<RecurringOccurrence>("save_recurring_occurrence_review", { occurrenceId, input });
}

export function getTask(taskId: string) {
  return invokeDesktop<Task>("get_task", { taskId });
}

export function getTaskMetadata(taskId: string) {
  return invokeDesktop<TaskMetadata>("get_task_metadata", { taskId });
}

export function setTaskTags(taskId: string, tags: string[]) {
  return invokeDesktop<TaskMetadata>("set_task_tags", { taskId, tags });
}

export function updateRecurringTask(taskId: string, input: TaskDraftInput, scope: "this" | "future") {
  return invokeDesktop<Task>("update_recurring_task", { taskId, input, scope });
}

export function listTags() {
  return invokeDesktop<string[]>("list_tags");
}

export type TaskTagDefinition = { name: string; color: number };

export function listTagCatalog() {
  return invokeDesktop<TaskTagDefinition[]>("list_tag_catalog");
}

export function createTag(name: string) {
  return invokeDesktop<TaskTagDefinition>("create_tag", { name });
}

export function latestUndo() {
  return invokeDesktop<UndoEntry | null>("latest_undo");
}

export function applyUndo(undoId: string) {
  return invokeDesktop<UndoEntry>("apply_undo", { undoId });
}

export function getUiSetting(key: string) {
  return invokeDesktop<string | null>("get_ui_setting", { key });
}

export function setUiSetting(key: string, value: string) {
  return invokeDesktop<void>("set_ui_setting", { key, value });
}

export function getAiConnectionSettings() {
  return invokeDesktop<AiConnectionSettings>("get_ai_connection_settings");
}

export function saveAiConnectionSettings(input: AiConnectionSettingsInput) {
  return invokeDesktop<AiConnectionSettings>("save_ai_connection_settings", { input });
}

export function testAiConnection() {
  return invokeDesktop<string>("test_ai_connection");
}

export function createAiConversation(title?: string) {
  return invokeDesktop<AiConversation>("create_ai_conversation", { title: title?.trim() || null });
}

export function listAiConversations(includeArchived = false, search?: string) {
  return invokeDesktop<AiConversation[]>("list_ai_conversations", {
    includeArchived,
    search: search?.trim() || null
  });
}

export function renameAiConversation(conversationId: string, title: string) {
  return invokeDesktop<AiConversation>("rename_ai_conversation", { conversationId, title });
}

export function setAiConversationArchived(conversationId: string, archived: boolean) {
  return invokeDesktop<AiConversation>("set_ai_conversation_archived", { conversationId, archived });
}

export function permanentlyDeleteAiConversation(conversationId: string, confirmed: boolean) {
  return invokeDesktop<void>("permanently_delete_ai_conversation", { conversationId, confirmed });
}

export function listAiMessages(conversationId: string, limit = 100) {
  return invokeDesktop<AiMessage[]>("list_ai_messages", { conversationId, limit });
}

export function listAiConversationProposals(conversationId: string) {
  return invokeDesktop<ProposalPreview[]>("list_ai_conversation_proposals", { conversationId });
}

export function runAiAssistant(conversationId: string, prompt: string) {
  return invokeDesktop<AiAssistantResult>("run_ai_assistant", { conversationId, prompt });
}

export function startAiAssistant(conversationId: string, prompt: string) {
  return invokeDesktop<AiRun>("start_ai_assistant", { conversationId, prompt });
}

export function completeAiAssistant(runId: string) {
  return invokeDesktop<AiAssistantResult>("complete_ai_assistant", { runId });
}

export function stopAiRun(runId: string) {
  return invokeDesktop<AiRun>("stop_ai_run", { runId });
}

export function getAutostartEnabled() {
  return invokeDesktop<boolean>("get_autostart_enabled");
}

export function setAutostartEnabled(enabled: boolean) {
  return invokeDesktop<boolean>("set_autostart_enabled", { enabled });
}

export function setGlobalShortcut(shortcut: string) {
  return invokeDesktop<string>("set_global_shortcut", { shortcut });
}

export function sendTestNotification() {
  return invokeDesktop<void>("send_test_notification");
}

export function updateManualTask(taskId: string, update: ManualTaskUpdate, tags?: string[]) {
  return invokeDesktop<Task>("update_manual_task", { taskId, update, tags });
}

export function transitionManualTask(taskId: string, targetStatus: TaskStatus) {
  return invokeDesktop<Task>("transition_manual_task", { taskId, targetStatus });
}

export function reopenManualTask(taskId: string, planDate: string) {
  return invokeDesktop<Task>("reopen_manual_task", { taskId, planDate });
}

export function softDeleteManualTask(taskId: string, confirmed: boolean) {
  return invokeDesktop<void>("soft_delete_manual_task", { taskId, confirmed });
}

export function restoreManualTask(taskId: string) {
  return invokeDesktop<void>("restore_manual_task", { taskId });
}

export function permanentlyDeleteManualTask(taskId: string, confirmed: boolean) {
  return invokeDesktop<void>("permanently_delete_manual_task", { taskId, confirmed });
}

export function createFixedEvent(input: ManualCalendarEventInput) {
  return invokeDesktop<CalendarEvent>("create_fixed_event", { input });
}

export function updateFixedEvent(eventId: string, input: ManualCalendarEventInput) {
  return invokeDesktop<CalendarEvent>("update_fixed_event", { eventId, input });
}

export function softDeleteFixedEvent(eventId: string, confirmed: boolean) {
  return invokeDesktop<void>("soft_delete_fixed_event", { eventId, confirmed });
}

export function listCalendarEvents(rangeStart: string, rangeEnd: string) {
  return invokeDesktop<CalendarEvent[]>("list_calendar_events", { rangeStart, rangeEnd });
}

export function getAvailabilitySettings() {
  return invokeDesktop<AvailabilitySettings>("get_availability_settings");
}

export function saveAvailabilitySettings(settings: AvailabilitySettings) {
  return invokeDesktop<AvailabilitySettings>("save_availability_settings", { settings });
}

export function previewRuleBasedPlan(planDate: string) {
  return invokeDesktop<RulePlanPreview>("preview_rule_based_plan", { planDate });
}

export function getRulePlanDraft(planDate: string) {
  return invokeDesktop<RulePlanPreview | null>("get_rule_plan_draft", { planDate });
}

export function startConfirmedPlanAdjustment(planDate: string) {
  return invokeDesktop<RulePlanPreview>("start_confirmed_plan_adjustment", { planDate });
}

export function startManualPlanDraft(planDate: string) {
  return invokeDesktop<RulePlanPreview>("start_manual_plan_draft", { planDate });
}

export function regenerateConfirmedPlanAdjustment(planDate: string) {
  return invokeDesktop<RulePlanPreview>("regenerate_confirmed_plan_adjustment", { planDate });
}

export function updateRulePlanDraft(preview: RulePlanPreview) {
  return invokeDesktop<RulePlanPreview>("update_rule_plan_draft", {
    previewId: preview.preview_id,
    expectedVersion: preview.version,
    blocks: preview.blocks,
    unscheduled: preview.unscheduled
  });
}

export function discardRulePlanDraft(previewId: string, expectedVersion: number) {
  return invokeDesktop<RulePlanDraftDiscardResult>("discard_rule_plan_draft", { previewId, expectedVersion });
}

export function confirmRuleBasedPlan(preview: RulePlanPreview) {
  return invokeDesktop<DaySchedule>("confirm_rule_based_plan", { preview });
}

export function updatePlanBlockTime(planDate: string, block: PlanBlock, startsAt: string, endsAt: string) {
  return invokeDesktop<DaySchedule>("update_plan_block_time", { input: {
    plan_date: planDate, block_id: block.id,
    expected_starts_at: block.starts_at, expected_ends_at: block.ends_at,
    starts_at: startsAt, ends_at: endsAt
  } });
}

export function getDaySchedule(planDate: string) {
  return invokeDesktop<DaySchedule>("get_day_schedule", { planDate });
}

export function includePlanTask(planDate: string, task: Task, blocks: RulePlanBlock[]) {
  return invokeDesktop<DaySchedule>("include_plan_task", { input: {
    plan_date: planDate, task_id: task.id, expected_updated_at: task.updated_at,
    expected_reserved_minutes: task.reserved_minutes, blocks
  } });
}

export function removePlanBlock(planDate: string, block: PlanBlock) {
  return invokeDesktop<DaySchedule>("remove_plan_block", { input: {
    plan_date: planDate, block_id: block.id,
    expected_starts_at: block.starts_at, expected_ends_at: block.ends_at
  } });
}

export function saveExecutionCapture(captureDate: string, input: ExecutionCaptureInput) {
  return invokeDesktop<void>("save_execution_capture", { captureDate, input });
}

export function resolveTaskExecution(captureDate: string, input: TaskExecutionResolutionInput) {
  return invokeDesktop<Task>("resolve_task_execution", { captureDate, input });
}

export function clearExecutionCapture(captureDate: string, planBlockId: string) {
  return invokeDesktop<void>("clear_execution_capture", { captureDate, planBlockId });
}

export function saveReviewEntry(reviewDate: string, input: ReviewEntryInput) {
  return invokeDesktop<ReviewEntry>("save_review_entry", { reviewDate, input });
}

export function listReviewFormDrafts(reviewDate: string): Promise<ReviewFormDraft[]> {
  return invokeDesktop<ReviewFormDraft[]>("list_review_form_drafts", { reviewDate });
}

export function saveReviewFormDraft(reviewDate: string, itemType: "task" | "recurring", itemId: string, payloadJson: string, expectedRevision: number): Promise<ReviewFormDraft> {
  return invokeDesktop<ReviewFormDraft>("save_review_form_draft", { reviewDate, itemType, itemId, payloadJson, expectedRevision });
}

export function deleteReviewFormDraft(reviewDate: string, itemType: "task" | "recurring", itemId: string): Promise<void> {
  return invokeDesktop<void>("delete_review_form_draft", { reviewDate, itemType, itemId });
}

export function completeTask(taskId: string, planBlockId: string | null = null, note: string | null = null): Promise<Task> {
  return invokeDesktop<Task>("complete_task", { taskId, planBlockId, note });
}

export function completeTaskFromReview(taskId: string, reviewDate: string, confirmed: boolean) {
  return invokeDesktop<Task>("complete_task_from_review", { taskId, reviewDate, confirmed });
}

export function previewAiProposal(rawJson: string) {
  return invokeDesktop<ProposalPreview>("preview_ai_proposal", { rawJson });
}

export function applyConfirmedAiProposal(
  preview: ProposalPreview,
  destructiveConfirmation = false
) {
  return invokeDesktop<{ affected_task_ids: string[]; plan_id: string | null }>(
    "apply_confirmed_ai_proposal",
    {
      aiRunId: preview.ai_run_id,
      confirmationToken: preview.confirmation_token,
      destructiveConfirmation
    }
  );
}
