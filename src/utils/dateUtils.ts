import { calendarDayInfo, lunarDateLabel, lunarDayLabel, solarTermProgressLabel } from "../calendar-data";

export const WEEKDAY_CN = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
export const WEEKDAY_SHORT_CN = ["一", "二", "三", "四", "五", "六", "日"];

export function shanghaiNowParts(now = new Date()): { date: string; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: hour * 60 + minute,
  };
}

export function todayDateStr(now = new Date()): string {
  return shanghaiNowParts(now).date;
}

export function parseDateParts(dateStr: string): { year: number; month: number; day: number } {
  const [y, m, d] = dateStr.split("-").map(Number);
  return { year: y || 2026, month: m || 1, day: d || 1 };
}

export function formatDateStr(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function shiftDate(dateStr: string, deltaDays: number): string {
  const { year, month, day } = parseDateParts(dateStr);
  const dt = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return formatDateStr(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function shiftMonth(dateStr: string, deltaMonths: number): string {
  const { year, month, day } = parseDateParts(dateStr);
  const targetFirst = new Date(Date.UTC(year, month - 1 + deltaMonths, 1));
  const ty = targetFirst.getUTCFullYear();
  const tm = targetFirst.getUTCMonth() + 1;
  const maxDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return formatDateStr(ty, tm, Math.min(day, maxDay));
}

export function weekdayIndexSun0(dateStr: string): number {
  const { year, month, day } = parseDateParts(dateStr);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function weekdayNumMon1(dateStr: string): number {
  const sun0 = weekdayIndexSun0(dateStr);
  return sun0 === 0 ? 7 : sun0;
}

export function formatDateLongCn(dateStr: string): string {
  const { year, month, day } = parseDateParts(dateStr);
  return `${year}年${month}月${day}日`;
}

export function formatDateShortCn(dateStr: string): string {
  const { month, day } = parseDateParts(dateStr);
  return `${month}月${day}日`;
}

export function formatYearMonthCn(dateStr: string): string {
  const { year, month } = parseDateParts(dateStr);
  return `${year}年${month}月`;
}

export function getDateSubtitle(dateStr: string, showLunar: boolean): string {
  const wd = WEEKDAY_CN[weekdayIndexSun0(dateStr)];
  if (!showLunar) return wd;
  const lunar = lunarDateLabel(dateStr);
  const solar = solarTermProgressLabel(dateStr);
  const parts = [wd];
  if (lunar) parts.push(`农历${lunar}`);
  if (solar) parts.push(solar);
  return parts.join(" · ");
}

export function getCellLunarBadge(dateStr: string): { text: string; highlight: boolean } | null {
  const info = calendarDayInfo(dateStr);
  if (info && info.labels.length > 0) {
    return {
      text: info.labels[0].text,
      highlight: info.labels[0].kind === "solar-term" || info.labels[0].kind === "holiday",
    };
  }
  const lunar = lunarDayLabel(dateStr);
  return lunar ? { text: lunar, highlight: false } : null;
}

export function getCellWorkState(dateStr: string): "rest" | "work" | undefined {
  return calendarDayInfo(dateStr)?.workState;
}

export function isStatutoryWorkday(dateStr: string): boolean {
  const state = getCellWorkState(dateStr);
  return state === undefined ? weekdayNumMon1(dateStr) <= 5 : state === "work";
}

export function diffDays(startStr: string, endStr: string): number {
  const s = parseDateParts(startStr);
  const e = parseDateParts(endStr);
  const ms = Date.UTC(e.year, e.month - 1, e.day) - Date.UTC(s.year, s.month - 1, s.day);
  return Math.round(ms / 86_400_000);
}

export function calcDaySpan(startStr: string, endStr: string): number {
  if (!startStr || !endStr) return 1;
  return Math.max(1, diffDays(startStr, endStr) + 1);
}

export function isDateInRange(targetDate: string, startStr: string, endStr: string): boolean {
  const s = startStr || targetDate;
  const e = endStr || s;
  return targetDate >= s && targetDate <= e;
}

export function calcDayProgressLabel(startStr: string, endStr: string, targetDate: string): string | null {
  const span = calcDaySpan(startStr, endStr);
  if (span <= 1) return null;
  const idx = Math.min(span, Math.max(1, diffDays(startStr, targetDate) + 1));
  return `第 ${idx}/${span} 天`;
}

export interface CalendarCell {
  date: string;
  day: number;
  inMonth: boolean;
}

/** Always returns 42 cells (6 rows x 7 cols, Monday-first) covering the month of `anchorDate`. */
export function buildMonthGrid(anchorDate: string): CalendarCell[] {
  const { year, month } = parseDateParts(anchorDate);
  const firstDate = formatDateStr(year, month, 1);
  const firstDow = weekdayNumMon1(firstDate); // 1=Mon..7=Sun
  const leading = firstDow - 1;
  const startGrid = shiftDate(firstDate, -leading);
  const cells: CalendarCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = shiftDate(startGrid, i);
    const p = parseDateParts(d);
    cells.push({
      date: d,
      day: p.day,
      inMonth: p.year === year && p.month === month,
    });
  }
  return cells;
}

export function buildWeekRowForDate(selectedDate: string): CalendarCell[] {
  const { year, month } = parseDateParts(selectedDate);
  const dow = weekdayNumMon1(selectedDate);
  const monday = shiftDate(selectedDate, -(dow - 1));
  const row: CalendarCell[] = [];
  for (let i = 0; i < 7; i++) {
    const d = shiftDate(monday, i);
    const p = parseDateParts(d);
    row.push({
      date: d,
      day: p.day,
      inMonth: p.year === year && p.month === month,
    });
  }
  return row;
}

export function fmtMinutes(totalMins: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, Math.round(totalMins)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function fmtDuration(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = mins / 60;
  return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`;
}

export function parseTimeToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

export function formatRelativeTimestamp(iso: string, today = todayDateStr()): string {
  if (!iso) return "刚刚";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = shanghaiNowParts(d);
  const hm = fmtMinutes(parts.minutes);
  if (parts.date === today) return `今天 ${hm}`;
  if (parts.date === shiftDate(today, -1)) return `昨天 ${hm}`;
  return `${formatDateShortCn(parts.date)} ${hm}`;
}
