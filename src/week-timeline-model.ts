import type { DaySchedule, RecurringOccurrence, Task } from "./tauri";
import { visibleTaskScheduleBlocks } from "./task-result.ts";
import { timelineLaneLayout } from "./timeline-lane-layout.ts";
import { splitTaskNotes } from "./task-notes.ts";
import { recurringBlockDisplay } from "./task-block-display.ts";

export type WeekEntry = {
  layoutKey: string;
  date: string;
  title: string;
  status: string;
  tone: "plan" | "completed" | "partial" | "blocked" | "cancelled" | "not-started" | "fixed";
  startMinute: number | null;
  endMinute: number | null;
  time: string;
  url: string;
  notes: string | null;
  tags: string[];
};
export type TimedWeekEntry = WeekEntry & { startMinute: number; endMinute: number };
export const WEEK_HOUR_HEIGHT = 72;

export function shiftWeekDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function weekDatesFor(date: string) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
  return Array.from({ length: 7 }, (_, index) => shiftWeekDate(date, index + 1 - weekday));
}

export function weekHeading(first: string, last: string) {
  const label = (date: string, year: boolean) => `${year ? `${date.slice(0, 4)}年` : ""}${date.slice(5, 7)}月${date.slice(8)}日`;
  const thursday = new Date(`${first}T00:00:00Z`);
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const year = thursday.getUTCFullYear();
  return {
    range: `${label(first, true)}-${label(last, first.slice(0, 4) !== last.slice(0, 4))}`,
    year,
    week: Math.ceil(((thursday.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7)
  };
}

export function weekClock(minute: number) {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

export function weekDetailRange(entries: WeekEntry[]) {
  const timed = entries.filter((entry): entry is TimedWeekEntry => entry.startMinute !== null && entry.endMinute !== null);
  return timed.length ? `${weekClock(Math.min(...timed.map(entry => entry.startMinute)))}–${weekClock(Math.max(...timed.map(entry => entry.endMinute)))}` : null;
}

function clippedRange(date: string, start: string, end: string) {
  const midnight = Date.parse(`${date}T00:00:00+08:00`);
  const from = Math.max(0, Math.round((Date.parse(start) - midnight) / 60_000));
  const to = Math.min(1440, Math.round((Date.parse(end) - midnight) / 60_000));
  return Number.isFinite(from) && Number.isFinite(to) && to > from ? { startMinute: from, endMinute: to } : null;
}

export function weekEntries(date: string, schedule: DaySchedule, occurrences: RecurringOccurrence[], tasks: Task[], today: string): WeekEntry[] {
  const taskMap = new Map(tasks.map(task => [task.id, task]));
  const entries: WeekEntry[] = [];
  for (const block of visibleTaskScheduleBlocks(schedule.task_blocks, date, today)) {
    const range = clippedRange(date, block.starts_at, block.ends_at);
    if (!range) continue;
    const outcome = block.review?.outcome ?? block.execution_status;
    const task = taskMap.get(block.task_id);
    const { url, body } = splitTaskNotes(task?.notes ?? "");
    const status = { planned: "已安排", completed: "已完成", partial: "部分完成", blocked: "受阻", cancelled: "已取消", not_started: "未完成" }[outcome];
    entries.push({ layoutKey: `block:${block.id}`, date, title: block.task_title, status,
      tone: outcome === "planned" ? "plan" : outcome === "not_started" ? "not-started" : outcome,
      ...range, time: `${weekClock(range.startMinute)}–${weekClock(range.endMinute)}`,
      url, notes: [body, block.review?.notes ?? block.execution_note].filter(Boolean).join("\n\n") || null, tags: task?.tags ?? [] });
  }
  for (const item of occurrences.filter(item => item.occurrence_date === date)) {
    const start = item.display_time ? Number(item.display_time.slice(0, 2)) * 60 + Number(item.display_time.slice(3, 5)) : NaN;
    const end = Math.min(1440, start + (item.display_duration_minutes ?? 0));
    const timed = Number.isFinite(start) && start >= 0 && start < 1440 && end > start;
    const { url, body } = splitTaskNotes(item.notes ?? "");
    const display = recurringBlockDisplay(item.outcome);
    entries.push({ layoutKey: `recurring:${item.id}`, date, title: item.title, status: display.label,
      tone: display.outcome === "planned" ? "plan" : display.outcome === "not_started" ? "not-started" : display.outcome,
      startMinute: timed ? start : null, endMinute: timed ? end : null,
      time: timed ? `${weekClock(start)}–${weekClock(end)}` : "时间未指定", url, notes: [body, item.review_notes].filter(Boolean).join("\n\n") || null, tags: item.tags });
  }
  for (const event of schedule.fixed_events.filter(event => !event.deleted_at)) {
    const range = clippedRange(date, event.starts_at, event.ends_at);
    if (!range) continue;
    entries.push({ layoutKey: `event:${event.id}`, date, title: event.title, status: "固定日程", tone: "fixed",
      startMinute: event.is_all_day ? null : range.startMinute, endMinute: event.is_all_day ? null : range.endMinute,
      time: event.is_all_day ? "全天" : `${weekClock(range.startMinute)}–${weekClock(range.endMinute)}`, url: "", notes: null, tags: [] });
  }
  return entries.sort((a, b) => (a.startMinute ?? -1) - (b.startMinute ?? -1) || a.layoutKey.localeCompare(b.layoutKey));
}

export function weekGroups(entries: WeekEntry[]) {
  const timed = entries.filter((entry): entry is TimedWeekEntry => entry.startMinute !== null && entry.endMinute !== null)
    .sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute || a.layoutKey.localeCompare(b.layoutKey));
  const groups: { startMinute: number; endMinute: number; entries: TimedWeekEntry[] }[] = [];
  for (const entry of timed) {
    const group = groups[groups.length - 1];
    if (group && entry.startMinute < group.endMinute) {
      group.entries.push(entry);
      group.endMinute = Math.max(group.endMinute, entry.endMinute);
    } else groups.push({ startMinute: entry.startMinute, endMinute: entry.endMinute, entries: [entry] });
  }
  return groups.map(group => {
    const lanes = timelineLaneLayout(group.entries);
    const total = lanes[group.entries[0].layoutKey].total;
    const dense = total > 3;
    return { ...group, lanes, dense, columns: dense ? 3 : total,
      visible: group.entries.filter(entry => !dense || lanes[entry.layoutKey].column < 2),
      hidden: dense ? group.entries.filter(entry => lanes[entry.layoutKey].column >= 2).length : 0 };
  });
}

// One shared viewport: maximize occupied minutes across all seven days, not per-day scroll positions.
export function weekInitialMinute(dates: string[], today: string, nowMinute: number, entries: WeekEntry[], viewportMinutes: number) {
  if (dates.includes(today)) return nowMinute;
  const timed = entries.filter((entry): entry is TimedWeekEntry => entry.startMinute !== null && entry.endMinute !== null);
  if (!timed.length) return 720;
  const window = Math.max(1, Math.min(1440, viewportMinutes));
  const midpoint = timed.reduce((sum, entry) => sum + (entry.startMinute + entry.endMinute) / 2, 0) / timed.length;
  const clamp = (start: number) => Math.max(0, Math.min(1440 - window, start));
  const candidates = [clamp(midpoint - window / 2), 0, 1440 - window,
    ...timed.flatMap(entry => [entry.startMinute, entry.endMinute - window, (entry.startMinute + entry.endMinute - window) / 2].map(clamp))];
  let best = candidates[0], score = -1;
  for (const start of candidates) {
    const occupied = timed.reduce((sum, entry) => sum + Math.max(0, Math.min(entry.endMinute, start + window) - Math.max(entry.startMinute, start)), 0);
    if (occupied > score || occupied === score && Math.abs(start + window / 2 - midpoint) < Math.abs(best + window / 2 - midpoint)) {
      best = start; score = occupied;
    }
  }
  return best + window / 2;
}
