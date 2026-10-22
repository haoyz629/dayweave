import type { PlanBlock, Task, TaskMetadata, TaskExecutionResolutionInput } from "./tauri";

export type ExecutionResult = "completed" | "not_completed";
export type ExecutionOutcome = "completed" | "not_started";
export const RESULT_GRACE_MS = 6 * 60 * 60 * 1000;

export type TaskListStatus = Task["status"] | "not_completed";

export function taskListStatus(task: Pick<Task, "status" | "is_incomplete">): TaskListStatus {
  return (task.status === "open" || task.status === "scheduled") && task.is_incomplete ? "not_completed" : task.status;
}

// Legacy final records remain readable; new submissions never create these actions.
export const taskNextActionLabels = { schedule: "继续安排", wait: "暂不安排", stop: "不再做" };

export function resultToday(now = Date.now()) {
  return new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function resultWindowOpen(date: string | null | undefined, endsAt: string | null | undefined, now = Date.now()) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = Date.parse(`${date}T00:00:00+08:00`);
  if (!Number.isFinite(parsed) || resultToday(parsed) !== date) return false;
  const today = resultToday(now);
  if (date === today) return true;
  if (date > today || !endsAt) return false;
  const end = Date.parse(endsAt);
  return Number.isFinite(end) && end <= now && now <= end + RESULT_GRACE_MS;
}

// Block facts may be corrected on any elapsed date; whole-task results keep their own window.
export function blockResultEditable(date: string | null | undefined, now = Date.now()) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = Date.parse(`${date}T00:00:00+08:00`);
  return Number.isFinite(parsed) && resultToday(parsed) === date && date <= resultToday(now);
}

export function taskResultEditable(task: Task | null | undefined, now = Date.now(), metadata?: TaskMetadata | null) {
  if (!task || task.status === "deleted" || task.deleted_at) return false;
  if (metadata?.task_id === task.id) {
    if (task.status !== "done" && metadata.completion_backfill_allowed) return true;
    if (task.status === "done" && metadata.completion_recorded_at) {
      const recorded = Date.parse(metadata.completion_recorded_at);
      return Number.isFinite(recorded) && recorded <= now && now <= recorded + RESULT_GRACE_MS;
    }
  }
  const today = resultToday(now);
  if (task.status !== "done" && task.earliest_start_date && task.due_date
    && task.earliest_start_date < task.due_date && task.earliest_start_date <= today) return true;
  if (task.status !== "done" && metadata?.completion_date) return resultWindowOpen(metadata.completion_date, metadata.completion_ends_at, now);
  if (task.result_date) return resultWindowOpen(task.result_date, task.result_ends_at, now);
  return task.status !== "done";
}

export function executionResultForOutcome(outcome: string | null): ExecutionResult | null {
  return outcome === null ? null : outcome === "completed" ? "completed" : "not_completed";
}

export function taskExecutionResolution(
  block: PlanBlock, task: Task | undefined, outcome: ExecutionOutcome, note: string
): TaskExecutionResolutionInput {
  if (!task || task.id !== block.task_id || !["open", "scheduled", "done"].includes(task.status) || task.deleted_at) {
    throw new Error("任务已变化，请重新打开后再试。");
  }
  return {
    plan_block_id: block.id, expected_task_updated_at: task.updated_at, outcome, note: note.trim() || null,
    next_action: null, starts_at: null, ends_at: null, remaining_workload_minutes: null
  };
}

export function timelineTaskCompletionAction(block: PlanBlock | null, task: Task | undefined, date: string, _today: string, now = Date.now()) {
  if (!block || !task || task.id !== block.task_id || task.status !== block.task_status || task.deleted_at) return null;
  const recordDate = block.result_date ?? date;
  if (!blockResultEditable(recordDate, now) || recordDate !== date) return null;
  if (!["open", "scheduled", "done"].includes(task.status)) return null;
  const outcome = block.review?.outcome ?? block.execution_status;
  if (outcome !== "planned" && outcome !== "completed") return block.review ? null : "clear";
  return outcome === "completed" ? "uncomplete-block" : "complete-block";
}

export function timelineTaskDialogState(block: Pick<PlanBlock, "task_status" | "execution_status" | "review">) {
  const outcome = block.review?.outcome ?? block.execution_status;
  if (block.task_status === "deleted") return { status: "deleted", label: "已删除", action: null } as const;
  if (outcome === "completed") {
    return { status: "completed", label: "当天已完成", action: "uncomplete-block" } as const;
  }
  if (outcome !== "planned") return { status: "not_completed", label: "未完成", action: "new-task" } as const;
  return { status: "executing", label: "执行中", action: null } as const;
}

// Ended tasks retain their facts, but unexecuted current/future blocks are no longer work to do.
export function visibleTaskScheduleBlocks(blocks: PlanBlock[], date: string, today: string) {
  return blocks.filter((block) => !(date >= today && block.task_status === "done" && block.execution_status === "planned" && !block.review));
}
