export const MIN_TASK_WORKLOAD_MINUTES = 15;
export const MAX_TASK_WORKLOAD_MINUTES = 525_600;

export type TaskWorkloadSchedule = {
  earliest_start_date: string;
  earliest_start_time: string;
  due_date: string;
  due_time: string;
  estimated_minutes: number | null;
};

function dateDayNumber(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.slice(0, 10));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return Math.floor(timestamp / 86_400_000);
}

function clockMinute(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export function taskDateSpanDays(schedule: Pick<TaskWorkloadSchedule, "earliest_start_date" | "due_date">) {
  const start = dateDayNumber(schedule.earliest_start_date);
  const end = dateDayNumber(schedule.due_date);
  if (start === null || end === null || end < start) return null;
  return end - start + 1;
}

export function taskRangeDurationMinutes(schedule: Pick<TaskWorkloadSchedule, "earliest_start_date" | "earliest_start_time" | "due_date" | "due_time">) {
  const days = taskDateSpanDays(schedule);
  const start = clockMinute(schedule.earliest_start_time);
  const end = clockMinute(schedule.due_time);
  if (days !== 1 || start === null || end === null || end <= start) return null;
  return end - start;
}

export function isCrossDayTask(schedule: Pick<TaskWorkloadSchedule, "earliest_start_date" | "due_date">) {
  return Boolean(schedule.earliest_start_date && schedule.due_date && schedule.earliest_start_date !== schedule.due_date);
}

export function isCrossDayTimedTask(schedule: Pick<TaskWorkloadSchedule, "earliest_start_date" | "earliest_start_time" | "due_date" | "due_time">) {
  return isCrossDayTask(schedule) && Boolean(schedule.earliest_start_time && schedule.due_time);
}

export function taskScheduleIsComplete(schedule: Pick<TaskWorkloadSchedule, "earliest_start_date" | "earliest_start_time" | "due_date" | "due_time">) {
  if (!schedule.earliest_start_date || !schedule.due_date) return false;
  return Boolean(schedule.earliest_start_time) === Boolean(schedule.due_time);
}

export function taskRangeIsValid(schedule: Pick<TaskWorkloadSchedule, "earliest_start_date" | "earliest_start_time" | "due_date" | "due_time">) {
  if (!schedule.earliest_start_date || !schedule.due_date) return true;
  const days = taskDateSpanDays(schedule);
  if (days === null) return false;
  if (!schedule.earliest_start_time && !schedule.due_time) return true;
  if (!schedule.earliest_start_time || !schedule.due_time) return true;
  if (days === 2) {
    const start = clockMinute(schedule.earliest_start_time);
    const end = clockMinute(schedule.due_time);
    return start !== null && end !== null && ((1440 - start) >= MIN_TASK_WORKLOAD_MINUTES || end >= MIN_TASK_WORKLOAD_MINUTES);
  }
  if (days > 1) return true;
  const duration = taskRangeDurationMinutes(schedule);
  return duration !== null && duration >= MIN_TASK_WORKLOAD_MINUTES;
}

export function inferredDailyWorkloadMinutes(
  totalMinutes: number | null,
  schedule: Pick<TaskWorkloadSchedule, "earliest_start_date" | "due_date">
) {
  const days = taskDateSpanDays(schedule);
  if (totalMinutes === null || totalMinutes > MAX_TASK_WORKLOAD_MINUTES || days === null || days <= 1 || totalMinutes % days !== 0) return null;
  const dailyMinutes = totalMinutes / days;
  return dailyMinutes > 0 && dailyMinutes <= 24 * 60 ? dailyMinutes : null;
}

export function totalWorkloadForDaily(dailyMinutes: number | null, days: number | null) {
  if (dailyMinutes === null || dailyMinutes < MIN_TASK_WORKLOAD_MINUTES || dailyMinutes > 24 * 60 || days === null || days <= 1) return null;
  const total = dailyMinutes * days;
  return Number.isInteger(total) && total >= MIN_TASK_WORKLOAD_MINUTES && total <= MAX_TASK_WORKLOAD_MINUTES
    ? total
    : null;
}

export function taskWorkloadIsValid(schedule: TaskWorkloadSchedule) {
  const days = taskDateSpanDays(schedule);
  const untimed = !schedule.earliest_start_time && !schedule.due_time;
  const total = schedule.estimated_minutes;
  if (isCrossDayTask(schedule) && days !== null && days > 1) {
    if (untimed) return true;
    if (total === null) return false;
    if (!Number.isInteger(total) || total < 1 || total > MAX_TASK_WORKLOAD_MINUTES) return false;
    const daily = inferredDailyWorkloadMinutes(total, schedule);
    const effectiveDaily = daily ?? (total / days);
    const maximumDaily = Math.min(24 * 60, Math.floor(MAX_TASK_WORKLOAD_MINUTES / days));
    return effectiveDaily >= MIN_TASK_WORKLOAD_MINUTES && effectiveDaily <= maximumDaily;
  }
  if (total === null) return true;
  return Number.isInteger(total) && total >= 1 && total <= MAX_TASK_WORKLOAD_MINUTES;
}

export function normalizeTaskWorkloadAfterScheduleChange<T extends TaskWorkloadSchedule>(previous: T, next: T): T {
  if (!next.earliest_start_time && !next.due_time) {
    return next.estimated_minutes === null ? next : { ...next, estimated_minutes: null } as T;
  }
  const nextSameDayMinutes = taskRangeDurationMinutes(next);
  if (nextSameDayMinutes !== null) return { ...next, estimated_minutes: nextSameDayMinutes } as T;

  const nextDays = taskDateSpanDays(next);
  if (!nextDays || nextDays <= 1) return next;

  const previousDailyMinutes = inferredDailyWorkloadMinutes(previous.estimated_minutes, previous)
    ?? taskRangeDurationMinutes(previous);
  if (previousDailyMinutes === null) return next;
  const total = totalWorkloadForDaily(previousDailyMinutes, nextDays);
  return total === null ? next : { ...next, estimated_minutes: total } as T;
}

export function formatWorkloadMinutes(minutes: number) {
  if (minutes <= 0) return "0 m";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${minutes} m`;
  if (!remainder) return `${hours} h`;
  return `${hours} h ${remainder} m`;
}
