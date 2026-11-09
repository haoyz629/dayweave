import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { visibleTaskScheduleBlocks } from "./task-result.ts";

const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const calculation = app.match(/  const summaryTaskBlocks =[\s\S]*?\n\n  useLayoutEffect/)?.[0].replace(/\n\n  useLayoutEffect$/, "");
assert.ok(calculation?.includes("const summaryProgress ="));
const card = app.match(/<section className="sidebar-summary-card"[\s\S]*?<\/section>/)?.[0];
assert.ok(card);
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const selectedDate = "2026-11-06";
const occurrence = (id, outcome, date = selectedDate, display_time = null, display_duration_minutes = null) => ({
  id, recurring_item_id: "same-recurring-rule", occurrence_date: date, outcome, display_time, display_duration_minutes
});
const block = (id, execution_status = "planned", review = null) => ({
  id, task_id: "same-task", task_status: "scheduled", execution_status, review,
  starts_at: `${selectedDate}T09:00:00+08:00`, ends_at: `${selectedDate}T09:30:00+08:00`
});
function summary(recurringOccurrences = [], task_blocks = [], date = selectedDate, today = date) {
  return JSON.parse(vm.runInNewContext(compile(`${calculation}\nJSON.stringify({ plannedTaskCount, completedPlannedTaskCount, plannedMinutes, summaryMinutes, recurringItemCount, completedRecurringItemCount, summaryArrangementCount, completedArrangementCount, summaryProgress });`),
    { recurringOccurrences, daySchedule: { task_blocks }, selectedDate: date, today, visibleTaskScheduleBlocks }));
}
function expectSummary(items, total, completed, progress, date = selectedDate) {
  const value = summary(items, [], date);
  assert.equal(value.recurringItemCount, total);
  assert.equal(value.completedRecurringItemCount, completed);
  assert.equal(value.summaryArrangementCount, total);
  assert.equal(value.completedArrangementCount, completed);
  assert.equal(value.summaryProgress, progress);
}
function render(value, date = selectedDate) {
  const context = vm.createContext({ React, ...value, selectedDate: date });
  vm.runInContext(compile(`function Summary() { return (${card}); }`), context);
  return renderToStaticMarkup(React.createElement(context.Summary));
}

test("recurring summary counts only explicit completed occurrences on the selected date", () => {
  expectSummary([
    occurrence("completed", "completed"), occurrence("partial", "partial"),
    occurrence("not-completed", "not_completed"), occurrence("unrecorded", null),
    occurrence("yesterday", "completed", "2026-11-05"), occurrence("tomorrow", "completed", "2026-11-07")
  ], 4, 1, 25);
});

test("timed and untimed occurrences of one recurring rule count independently", () => {
  expectSummary([
    occurrence("morning", "completed", selectedDate, "09:00"),
    occurrence("evening", null, selectedDate, "18:00"), occurrence("untimed", "completed")
  ], 3, 2, 67);
});

test("completion and cancellation recalculate without changing the denominator", () => {
  const items = [occurrence("one", null), occurrence("two", null)];
  expectSummary(items, 2, 0, 0);
  items[0].outcome = "completed";
  expectSummary(items, 2, 1, 50);
  items[1].outcome = "completed";
  expectSummary(items, 2, 2, 100);
  items[0].outcome = null;
  expectSummary(items, 2, 1, 50);
});

test("mixed progress weights actual occurrences, not the average of two percentages", () => {
  const result = summary([occurrence("repeat", "completed")], Array.from({ length: 9 }, (_, i) => block(String(i))));
  assert.equal(result.summaryArrangementCount, 10);
  assert.equal(result.completedArrangementCount, 1);
  assert.equal(result.summaryProgress, 10);
  assert.equal(result.summaryMinutes, 270, "unspecified recurring duration is not invented");
});

test("arranged duration sums ordinary blocks and each timed or untimed recurring occurrence", () => {
  const items = [
    occurrence("morning", "completed", selectedDate, "09:00", 20),
    occurrence("evening", null, selectedDate, "18:00", 30),
    occurrence("untimed", "partial", selectedDate, null, 15),
    occurrence("unknown", "not_completed"),
    occurrence("yesterday", "completed", "2026-11-05", "09:00", 90),
    occurrence("tomorrow", null, "2026-11-07", "09:00", 120)
  ];
  const result = summary(items, [block("overlap-one"), block("overlap-two")]);
  assert.equal(result.plannedMinutes, 60);
  assert.equal(result.summaryMinutes, 125, "overlapping blocks and repeated occurrences contribute independently");
  assert.match(render(result), /安排时长<\/span><span>125 分钟/);
  assert.doesNotMatch(render(result), /普通安排时长/);
  assert.equal(summary(items).summaryMinutes, 65, "recurring-only date retains arranged duration");
  assert.equal(summary().summaryMinutes, 0);
  items[0].outcome = null;
  items[1].outcome = "completed";
  assert.equal(summary(items).summaryMinutes, 65, "completion does not change arranged duration");
});

