import type { RecurringOccurrenceOutcome } from "./tauri";

export function recurringBlockDisplay(outcome: RecurringOccurrenceOutcome | null) {
  if (outcome === "completed") return { outcome: "completed", label: "本次已完成" } as const;
  if (outcome === "partial") return { outcome: "partial", label: "本次部分完成" } as const;
  if (outcome === "not_completed") return { outcome: "not_started", label: "本次未完成" } as const;
  return { outcome: "planned", label: "已安排" } as const;
}

export type TaskBlockType = "single" | "multi" | "recurring";

export const taskBlockTypeLabels = {
  single: { full: "单日任务", short: "单日" },
  multi: { full: "多日任务", short: "多日" },
  recurring: { full: "重复事项", short: "重复" }
} as const;

export function taskBlockType(task?: { earliest_start_date: string | null; due_date: string | null }): TaskBlockType | null {
  if (!task?.earliest_start_date || !task.due_date) return null;
  return task.earliest_start_date === task.due_date ? "single" : "multi";
}

export function compactBlockDuration(minutes: number) {
  if (!Number.isFinite(minutes) || minutes < 0) return "—";
  const value = Math.round(minutes);
  const hours = Math.floor(value / 60);
  const remainder = value % 60;
  return hours ? `${hours}h${remainder ? `${remainder}m` : ""}` : `${value}m`;
}
