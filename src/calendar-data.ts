export type CalendarWorkState = "rest" | "work";
export type CalendarLabelKind = "holiday" | "festival" | "solar-term";

export type CalendarDayInfo = {
  workState?: CalendarWorkState;
  labels: { text: string; kind: CalendarLabelKind }[];
};

type OfficialHolidayGroup = {
  name: string;
  dates: string[];
  namedDate?: string;
};

// 国务院办公厅：国办发明电〔2025〕7号
// https://www.gov.cn/zhengce/content/202511/content_7047090.htm
const OFFICIAL_HOLIDAYS_2026: OfficialHolidayGroup[] = [
  { name: "元旦", dates: ["2026-01-01", "2026-01-02", "2026-01-03"], namedDate: "2026-01-01" },
  { name: "春节", dates: ["2026-02-15", "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20", "2026-02-21", "2026-02-22", "2026-02-23"] },
  { name: "清明节", dates: ["2026-04-04", "2026-04-05", "2026-04-06"] },
  { name: "劳动节", dates: ["2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05"], namedDate: "2026-05-01" },
  { name: "端午节", dates: ["2026-06-19", "2026-06-20", "2026-06-21"] },
  { name: "中秋节", dates: ["2026-09-25", "2026-09-26", "2026-09-27"] },
  { name: "国庆节", dates: ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"], namedDate: "2026-10-01" }
];

const MAKEUP_WORKDAYS_2026 = new Map([
  ["2026-01-04", "元旦"],
  ["2026-02-14", "春节"],
  ["2026-02-28", "春节"],
  ["2026-05-09", "劳动节"],
  ["2026-09-20", "中秋节"],
  ["2026-10-10", "国庆节"]
]);

export const OFFICIAL_HOLIDAY_COVERAGE = { from: "2026-01-01", to: "2026-12-31", version: "国务院办公厅 2026 年安排" } as const;

export function officialHolidayCoverageFor(date: string) {
  return date >= OFFICIAL_HOLIDAY_COVERAGE.from && date <= OFFICIAL_HOLIDAY_COVERAGE.to;
}

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

function nextDate(date: string) {
  const value = new Date(`${date}T00:00:00+08:00`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

const officialHolidayByDate = new Map<string, OfficialHolidayGroup>();
for (const group of OFFICIAL_HOLIDAYS_2026) {
  for (const date of group.dates) officialHolidayByDate.set(date, group);
}

export function calendarDayInfo(date: string): CalendarDayInfo | null {
  const labels: CalendarDayInfo["labels"] = [];
  const officialHoliday = officialHolidayByDate.get(date);
  const makeupHoliday = MAKEUP_WORKDAYS_2026.get(date);
  const workState = officialHoliday ? "rest" : makeupHoliday ? "work" : undefined;

  const officialHolidayName = officialHoliday?.name ?? makeupHoliday;
  if (officialHolidayName) labels.push({ text: officialHolidayName, kind: "holiday" });

  const lunarFestival = LUNAR_FESTIVALS[lunarMonthDay(date) ?? ""];
  const isNewYearsEve = lunarMonthDay(nextDate(date)) === "1-1";
  if (isNewYearsEve) labels.push({ text: "除夕", kind: "festival" });
  if (lunarFestival && !labels.some((label) => label.text === lunarFestival)) labels.push({ text: lunarFestival, kind: "festival" });

  const solarTerm = SOLAR_TERMS_2026[date];
  if (solarTerm && !labels.some((label) => label.text === solarTerm || `${label.text}` === `${solarTerm}节`)) {
    labels.push({ text: solarTerm, kind: "solar-term" });
  }

  return workState || labels.length ? { workState, labels } : null;
}