test("historical and future duration uses selected-date occurrence snapshots rather than current rules", () => {
  const item = { ...occurrence("saved", "completed", selectedDate, "10:00", 25), schedule_rule: { display_duration_minutes: 90 } };
  for (const today of ["2026-11-05", "2026-11-07"]) {
    assert.equal(summary([item], [block("ordinary")], selectedDate, today).summaryMinutes, 55);
  }
});

test("ordinary block and saved-review completion facts keep their existing precedence", () => {
  const result = summary([], [block("completed", "completed"), block("review-completed", "planned", { outcome: "completed" }), block("review-partial", "completed", { outcome: "partial" })]);
  assert.equal(result.plannedTaskCount, 3);
  assert.equal(result.completedPlannedTaskCount, 2);
  assert.equal(result.summaryProgress, 67);
});

test("empty dates do not imply completion and future occurrences start at zero", () => {
  expectSummary([], 0, 0, 0);
  expectSummary([occurrence("other-date", "completed", "2026-11-05")], 0, 0, 0);
  expectSummary([occurrence("future", null, "2026-11-07")], 1, 0, 0, "2026-11-07");
  const html = render(summary());
  assert.match(html, /暂无安排/);
  assert.doesNotMatch(html, /progressbar|100%|0\/0/);
});

test("historical ordinary blocks retain their original execution result", () => {
  const result = summary([occurrence("repeat", "completed")], [block("past", "completed")], selectedDate, "2026-11-07");
  assert.equal(result.summaryArrangementCount, 2);
  assert.equal(result.completedArrangementCount, 2);
  assert.equal(result.summaryProgress, 100);
});

for (const [name, ordinary, ordinaryDone, repeats, repeatsDone] of [
  ["mixed", 5, 3, 4, 2], ["ordinary only", 5, 3, 0, 0], ["recurring only", 0, 0, 4, 2],
  ["completed", 5, 5, 4, 4], ["unstarted", 3, 0, 2, 0], ["large counts", 120, 99, 80, 25]
]) test(`production A card renders one accessible combined progress: ${name}`, () => {
  const value = summary(Array.from({ length: repeats }, (_, i) => occurrence(String(i), i < repeatsDone ? "completed" : null, selectedDate, null, 20)),
    Array.from({ length: ordinary }, (_, i) => block(String(i), i < ordinaryDone ? "completed" : "planned")));
  const html = render(value);
  assert.equal((html.match(/role="progressbar"/g) || []).length, 1);
  assert.match(html, new RegExp(`aria-label="当日安排完成进度"[^>]*aria-valuenow="${value.summaryProgress}"[^>]*aria-valuetext="已完成 ${ordinaryDone + repeatsDone} 次，共 ${ordinary + repeats} 次"`));
  assert.match(html, new RegExp(`普通安排<\\/dt><dd>${ordinaryDone}/${ordinary}<\\/dd>`));
  assert.match(html, new RegExp(`重复事项<\\/dt><dd>${repeatsDone}/${repeats}<\\/dd>`));
  assert.match(html, new RegExp(`安排时长<\\/span><span>${ordinary * 30 + repeats * 20} 分钟`));
  assert.match(html, /<time dateTime="2026-11-06" title="2026-11-06">11月6日<\/time>/i);
});

test("date text follows selection rather than a hard-coded today label", () => {
  const html = render(summary(), "2027-01-02");
  assert.match(html, /2027-01-02/);
  assert.match(html, /1月2日/);
  assert.doesNotMatch(html, /11月6日|今日进度/);
});

test("approved card keeps its B header outside A statistics and omits statistics when empty", () => {
  const populated = render(summary([occurrence("repeat", "completed")], [block("ordinary")]));
  assert.match(populated, /<header class="sidebar-summary-heading">[\s\S]*?<\/header><div class="sidebar-summary-body">/);
  assert.match(populated, /class="sidebar-summary-body"[\s\S]*?sidebar-summary-reading[\s\S]*?sidebar-plan-track[\s\S]*?sidebar-summary-breakdown[\s\S]*?sidebar-summary-duration/);
  const empty = render(summary());
  assert.match(empty, /<\/header><p class="sidebar-summary-empty">暂无安排<\/p><\/section>/);
  assert.doesNotMatch(empty, /sidebar-summary-body|sidebar-summary-duration|sidebar-summary-breakdown|当天暂无安排|进度与时长/);
});

test("approved summary styles stay scoped to the card and light mode", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const approved = css.match(/\/\* Approved summary:[\s\S]*?(?=@media)/)?.[0];
  assert.ok(approved);
  const rules = [...approved.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  for (const [, selector] of rules) {
    if (selector.trim() === ".sidebar-summary-body") continue;
    assert.match(selector, /html:root:not\(\[data-mode="dark"\]\)/);
    assert.match(selector, /\.sidebar-summary-card/);
  }
  assert.match(approved, /sidebar-summary-heading \{[^}]*background: var\(--jx-surface\)/);
  assert.match(approved, /sidebar-summary-breakdown \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(approved, /sidebar-summary-empty \{[^}]*margin: 0; padding: 20px 16px/);
});
