import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { monthOverviewMeta, weekPeriodLabel } from "./calendar-data.ts";

const styles = readFileSync(new URL("./app-titlebar.css", import.meta.url), "utf8");
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

test("today schedule date uses the approved compact sans heading", () => {
  assert.match(app, /<h2 className="timeline-day-title">\{todayView === "month" \? monthTitle : todayView === "week" \? selectedWeekHeading.range : selectedDateTitle\}<\/h2>/);
  assert.match(styles, /\.desktop-app \.today-page \.timeline-day-title \{[^}]*font: 600 22px\/28px var\(--jx-font-sans\)/);
});

test("date and secondary metadata align on a single baseline row across day, week and month", () => {
  assert.match(styles, /\.desktop-app \.timeline-date-copy \{ display: flex; flex-direction: row; align-items: baseline; flex-wrap: wrap/);
  assert.match(styles, /\.timeline-date-primary \{ display: flex; align-items: baseline; flex-wrap: nowrap/);
  const primary = app.slice(app.indexOf('<div className="timeline-date-primary">'), app.indexOf('<div className="timeline-date-meta timeline-day-subline">'));
  assert.match(primary, /timeline-day-title/);
  assert.doesNotMatch(primary, /timeline-heading-plan-status|confirmed-plan-status|计划已确认|timeline-week-number-badge/);
  assert.match(styles, /\.timeline-date-meta\.timeline-day-subline \{[^}]*gap: 6px; align-items: baseline/);
  assert.match(styles, /\.timeline-day-subline > span \{ color: inherit/);
  assert.match(app, /prevLabel: "上一天"[\s\S]*onPrev: \(\) => selectCalendarDate\(shiftDateValue\(selectedDate, -1\)\)/);
  assert.match(app, /nextLabel: "下一天"[\s\S]*onNext: \(\) => selectCalendarDate\(shiftDateValue\(selectedDate, 1\)\)/);
  assert.match(app, /aria-label=\{periodNavigation\.prevLabel\}[^>]*onClick=\{periodNavigation\.onPrev\}/);
  assert.match(app, /aria-label=\{periodNavigation\.nextLabel\}[^>]*onClick=\{periodNavigation\.onNext\}/);
});

test("historical and view headings omit redundant status or instructional copy", () => {
  assert.doesNotMatch(app, /历史安排 · 可修改完成状态|className="historical-plan-status"|timeline-heading-plan-status|confirmed-plan-status/);
  assert.doesNotMatch(app, /点击任意星期列头进入当日时间线|双击日期格或按 Enter 打开当日日程|双击日期查看当天日程/);
  assert.doesNotMatch(styles, /timeline-heading-plan-status|confirmed-plan-status/);
  assert.match(styles, /\.desktop-app \.timeline-top-actions \{ flex: none; margin-left: auto/);
  assert.match(styles, /\.timeline-design-topbar \{[^}]*min-height: 64px;[^}]*align-items: center/);
});

test("month and week metadata helpers compute prototype lunar year, solar terms, days and ten-day periods", () => {
  assert.deepEqual(monthOverviewMeta("2026-11"), {
    lunarYear: "丙午马年",
    solarTerms: "立冬 / 小雪",
    daysLabel: "全月 30 天"
  });
  assert.equal(monthOverviewMeta("2024-02").daysLabel, "全月 29 天");
  assert.equal(weekPeriodLabel("2026-11-05"), "11月上旬");
  assert.equal(weekPeriodLabel("2026-11-19"), "11月中旬");
  assert.equal(weekPeriodLabel("2026-11-26"), "11月下旬");
  assert.match(app, /<span>第 \{selectedWeekHeading\.week\} 周<\/span>/);
  assert.match(app, /isCurrentWeek && <><CopySeparator \/><span className="timeline-current-period">本周<\/span><\/>/);
  assert.match(app, /<span>\{monthMeta\.lunarYear\}<\/span>/);
});

test("period navigation separates neutral return button from right-anchored chevron steppers without dots or blue fills", () => {
  const colors = readFileSync(new URL("./color-system.css", import.meta.url), "utf8");
  assert.match(app, /isCurrent: selectedDate === today,\s*currentLabel: "今天",\s*awayLabel: "回到今天"/);
  assert.match(app, /isCurrent: isCurrentWeek,\s*currentLabel: "本周",\s*awayLabel: "回到本周"/);
  assert.match(app, /isCurrent: monthKey === todayMonthKey,\s*currentLabel: "本月",\s*awayLabel: "回到本月"/);
  const navBlock = app.match(/<div className="timeline-date-navigation"[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? "";
  assert.ok(navBlock);
  assert.ok(navBlock.indexOf('className="timeline-return-today"') < navBlock.indexOf('className="timeline-date-steppers"'));
  assert.match(navBlock, /data-period-state=\{periodNavigation\.isCurrent \? "current" : "away"\}[\s\S]*className="timeline-return-today"[\s\S]*onClick=\{returnToday\}/);
  assert.match(navBlock, /className="timeline-date-steppers"[\s\S]*timeline-date-stepper-divider/);
  assert.doesNotMatch(navBlock, /data-period-kind/);
  assert.match(styles, /\.timeline-date-navigation \{ display: inline-flex; flex: none; align-items: center; gap: 6px; \}/);
  assert.match(colors, /\.timeline-return-today \{[^}]*justify-content: center; width: 74px; height: 30px;[^}]*padding: 0;[^}]*font: 500 12\.5px\/18px "Microsoft YaHei UI", var\(--jx-font-sans\)/);
  assert.match(colors, /\.timeline-return-today\[data-period-state="current"\] \{[^}]*color: #4a5c75; background: #f8fafc;/);
  assert.match(colors, /\.timeline-return-today\[data-period-state="away"\] \{[^}]*color: #0f172a; background: #ffffff;/);
  assert.doesNotMatch(colors, /\.timeline-return-today[^\n]*::before/);
  assert.doesNotMatch(colors, /\.timeline-return-today\[data-period-state="away"\][^\n]*(?:#eff6ff|--color-selected-bg|--color-selected-ink)/);
  assert.match(app, /const isCurrentWeek = selectedWeekDates\[0\] === weekDatesFor\(today\)\[0\]/);
});
