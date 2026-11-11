import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(new URL("./app-titlebar.css", import.meta.url), "utf8");
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

test("today schedule date uses the approved compact sans heading", () => {
  assert.match(app, /<h2 className="timeline-day-title">\{todayView === "month" \? monthTitle : todayView === "week" \? selectedWeekHeading.range : selectedDateTitle\}<\/h2>/);
  assert.match(styles, /\.desktop-app \.today-page \.timeline-day-title \{[^}]*font: 650 22px\/28px "Segoe UI", "Microsoft YaHei", sans-serif/);
});

test("date occupies the first row while secondary facts form the second", () => {
  assert.match(styles, /\.desktop-app \.timeline-date-copy \{ display: flex; flex-direction: column; gap: 4px/);
  assert.match(styles, /\.timeline-date-primary \{ display: flex; align-items: center; flex-wrap: nowrap/);
  const primary = app.slice(app.indexOf('<div className="timeline-date-primary">'), app.indexOf('<div className="timeline-date-meta timeline-day-subline">'));
  assert.match(primary, /timeline-day-title/);
  assert.doesNotMatch(primary, /timeline-heading-plan-status|confirmed-plan-status|计划已确认/);
  assert.match(styles, /\.timeline-date-meta\.timeline-day-subline \{ margin: 0; gap: 6px; align-items: baseline/);
  assert.match(styles, /\.timeline-day-subline > span \{ color: inherit/);
  assert.match(app, /aria-label="上一天" onClick=\{\(\) => selectCalendarDate\(shiftDateValue\(selectedDate, -1\)\)\}/);
  assert.match(app, /aria-label="下一天" onClick=\{\(\) => selectCalendarDate\(shiftDateValue\(selectedDate, 1\)\)\}/);
});

test("historical date heading omits the completion-status hint", () => {
  assert.doesNotMatch(app, /历史安排 · 可修改完成状态|className="historical-plan-status"/);
});

test("lunar date and solar term have their own shared separator in day and month headings", () => {
  assert.equal(app.match(/selectedSolarTerm && <><CopySeparator \/><span className="timeline-term-chip">/g)?.length, 1, "day and month reuse the same secondary facts row");
});

test("date heading omits the confirmed-plan badge and its reserved space", () => {
  assert.doesNotMatch(app, /timeline-heading-plan-status|confirmed-plan-status/);
  assert.doesNotMatch(styles, /timeline-heading-plan-status|confirmed-plan-status/);
  assert.match(styles, /\.desktop-app \.timeline-top-actions \{ flex: none; margin-left: auto/);
  assert.match(styles, /\.desktop-app \.timeline-heading \{ flex: 1 1 304px; flex-wrap: nowrap/);
  assert.match(styles, /\.timeline-design-topbar \{[^}]*min-height: 80px;[^}]*align-items: center/);
});

test("return-today feedback follows the viewed date and reserves a stable button width", () => {
  assert.match(app, /className="timeline-return-today" onClick=\{returnToday\}>\{selectedDate === today \? "今天" : "回到今天"\}/);
  assert.match(styles, /\.timeline-date-navigation \.timeline-return-today \{ width: 60px; flex: 0 0 60px; white-space: nowrap; \}/);
});

test("week return feedback compares full Monday dates, not the selected day or week number alone", () => {
  assert.match(app, /const isCurrentWeek = selectedWeekDates\[0\] === weekDatesFor\(today\)\[0\]/);
  assert.match(app, /className="timeline-return-today" onClick=\{returnToday\}>\{isCurrentWeek \? "本周" : "回到本周"\}/);
});

test("viewed week badge sits beside the heading and shares blue brand-week styling", () => {
  const primary = app.slice(app.indexOf('<div className="timeline-date-primary">'), app.indexOf('<div className="timeline-date-meta timeline-day-subline">'));
  assert.match(primary, /todayView === "week" && <span className="timeline-week-number-badge"[^\n]+>第\{selectedWeekHeading.week\}周<\/span>/);
  assert.match(styles, /\.app-titlebar \.product-brand-week, \.timeline-date-copy \.timeline-week-number-badge \{[^}]*min-height: 24px;[^}]*padding: 0 7px; border: 1px solid var\(--color-blue-edge\); border-radius: 6px; color: var\(--color-blue-ink\); background: var\(--color-blue-bg\); font: 400 11px\/16px/);
});
