import type { Task, TaskDraftInput } from "./tauri";

function sameDayClockMinutes(startDate: string | null, startTime: string | null, dueDate: string | null, dueTime: string | null) {
  if (!startDate || !dueDate || startDate !== dueDate || !startTime || !dueTime) return null;
  const startMatch = /^(\d{2}):(\d{2})$/.exec(startTime);
  const dueMatch = /^(\d{2}):(\d{2})$/.exec(dueTime);
  if (!startMatch || !dueMatch) return null;
  const startMin = Number(startMatch[1]) * 60 + Number(startMatch[2]);
  const dueMin = Number(dueMatch[1]) * 60 + Number(dueMatch[2]);
  return dueMin > startMin ? dueMin - startMin : null;
}

export type TaskDraftSeed = Pick<Task, "title" | "priority" | "tags"> & Partial<Pick<
  Task,
  | "earliest_start_date"
  | "earliest_start_time"
  | "due_date"
  | "due_time"
  | "earliest_start_at"
  | "due_at"
  | "total_workload_minutes"
  | "estimated_minutes"
>>;

export function independentTaskDraft(task: TaskDraftSeed, today: string): TaskDraftInput {
  const date = new Date(`${today}T12:00:00+08:00`);
  if (!Number.isFinite(date.getTime())) throw new Error("日期无效，请重新打开后再试。");
  const tomorrow = new Date(date.getTime() + 86400000).toISOString().slice(0, 10);
  const hasScheduleMetadata = "earliest_start_date" in task
    || "due_date" in task
    || "earliest_start_time" in task
    || "due_time" in task
    || "earliest_start_at" in task
    || "due_at" in task;
  if (!hasScheduleMetadata) {
    return {
      item_type: "task", recurring_settings: null, title: task.title, notes: null,
      priority: task.priority, tags: [...task.tags],
      earliest_start_date: tomorrow, earliest_start_time: "09:00",
      due_date: tomorrow, due_time: "10:00",
      total_workload_minutes: 60, remaining_workload_minutes: 60,
      field_states_json: "{}", recurrence: null
    };
  }
  const startDate = task.earliest_start_date ?? task.earliest_start_at?.slice(0, 10) ?? null;
  const dueDate = task.due_date ?? task.due_at?.slice(0, 10) ?? null;
  const startTime = task.earliest_start_time ?? (task.earliest_start_at && task.earliest_start_at.length >= 16 ? task.earliest_start_at.slice(11, 16) : null);
  const dueTime = task.due_time ?? (task.due_at && task.due_at.length >= 16 ? task.due_at.slice(11, 16) : null);
  const sameDayUntimed = Boolean(startDate && startDate === dueDate && !startTime && !dueTime);
  const undated = !startDate && !dueDate;
  const rangeMinutes = sameDayClockMinutes(startDate, startTime, dueDate, dueTime);
  const workload = undated || sameDayUntimed
    ? null
    : (rangeMinutes ?? task.total_workload_minutes ?? task.estimated_minutes ?? null);
  return {
    item_type: "task", recurring_settings: null, title: task.title, notes: null,
    priority: task.priority, tags: [...task.tags],
    earliest_start_date: startDate,
    earliest_start_time: startDate ? startTime : null,
    due_date: dueDate,
    due_time: dueDate ? dueTime : null,
    total_workload_minutes: workload,
    remaining_workload_minutes: workload,
    field_states_json: "{}", recurrence: null
  };
}
