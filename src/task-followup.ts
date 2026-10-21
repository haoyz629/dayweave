import type { Task, TaskDraftInput } from "./tauri";

export function independentTaskDraft(task: Pick<Task, "title" | "priority" | "tags">, today: string): TaskDraftInput {
  const date = new Date(`${today}T12:00:00+08:00`);
  if (!Number.isFinite(date.getTime())) throw new Error("日期无效，请重新打开后再试。");
  const tomorrow = new Date(date.getTime() + 86400000).toISOString().slice(0, 10);
  return {
    item_type: "task", recurring_settings: null, title: task.title, notes: null,
    priority: task.priority, tags: [...task.tags], earliest_start_date: tomorrow, earliest_start_time: "09:00",
    due_date: tomorrow, due_time: "10:00", total_workload_minutes: 60, remaining_workload_minutes: 60,
    field_states_json: "{}", recurrence: null
  };
}
