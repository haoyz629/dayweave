import type { RecurringItemInput, RecurringOccurrence } from "./tauri";

export type RecurringEditScope = "this" | "future";
export type RecurringScheduleChange = {
  occurrence: RecurringOccurrence;
  input: RecurringItemInput;
  targetDate: string;
};

export function recurringTimeBlockIssue(input: Pick<RecurringItemInput, "display_time" | "display_duration_minutes">): string | null {
  const time = input.display_time ?? "";
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return "请选择重复任务块的开始时间。";
  const duration = input.display_duration_minutes;
  if (duration === null || !Number.isInteger(duration) || duration < 1 || duration > 1440) return "请设置 1 至 1440 分钟的时间块时长。";
  const [hours, minutes] = time.split(":").map(Number);
  if (hours * 60 + minutes + duration > 1440) return "任务块的结束时间不能超过当天 24:00。";
  return null;
}

export function recurringOccurrenceInput(item: RecurringItemInput, occurrence: RecurringOccurrence): RecurringItemInput {
  return {
    ...(occurrence.schedule_rule ?? item),
    title: occurrence.title,
    notes: occurrence.notes,
    tags: [...occurrence.tags],
    display_time: occurrence.display_time,
    display_duration_minutes: occurrence.display_duration_minutes
  };
}

export function recurringChangeIssue(change: RecurringScheduleChange, today: string): string | null {
  if (change.occurrence.occurrence_date < today || change.targetDate < today) return "历史任务块只读，不能修改或移入历史日期。";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(change.targetDate)
    || !Number.isFinite(Date.parse(`${change.targetDate}T00:00:00Z`))
    || new Date(`${change.targetDate}T00:00:00Z`).toISOString().slice(0, 10) !== change.targetDate) return "请选择有效的目标日期。";
  if (!change.input.title.trim()) return "重复事项标题不能为空。";
  return recurringTimeBlockIssue(change.input);
}

export function recurringTimeRange(input: Pick<RecurringItemInput, "display_time" | "display_duration_minutes">) {
  if (recurringTimeBlockIssue(input)) return "时间块未设置";
  const [hours, minutes] = input.display_time!.split(":").map(Number);
  const end = hours * 60 + minutes + input.display_duration_minutes!;
  return `${input.display_time}–${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
}
