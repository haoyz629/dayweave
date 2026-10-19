import type { Task } from "./tauri";

export type GanttMode = "week" | "month";
export type GanttStatusFilter = "all" | Exclude<Task["status"], "deleted">;
export type GanttDateRange = { start: string; end: string };
export type GanttWindow = GanttDateRange & { days: string[] };
export type GanttDateIssue = "missing_start" | "missing_end" | "invalid_start" | "invalid_end" | "reversed";
export type GanttTaskDates = Pick<Task, "earliest_start_date" | "due_date" | "earliest_start_at" | "due_at">;
export type GanttPlacement = GanttDateRange & {
  startIndex: number;
  span: number;
  clippedStart: boolean;
  clippedEnd: boolean;
};

const DAY_MS = 86_400_000;
const MIN_DATE = "0001-01-01";
const MAX_DATE = "9999-12-31";

/** Strict Gregorian YYYY-MM-DD validation, without Date's rollover or year-0..99 shortcut. */
export function calendarDay(value: string | null | undefined): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.getTime() / DAY_MS;
}

function requireDay(value: string): number {
  const day = calendarDay(value);
  if (day === null) throw new RangeError(`Invalid calendar date: ${value}`);
  return day;
}

function dateFromDay(day: number): string {
  if (!Number.isSafeInteger(day) || day < requireDay(MIN_DATE) || day > requireDay(MAX_DATE)) {
    throw new RangeError("Calendar date is outside 0001–9999");
  }
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function addCalendarDays(value: string, days: number): string {
  if (!Number.isSafeInteger(days)) throw new RangeError("Day offset must be an integer");
  return dateFromDay(requireDay(value) + days);
}

/** Sunday = 0, Monday = 1. All arithmetic is UTC, never host-time-zone dependent. */
export function calendarWeekday(value: string): number {
  return ((requireDay(value) + 4) % 7 + 7) % 7;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function ganttWindow(anchor: string, mode: GanttMode): GanttWindow {
  const day = requireDay(anchor);
  let start: string;
  let end: string;
  if (mode === "week") {
    const first = Math.max(requireDay(MIN_DATE), day - (calendarWeekday(anchor) + 6) % 7);
    start = dateFromDay(first);
    end = dateFromDay(Math.min(requireDay(MAX_DATE), first + 6));
  } else {
    const [year, month] = anchor.split("-").map(Number);
    start = `${anchor.slice(0, 7)}-01`;
    end = `${anchor.slice(0, 7)}-${daysInMonth(year, month)}`;
  }
  const length = requireDay(end) - requireDay(start) + 1;
  return { start, end, days: Array.from({ length }, (_, index) => addCalendarDays(start, index)) };
}

/** Clamp month-end navigation (Jan 31 → Feb 28/29), and the supported year boundaries. */
export function shiftGanttAnchor(anchor: string, mode: GanttMode, direction: -1 | 1): string {
  const day = requireDay(anchor);
  if (mode === "week") {
    return dateFromDay(Math.max(requireDay(MIN_DATE), Math.min(requireDay(MAX_DATE), day + direction * 7)));
  }
  const [year, month, date] = anchor.split("-").map(Number);
  const monthIndex = Math.max(12, Math.min(9999 * 12 + 11, year * 12 + month - 1 + direction));
  const nextYear = Math.floor(monthIndex / 12);
  const nextMonth = monthIndex % 12 + 1;
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-${String(Math.min(date, daysInMonth(nextYear, nextMonth))).padStart(2, "0")}`;
}

function taskDate(date: string | null, legacy: string | null): { date: string | null; invalid: boolean } {
  // The split calendar field is authoritative, even if invalid. Never silently replace bad data.
  if (date != null) return { date: calendarDay(date) === null ? null : date, invalid: calendarDay(date) === null };
  if (legacy == null || legacy === "") return { date: null, invalid: false };
  // Preserve the written calendar day of legacy timestamps, not their UTC-converted instant.
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T ](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?$/.exec(legacy);
  const candidate = match?.[1];
  return { date: candidate && calendarDay(candidate) !== null ? candidate : null, invalid: !candidate || calendarDay(candidate) === null };
}

/** Inclusive day range. Optional times do not change day-width bars; execution dates are never read. */
export function ganttTaskRange(task: GanttTaskDates): { range: GanttDateRange; issue: null } | { range: null; issue: GanttDateIssue } {
  const start = taskDate(task.earliest_start_date, task.earliest_start_at);
  const end = taskDate(task.due_date, task.due_at);
  if (!start.date) return { range: null, issue: start.invalid ? "invalid_start" : "missing_start" };
  if (!end.date) return { range: null, issue: end.invalid ? "invalid_end" : "missing_end" };
  if (start.date > end.date) return { range: null, issue: "reversed" };
  return { range: { start: start.date, end: end.date }, issue: null };
}

/** Inclusive overlap: a one-day task occupies one complete column, including on either edge. */
export function clipGanttRange(range: GanttDateRange, window: GanttDateRange): GanttPlacement | null {
  const values = [range.start, range.end, window.start, window.end].map(calendarDay);
  if (values.some((value) => value === null) || range.start > range.end || window.start > window.end) return null;
  const start = range.start > window.start ? range.start : window.start;
  const end = range.end < window.end ? range.end : window.end;
  if (start > end) return null;
  return {
    start, end,
    startIndex: requireDay(start) - requireDay(window.start),
    span: requireDay(end) - requireDay(start) + 1,
    clippedStart: range.start < window.start,
    clippedEnd: range.end > window.end,
  };
}

export function ganttTags(tasks: readonly Task[]): string[] {
  return [...new Set(tasks.filter((task) => task.status !== "deleted").flatMap((task) => task.tags).filter((tag) => tag.trim()))]
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
}

export function buildGanttRows(tasks: readonly Task[], window: GanttDateRange, filters: { tag?: string; status?: GanttStatusFilter } = {}) {
  const rows: { task: Task; range: GanttDateRange; placement: GanttPlacement }[] = [];
  const issues: { task: Task; reason: GanttDateIssue }[] = [];
  let matchingCount = 0;
  for (const task of tasks) {
    if (task.status === "deleted" || (filters.status && filters.status !== "all" && task.status !== filters.status)) continue;
    if (filters.tag && !task.tags.includes(filters.tag)) continue;
    matchingCount++;
    const result = ganttTaskRange(task);
    if (!result.range) {
      issues.push({ task, reason: result.issue });
      continue;
    }
    const placement = clipGanttRange(result.range, window);
    if (placement) rows.push({ task, range: result.range, placement });
  }
  rows.sort((a, b) => a.range.start.localeCompare(b.range.start) || a.range.end.localeCompare(b.range.end) || a.task.title.localeCompare(b.task.title, "zh-CN") || a.task.id.localeCompare(b.task.id));
  return { rows, issues, matchingCount };
}
