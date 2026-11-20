import { officialDayOn, officialHolidayCoverageFor } from "./official-holiday-calendar.ts";
export { officialHolidayCoverageFor } from "./official-holiday-calendar.ts";

export type CalendarWorkState = "rest" | "work";
export type CalendarLabelKind = "holiday" | "festival" | "solar-term";

export type CalendarDayInfo = {
  workState?: CalendarWorkState;
  solarTerm?: string;
  labels: { text: string; kind: CalendarLabelKind }[];
};


const SOLAR_TERMS_2026: Record<string, string> = {
  "2026-01-05": "小寒", "2026-01-20": "大寒",
  "2026-02-04": "立春", "2026-02-19": "雨水",
  "2026-03-05": "惊蛰", "2026-03-20": "春分",
  "2026-04-05": "清明", "2026-04-20": "谷雨",
  "2026-05-05": "立夏", "2026-05-21": "小满",
  "2026-06-05": "芒种", "2026-06-21": "夏至",
  "2026-07-07": "小暑", "2026-07-23": "大暑",
  "2026-08-07": "立秋", "2026-08-23": "处暑",
  "2026-09-07": "白露", "2026-09-23": "秋分",
  "2026-10-08": "寒露", "2026-10-23": "霜降",
  "2026-11-07": "立冬", "2026-11-22": "小雪",
  "2026-12-07": "大雪", "2026-12-22": "冬至"
};

const LUNAR_FESTIVALS: Record<string, string> = {
  "1-1": "春节",
  "1-15": "元宵节",
  "5-5": "端午节",
  "7-7": "七夕",
  "8-15": "中秋节",
  "9-9": "重阳节",
  "12-8": "腊八节"
};

const chineseCalendar = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", {
  timeZone: "Asia/Shanghai",
  month: "numeric",
  day: "numeric"
});

const chineseCalendarLabel = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", {
  timeZone: "Asia/Shanghai",
  month: "long",
  day: "numeric"
});

const LUNAR_DAY_LABELS = [
  "", "初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十",
  "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
  "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十"
];

function lunarMonthDay(date: string) {
  const parts = chineseCalendar.formatToParts(new Date(`${date}T00:00:00+08:00`));
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return month && day && /^\d+$/.test(month) ? `${month}-${day}` : null;
}

export function lunarDayLabel(date: string) {
  const parts = chineseCalendarLabel.formatToParts(new Date(`${date}T00:00:00+08:00`));
  const month = parts.find((part) => part.type === "month")?.value;
  const day = Number(parts.find((part) => part.type === "day")?.value);
  if (!Number.isInteger(day) || day < 1 || day > 30) return "";
  return day === 1 ? month ?? LUNAR_DAY_LABELS[day] : LUNAR_DAY_LABELS[day];
}

export function lunarDateLabel(date: string) {
  const parts = chineseCalendarLabel.formatToParts(new Date(`${date}T00:00:00+08:00`));
  const month = parts.find((part) => part.type === "month")?.value;
  const day = Number(parts.find((part) => part.type === "day")?.value);
  return month && Number.isInteger(day) && day >= 1 && day <= 30 ? `${month}${LUNAR_DAY_LABELS[day]}` : "";
}

export function solarTermProgressLabel(date: string) {
  const termDate = Object.keys(SOLAR_TERMS_2026).filter((key) => key.slice(0, 4) === date.slice(0, 4) && key <= date).at(-1);
  if (!termDate) return null;
  const elapsedDays = Math.round((Date.parse(`${date}T00:00:00+08:00`) - Date.parse(`${termDate}T00:00:00+08:00`)) / 86400000);
  return elapsedDays === 0 ? SOLAR_TERMS_2026[termDate] : `${SOLAR_TERMS_2026[termDate]}第${elapsedDays + 1}天`;
}

