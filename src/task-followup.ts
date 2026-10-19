import type { Task, TaskFollowup } from "./tauri";

export function followupActionLabel(followups: TaskFollowup[] | undefined) {
  return followups?.some((item) => item.status !== "deleted") ? "查看后续任务" : "创建后续任务";
}

export function canCreateTaskFollowup(task: Pick<Task, "status"> | undefined | null) {
  return Boolean(task && (task.status === "open" || task.status === "scheduled"));
}
