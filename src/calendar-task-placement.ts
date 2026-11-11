import { missingHolidayYears, officialWorkdayOn } from "./official-holiday-calendar.ts";

export type CalendarTaskPlacement = {
  scheduled_dates: readonly string[];
  due_date: string | null;
  due_at: string | null;
};

export type CalendarRecurrenceRule = {
  frequency: "daily" | "weekdays" | "weekly" | "monthly";
  interval_value: number;
  weekdays: readonly number[];
  month_day: number | null;
  starts_on: string;
  ends_on: string | null;
};

export type CalendarRecurringPlacement = CalendarRecurrenceRule & {
  status: "active" | "paused" | "ended";
  deleted_at: string | null;
};

export function taskAppearsOnDate(task: CalendarTaskPlacement, date: string) {
  if (task.scheduled_dates.length > 0) return task.scheduled_dates.includes(date);
  return (task.due_date ?? task.due_at?.slice(0, 10) ?? null) === date;
}

function dateParts(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  return { year: Number(year), month: Number(month), day: Number(day) };
}


export function recurringRuleOccursOn(rule: CalendarRecurrenceRule, date: string) {
  if (date < rule.starts_on || rule.ends_on && date > rule.ends_on) return false;
  const start = dateParts(rule.starts_on);
  const target = dateParts(date);
  if (!start || !target || rule.interval_value < 1) return false;
  const startDay = Date.UTC(start.year, start.month - 1, start.day) / 86_400_000;
  const targetDay = Date.UTC(target.year, target.month - 1, target.day) / 86_400_000;
  const days = targetDay - startDay;
  if (days < 0) return false;
  const weeks = Math.floor(days / 7);
  const weekday = new Date(Date.UTC(target.year, target.month - 1, target.day)).getUTCDay() || 7;
  if (rule.frequency === "daily") return days % rule.interval_value === 0;
  if (rule.frequency === "weekdays") {
    if (missingHolidayYears(rule.starts_on, date).length || officialWorkdayOn(date) !== true) return false;
    let workdays = 0;
    for (let day = startDay; day <= targetDay; day += 1) {
      if (officialWorkdayOn(new Date(day * 86_400_000).toISOString().slice(0, 10))) workdays += 1;
    }
    return (workdays - 1) % rule.interval_value === 0;
  }
  if (rule.frequency === "weekly") return rule.weekdays.includes(weekday) && weeks % rule.interval_value === 0;
  const monthDelta = (target.year - start.year) * 12 + target.month - start.month;
  return target.day === (rule.month_day ?? 1) && monthDelta % rule.interval_value === 0;
}

export function recurringItemAppearsOnDate(item: CalendarRecurringPlacement, date: string) {
  return !item.deleted_at && item.status === "active" && recurringRuleOccursOn(item, date);
}
