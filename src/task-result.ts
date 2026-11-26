import type { PlanBlock, Task, TaskMetadata, TaskExecutionResolutionInput } from "./tauri";
import { taskRangeDurationMinutes } from "./task-workload.ts";

export type ExecutionResult = "completed" | "not_completed";
export type ExecutionOutcome = "completed" | "not_started";
export const RESULT_GRACE_MS = 6 * 60 * 60 * 1000;

export type TaskListStatus = "scheduled" | "not_completed" | "done" | "deleted";

export function taskListStatus(task: Pick<Task, "status" | "is_incomplete">): TaskListStatus {
  const normalized: TaskListStatus = task.status === "open" ? "scheduled" : task.status;
  return normalized === "scheduled" && task.is_incomplete ? "not_completed" : normalized;
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

// Elapsed unfinished block facts remain writable, including historical backfill.
export function blockResultEditable(date: string | null | undefined, now = Date.now()) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = Date.parse(`${date}T00:00:00+08:00`);
  return Number.isFinite(parsed) && resultToday(parsed) === date && date <= resultToday(now);
}

export const HISTORY_COMPLETION_LOCKED_MESSAGE = "历史日期的已完成记录不可取消完成";
export const HISTORICAL_TASK_CREATION_NOTE = "创建历史任务自动完成";

export function isHistoricalResultDate(date: string | null | undefined, now = Date.now()) {
  return blockResultEditable(date, now) && date! < resultToday(now);
}

export function historicalBlockCompletionLocked(date: string, block: {
  execution_status: string; review?: { outcome?: string } | null;
}, now = Date.now()) {
  return isHistoricalResultDate(date, now) && (block.review?.outcome ?? block.execution_status) === "completed";
}

export function historicalTaskCompletionLocked(task: Pick<Task, "status" | "result_date">, now = Date.now()) {
  return task.status === "done" && isHistoricalResultDate(task.result_date, now);
}

export function historicalTaskCreationError(schedule: {
  earliest_start_date: string | null; earliest_start_time: string | null;
  due_date: string | null; due_time: string | null;
}, now = Date.now()) {
  if (schedule.earliest_start_date && schedule.due_date && schedule.earliest_start_date !== schedule.due_date
    && isHistoricalResultDate(schedule.earliest_start_date, now)) {
    return "不支持创建包含历史日期的多日任务；多日任务的开始日期不能早于今天，历史事项请分别补录为单日任务。";
  }
  if (!isHistoricalResultDate(schedule.due_date, now)) return null;
  if (!schedule.earliest_start_time && !schedule.due_time) {
    return schedule.earliest_start_date === schedule.due_date
      ? null
      : "历史日期只允许创建单日任务；当前内容仍可保存为草稿。";
  }
  const duration = taskRangeDurationMinutes({
    earliest_start_date: schedule.earliest_start_date ?? "", earliest_start_time: schedule.earliest_start_time ?? "",
    due_date: schedule.due_date ?? "", due_time: schedule.due_time ?? ""
  });
  return duration !== null && duration >= 15 ? null : "历史单日任务须填写完整且有效的开始和结束时间（至少 15 分钟）；当前内容仍可保存为草稿。";
}

export function taskResultEditable(task: Task | null | undefined, now = Date.now(), metadata?: TaskMetadata | null) {
  if (!task || task.status === "deleted" || task.deleted_at) return false;
  if (historicalTaskCompletionLocked(task, now)) return false;
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
  if (!block) return null;
  const recycled = block.task_status === "deleted";
  if (!task || task.id !== block.task_id || task.status !== block.task_status || (!recycled && task.deleted_at)) return null;
  const recordDate = block.result_date ?? date;
  if (!blockResultEditable(recordDate, now) || recordDate !== date) return null;
  if (recycled) return !block.review && block.execution_status === "planned" ? "complete-block" : null;
  if (!task || !["open", "scheduled", "done"].includes(task.status)) return null;
  const outcome = block.review?.outcome ?? block.execution_status;
  if (historicalBlockCompletionLocked(recordDate, block, now)) return null;
  if (outcome !== "planned" && outcome !== "completed") return block.review ? null : "clear";
  return outcome === "completed" ? "uncomplete-block" : "complete-block";
}


export function timelineTaskDialogState(block: Pick<PlanBlock, "task_status" | "execution_status" | "review">) {
  const outcome = block.review?.outcome ?? block.execution_status;
  if (block.task_status === "deleted") {
    return outcome === "completed"
      ? { status: "completed", label: "当天已完成", action: null } as const
      : { status: "deleted", label: "回收站任务", action: outcome === "planned" && !block.review ? "complete-block" : null } as const;
  }
  if (outcome === "completed") {
    return { status: "completed", label: "当天已完成", action: "uncomplete-block" } as const;
  }
  if (outcome !== "planned") return { status: "not_completed", label: "未完成", action: "new-task" } as const;
  return { status: "executing", label: "执行中", action: null } as const;
}

// Recycled tasks stay hidden from Day, Week, and Sidebar schedule views across
// all dates until restored from Trash; original blocks remain in SQLite.
export function visibleTaskScheduleBlocks(blocks: PlanBlock[], date: string, today: string) {
  return blocks.filter((block) => block.task_status !== "deleted"
    && !(date >= today && block.task_status === "done" && block.execution_status === "planned" && !block.review));
}

// Untimed ordinary tasks appear and count on selectedDate unless they already have
// scheduled blocks on that day or were completed on another result date.
export function visibleUntimedTasksForDate(
  tasks: Task[],
  taskBlocks: Pick<PlanBlock, "task_id">[],
  date: string
): Task[] {
  const scheduledTaskIds = new Set(taskBlocks.map((block) => block.task_id));
  return tasks.filter((task) => {
    if (task.deleted_at || task.status === "deleted") return false;
    if (task.earliest_start_at || task.due_at || task.earliest_start_time || task.due_time) return false;
    if (scheduledTaskIds.has(task.id)) return false;
    const startDate = task.earliest_start_date ?? task.due_date;
    const endDate = task.due_date ?? task.earliest_start_date;
    if (!startDate || !endDate) return false;
    if (task.status === "done") {
      return task.result_date ? task.result_date === date : (startDate <= date && date <= endDate);
    }
    return startDate <= date && date <= endDate;
  });
}

export function formatSidebarSummaryDuration(minutes: number): string {
  if (minutes <= 0) return "无固定时段";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours > 0 && remainder > 0) return `${hours} 小时 ${remainder} 分`;
  if (hours > 0) return `${hours} 小时`;
  return `${minutes} 分钟`;
}