const HEAVENLY_STEMS = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"] as const;
const EARTHLY_BRANCHES = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"] as const;
const ZODIAC_ANIMALS: Record<string, string> = {
  子: "鼠", 丑: "牛", 寅: "虎", 卯: "兔", 辰: "龙", 巳: "蛇",
  午: "马", 未: "羊", 申: "猴", 酉: "鸡", 戌: "狗", 亥: "猪"
};
const CANONICAL_MONTH_SOLAR_TERMS = [
  ["小寒", "大寒"], ["立春", "雨水"], ["惊蛰", "春分"], ["清明", "谷雨"],
  ["立夏", "小满"], ["芒种", "夏至"], ["小暑", "大暑"], ["立秋", "处暑"],
  ["白露", "秋分"], ["寒露", "霜降"], ["立冬", "小雪"], ["大雪", "冬至"]
] as const;

const chineseYearFormatter = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", {
  timeZone: "Asia/Shanghai",
  year: "numeric"
});

export function weekPeriodLabel(date: string) {
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  if (!Number.isInteger(month) || !Number.isInteger(day)) return "";
  return `${month}月${day <= 10 ? "上旬" : day <= 20 ? "中旬" : "下旬"}`;
}

export function monthOverviewMeta(monthKey: string) {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  const daysInMonth = Number.isInteger(year) && Number.isInteger(month)
    ? new Date(Date.UTC(year, month, 0)).getUTCDate()
    : 30;
  const midMonth = new Date(`${monthKey}-15T00:00:00+08:00`);
  const parts = Number.isNaN(midMonth.getTime()) ? [] : chineseYearFormatter.formatToParts(midMonth);
  const rawStemBranch = parts.find((part) => (part.type as string) === "yearName")?.value;
  const fallbackOffset = (((year - 4) % 60) + 60) % 60;
  const stemBranch = rawStemBranch && rawStemBranch.length === 2
    ? rawStemBranch
    : `${HEAVENLY_STEMS[fallbackOffset % 10]}${EARTHLY_BRANCHES[fallbackOffset % 12]}`;
  const zodiac = ZODIAC_ANIMALS[stemBranch[1]] ?? "";
  const exactTerms = Object.entries(SOLAR_TERMS_2026)
    .filter(([key]) => key.startsWith(`${monthKey}-`))
    .map(([, label]) => label);
  const canonicalPair = CANONICAL_MONTH_SOLAR_TERMS[month - 1];
  const solarTerms = (exactTerms.length ? exactTerms : canonicalPair ?? []).join(" / ");
  return {
    lunarYear: `${stemBranch}${zodiac}年`,
    solarTerms,
    daysLabel: `全月 ${daysInMonth} 天`
  };
}

function nextDate(date: string) {
  const value = new Date(`${date}T00:00:00+08:00`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

export function availabilityWorkdayOn(date: string, weekdays: readonly number[], makeupWorkdaysAsWorkdays = true) {
  const { holiday, makeup } = officialDayOn(date);
  if (officialHolidayCoverageFor(date)) {
    if (holiday) return false;
    if (makeupWorkdaysAsWorkdays && makeup) return true;
  }
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
  return weekdays.includes(weekday);
}

export function calendarDayInfo(date: string): CalendarDayInfo | null {
  const labels: CalendarDayInfo["labels"] = [];
  const { holiday: officialHolidayName, makeup: makeupHoliday } = officialDayOn(date);
  const officialHoliday = officialHolidayName;
  const workState = officialHoliday ? "rest" : makeupHoliday ? "work" : undefined;

  const holidayName = officialHolidayName ?? makeupHoliday;
  if (holidayName) labels.push({ text: holidayName, kind: "holiday" });

  const lunarFestival = LUNAR_FESTIVALS[lunarMonthDay(date) ?? ""];
  const isNewYearsEve = lunarMonthDay(nextDate(date)) === "1-1";
  if (isNewYearsEve) labels.push({ text: "除夕", kind: "festival" });
  if (lunarFestival && !labels.some((label) => label.text === lunarFestival)) labels.push({ text: lunarFestival, kind: "festival" });

  const solarTerm = SOLAR_TERMS_2026[date];
  if (solarTerm && !labels.some((label) => label.text === solarTerm || `${label.text}` === `${solarTerm}节`)) {
    labels.push({ text: solarTerm, kind: "solar-term" });
  }

  return workState || labels.length || solarTerm ? { workState, solarTerm, labels } : null;
}
