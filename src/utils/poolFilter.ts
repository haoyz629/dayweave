import type { Task } from "../types/dayweave";

export type PoolFilter = "all" | "P1" | "short";

export const SHORT_TASK_MAX_MINUTES = 30;

export function filterPoolTasks(tasks: Task[], filter: PoolFilter, tagFilter: string): Task[] {
  return tasks
    .filter((t) => t.mode === "pool" && !t.done)
    .filter((t) => {
      if (filter === "P1" && t.priority !== "P1") return false;
      if (filter === "short" && t.duration > SHORT_TASK_MAX_MINUTES) return false;
      if (tagFilter !== "all" && t.tagId !== tagFilter) return false;
      return true;
    });
}
