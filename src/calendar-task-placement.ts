export type CalendarTaskPlacement = {
  scheduled_dates: readonly string[];
  due_date: string | null;
  due_at: string | null;
};

export type CalendarRecurringPlacement = {
  status: "active" | "paused" | "ended";
  deleted_at: string | null;
  frequency: "daily" | "weekdays" | "weekly" | "monthly";
  interval_value: number;
  weekdays: readonly number[];
  month_day: number | null;
  starts_on: string;
  ends_on: string | null;
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

export function recurringItemAppearsOnDate(item: CalendarRecurringPlacement, date: string) {
  if (item.deleted_at || item.status !== "active" || date < item.starts_on || item.ends_on && date > item.ends_on) return false;
  const start = dateParts(item.starts_on);
  const target = dateParts(date);
  if (!start || !target || item.interval_value < 1) return false;
  const startDay = Date.UTC(start.year, start.month - 1, start.day) / 86_400_000;
  const targetDay = Date.UTC(target.year, target.month - 1, target.day) / 86_400_000;
  const days = targetDay - startDay;
  if (days < 0) return false;
  const weeks = Math.floor(days / 7);
  const weekday = new Date(Date.UTC(target.year, target.month - 1, target.day)).getUTCDay() || 7;
  if (item.frequency === "daily") return days % item.interval_value === 0;
  if (item.frequency === "weekdays") return weekday <= 5 && weeks % item.interval_value === 0;
  if (item.frequency === "weekly") return item.weekdays.includes(weekday) && weeks % item.interval_value === 0;
  const monthDelta = (target.year - start.year) * 12 + target.month - start.month;
  return target.day === (item.month_day ?? 1) && monthDelta % item.interval_value === 0;
}
