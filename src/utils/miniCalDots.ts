import type { RecurringOccurrence, Task } from "../types/dayweave";

export type MiniCalDotKind = "timeline" | "flex";

function isInDateRange(targetDate: string, startStr: string, endStr: string): boolean {
  const s = startStr || targetDate;
  const e = endStr || s;
  return targetDate >= s && targetDate <= e;
}

export function buildMiniCalDotMap(
  dates: string[],
  tasks: Task[],
  occurrences: RecurringOccurrence[],
): Map<string, MiniCalDotKind> {
  const timelineDates = new Set<string>();
  const flexTasks: Task[] = [];
  for (const t of tasks) {
    if (t.mode === "timeline") timelineDates.add(t.date);
    else if (t.mode === "flex") flexTasks.push(t);
  }

  const flexOccDates = new Set<string>();
  for (const o of occurrences) {
    if (o.skipped) continue;
    if (o.mode === "timeline") timelineDates.add(o.occurrenceDate);
    else if (o.mode === "flex") flexOccDates.add(o.occurrenceDate);
  }

  const map = new Map<string, MiniCalDotKind>();
  for (const date of dates) {
    if (timelineDates.has(date)) {
      map.set(date, "timeline");
    } else if (flexOccDates.has(date) || flexTasks.some((t) => isInDateRange(date, t.dateStart, t.dateEnd))) {
      map.set(date, "flex");
    }
  }
  return map;
}
