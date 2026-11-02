import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(new URL("./app-titlebar.css", import.meta.url), "utf8");
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

test("today schedule date uses the approved compact sans heading", () => {
  assert.match(app, /<h2 className="timeline-day-title">\{selectedDateTitle\}<\/h2>/);
  assert.match(styles, /\.desktop-app \.today-page \.timeline-day-title \{[^}]*font: 650 22px\/28px "Segoe UI", "Microsoft YaHei", sans-serif/);
});

test("date and confirmation share the first row while secondary facts form the second", () => {
  assert.match(styles, /\.desktop-app \.timeline-date-copy \{ display: flex; flex-direction: column; gap: 4px/);
  assert.match(styles, /\.timeline-date-primary \{ display: flex; align-items: center; flex-wrap: nowrap/);
  const primary = app.slice(app.indexOf('<div className="timeline-date-primary">'), app.indexOf('<div className="timeline-date-meta timeline-day-subline">'));
  assert.match(primary, /timeline-day-title/);
  assert.match(primary, /timeline-heading-plan-status/);
  assert.match(styles, /\.timeline-date-meta\.timeline-day-subline \{ margin: 0; gap: 6px; align-items: baseline/);
  assert.match(styles, /\.timeline-day-subline > span \{ color: inherit/);
  assert.match(app, /aria-label="上一天" onClick=\{\(\) => selectCalendarDate\(shiftDateValue\(selectedDate, -1\)\)\}/);
  assert.match(app, /aria-label="下一天" onClick=\{\(\) => selectCalendarDate\(shiftDateValue\(selectedDate, 1\)\)\}/);
});

test("historical date heading omits the completion-status hint", () => {
  assert.doesNotMatch(app, /历史安排 · 可修改完成状态|className="historical-plan-status"/);
});

test("lunar date and solar term have their own shared separator in day and month headings", () => {
  assert.equal(app.match(/selectedSolarTerm && <><CopySeparator \/><span className="timeline-term-chip">/g)?.length, 2);
});

test("confirmed plan state lives in the date heading, outside the stable navigation actions", () => {
  const heading = app.slice(app.indexOf('<div className="timeline-heading">'), app.indexOf('<div className="timeline-top-actions">'));
  const actions = app.slice(app.indexOf('<div className="timeline-top-actions">'), app.indexOf('</header>}', app.indexOf('<div className="timeline-top-actions">')));
  assert.match(heading, /className="timeline-heading-plan-status" role="status"/);
  assert.match(heading, /!preview && hasConfirmedPlan && !isPastDate/);
  assert.match(heading, /计划已确认/);
  assert.doesNotMatch(actions, /计划已确认|confirmed-plan-status/);
  assert.match(styles, /\.timeline-heading-plan-status \{[^}]*flex: 0 0 96px; min-height: 24px/);
  assert.match(styles, /\.desktop-app \.timeline-top-actions \{ flex: none; margin-left: auto/);
});

test("confirmation retains its semantic color block and stays horizontally aligned with the date", () => {
  assert.match(styles, /html:root \.desktop-app \.today-page \.timeline-heading-plan-status \.confirmed-plan-status \{[^}]*padding: 0 7px; border: 1px solid var\(--color-plan-edge\);[^}]*color: var\(--color-plan-ink\); background: var\(--color-plan-bg\)/);
  assert.match(styles, /\.desktop-app \.timeline-heading \{ flex: 1 1 304px; flex-wrap: nowrap/);
  assert.match(styles, /\.timeline-design-topbar \{[^}]*min-height: 80px;[^}]*align-items: center/);
  assert.match(styles, /html:root \.desktop-app \.today-page \.timeline-heading-plan-status \.confirmed-plan-status \{ display: inline-flex; align-items: center; justify-content: center; gap: 6px/);
  assert.match(styles, /\.timeline-heading-plan-status \.confirmed-plan-status \{[^}]*line-height: 16px/);
  assert.match(styles, /\.timeline-heading-plan-status \.confirmed-plan-status > svg \{ display: block; flex: none/);
  assert.doesNotMatch(styles, /\.timeline-heading-plan-status \.confirmed-plan-status \{[^}]*transform:/);
});

test("return-today feedback follows the viewed date and reserves a stable button width", () => {
  assert.match(app, /className="timeline-return-today" onClick=\{returnToday\}>\{selectedDate === today \? "今天" : "回到今天"\}/);
  assert.match(styles, /\.timeline-date-navigation \.timeline-return-today \{ width: 60px; flex: 0 0 60px; white-space: nowrap; \}/);
});
