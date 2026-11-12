import bundled2026 from "../data/holidays/2026.json" with { type: "json" };

export type OfficialHolidayYear = {
  schemaVersion: number;
  year: number;
  revision: number;
  from: string;
  to: string;
  version: string;
  sourceUrl: string;
  verifiedAt: string;
  holidays: { name: string; dates: string[]; namedDate?: string | null }[];
  makeupWorkdays: string[][];
};

export type HolidayCalendarSnapshot = {
  years: OfficialHolidayYear[];
  availableYears: number[];
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  checking: boolean;
};

export function validCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validName(value: unknown, max = 80): value is string {
  return typeof value === "string" && value.trim().length > 0 && [...value].length <= max && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

export function validateHolidayYear(value: unknown): asserts value is OfficialHolidayYear {
  if (!value || typeof value !== "object") throw new Error("节假日年度数据无效");
  const data = value as OfficialHolidayYear;
  const keys = ["schemaVersion", "year", "revision", "from", "to", "version", "sourceUrl", "verifiedAt", "holidays", "makeupWorkdays"];
  if (Object.keys(data).some((key) => !keys.includes(key))) throw new Error("节假日年度包含不支持的字段");
  if (data.schemaVersion !== 1 || !Number.isInteger(data.year) || data.year < 1900 || data.year > 2200
    || !Number.isInteger(data.revision) || data.revision < 1 || data.revision > 4294967295
    || data.from !== `${data.year}-01-01` || data.to !== `${data.year}-12-31`
    || !validName(data.version, 200) || !validCalendarDate(data.verifiedAt)) throw new Error("节假日年度范围或版本无效");
  let source: URL;
  try { source = new URL(data.sourceUrl); } catch { throw new Error("节假日官方来源无效"); }
  if (source.protocol !== "https:" || !(source.hostname === "gov.cn" || source.hostname.endsWith(".gov.cn"))
    || source.username || source.password || source.port || source.search || source.hash || source.pathname === "/" || data.sourceUrl.length > 2048) throw new Error("节假日官方来源无效");
  if (!Array.isArray(data.holidays) || data.holidays.length < 1 || data.holidays.length > 366
    || !Array.isArray(data.makeupWorkdays) || data.makeupWorkdays.length > 366) throw new Error("节假日列表无效");
  const seen = new Set<string>();
  const names = new Set<string>();
  const add = (date: unknown) => {
    if (!validCalendarDate(date) || date < data.from || date > data.to || seen.has(date)) throw new Error("节假日日期无效、重复或冲突");
    seen.add(date);
  };
  for (const group of data.holidays) {
    if (!group || !validName(group.name) || names.has(group.name) || !Array.isArray(group.dates) || !group.dates.length || group.dates.length > 366
      || Object.keys(group).some((key) => !["name", "dates", "namedDate"].includes(key))) throw new Error("放假安排无效");
    names.add(group.name);
    group.dates.forEach(add);
    if (group.namedDate != null && !group.dates.includes(group.namedDate)) throw new Error("节日命名日期不在放假范围内");
  }
  for (const pair of data.makeupWorkdays) {
    if (!Array.isArray(pair) || pair.length !== 2 || !validName(pair[1])) throw new Error("补班安排无效");
    add(pair[0]);
  }
}

validateHolidayYear(bundled2026);
let snapshot: HolidayCalendarSnapshot = {
  years: [bundled2026], availableYears: [], lastAttemptAt: null, lastSuccessAt: null, lastError: null, checking: false
};
let byYear = new Map(snapshot.years.map((data) => [data.year, data]));
let restDays = new Map<string, string>();
let makeupDays = new Map<string, string>();
const listeners = new Set<() => void>();

function rebuildDates() {
  restDays = new Map(snapshot.years.flatMap((data) => data.holidays.flatMap((group) => group.dates.map((date) => [date, group.name] as const))));
  makeupDays = new Map(snapshot.years.flatMap((data) => data.makeupWorkdays.map(([date, name]) => [date, name] as const)));
}
rebuildDates();

export const getHolidayCalendarSnapshot = () => snapshot;
export function subscribeHolidayCalendar(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// Install a complete backend snapshot atomically; malformed IPC must not clear the usable calendar.
export function installHolidayCalendarSnapshot(next: HolidayCalendarSnapshot) {
  const nextByYear = new Map<number, OfficialHolidayYear>();
  for (const data of next.years) {
    validateHolidayYear(data);
    if (nextByYear.has(data.year)) throw new Error("节假日年度重复");
    nextByYear.set(data.year, data);
  }
  const copy = JSON.parse(JSON.stringify(next)) as HolidayCalendarSnapshot;
  copy.years.sort((a, b) => a.year - b.year);
  byYear = new Map(copy.years.map((data) => [data.year, data]));
  snapshot = copy;
  rebuildDates();
  listeners.forEach((listener) => listener());
}

export function officialHolidayCoverageFor(date: string) {
  return validCalendarDate(date) && byYear.has(Number(date.slice(0, 4)));
}

export function missingHolidayYears(from: string, to: string): number[] {
  if (!validCalendarDate(from) || !validCalendarDate(to) || from > to) return [];
  const missing: number[] = [];
  for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year += 1) {
    if (!byYear.has(year)) missing.push(year);
  }
  return missing;
}

export function officialDayOn(date: string) {
  return { holiday: restDays.get(date), makeup: makeupDays.get(date) };
}

export function officialWorkdayOn(date: string): boolean | null {
  if (!officialHolidayCoverageFor(date)) return null;
  if (restDays.has(date)) return false;
  if (makeupDays.has(date)) return true;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

export function holidayDataKey(data = snapshot) {
  return JSON.stringify(data.years);
}

export function holidayYearMessage(year: number, data = snapshot) {
  if (data.years.some((item) => item.year === year)) return "";
  if (data.checking) return `正在检查并更新 ${year} 年节假日安排…`;
  if (!data.lastError && data.lastSuccessAt && !data.availableYears.includes(year)) {
    return `${year} 年放假与调休安排在数据源中尚未收录，稍后可检查更新。`;
  }
  return `暂未取得 ${year} 年节假日数据。`;
}
