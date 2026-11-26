import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatSidebarSummaryDuration, visibleTaskScheduleBlocks, visibleUntimedTasksForDate } from "./task-result.ts";

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
const block = (id, execution_status = "planned", review = null, task_id = "same-task") => ({
  id, task_id, task_status: "scheduled", execution_status, review,
  starts_at: `${selectedDate}T09:00:00+08:00`, ends_at: `${selectedDate}T09:30:00+08:00`
});
const untimedTask = (id, status = "scheduled", { start = selectedDate, end = selectedDate, result_date = null, deleted_at = null, earliest_start_time = null } = {}) => ({
  id, status, deleted_at, result_date,
  earliest_start_date: start, due_date: end,
  earliest_start_at: null, due_at: null,
  earliest_start_time, due_time: null
});
function summary(recurringOccurrences = [], task_blocks = [], tasks = [], date = selectedDate, today = date) {
  return JSON.parse(vm.runInNewContext(
    compile(`${calculation}\nJSON.stringify({ summaryTaskBlocksCount: summaryTaskBlocks.length, summaryUntimedCount: summaryUntimedTasks.length, recurringCount: summaryRecurringOccurrences.length, plannedMinutes, summaryMinutes, summaryArrangementCount, completedArrangementCount, summaryPendingCount, summaryProgress });`),
    { recurringOccurrences, tasks, daySchedule: { task_blocks }, selectedDate: date, today, visibleTaskScheduleBlocks, visibleUntimedTasksForDate }
  ));
}
function expectSummary(items, total, completed, progress, date = selectedDate) {
  const value = summary(items, [], [], date);
  assert.equal(value.recurringCount, total);
  assert.equal(value.summaryArrangementCount, total);
  assert.equal(value.completedArrangementCount, completed);
  assert.equal(value.summaryPendingCount, total - completed);
  assert.equal(value.summaryProgress, progress);
}
function render(value, date = selectedDate) {
  const context = vm.createContext({ React, ...value, selectedDate: date, formatSidebarSummaryDuration });
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

test("untimed ordinary tasks join unified progress, respect result_date, and avoid double-counting scheduled blocks", () => {
  const result = summary(
    [occurrence("rep-untimed", "completed")],
    [block("blk-1", "planned", null, "timed-task")],
    [
      untimedTask("u-done", "done", { result_date: selectedDate }),
      untimedTask("u-pending", "scheduled"),
      untimedTask("u-cross", "scheduled", { start: "2026-11-05", end: "2026-11-08" }),
      untimedTask("u-done-yesterday", "done", { start: "2026-11-05", end: "2026-11-08", result_date: "2026-11-05" }),
      untimedTask("u-deleted", "deleted", { deleted_at: "2026-11-06T08:00:00+08:00" }),
      untimedTask("timed-task", "scheduled", { earliest_start_time: null }),
      untimedTask("has-time", "scheduled", { earliest_start_time: "14:00" })
    ]
  );
  assert.equal(result.summaryUntimedCount, 3);
  assert.equal(result.summaryArrangementCount, 5);
  assert.equal(result.completedArrangementCount, 2);
  assert.equal(result.summaryPendingCount, 3);
  assert.equal(result.summaryProgress, 40);
  assert.equal(result.summaryMinutes, 30);
});

test("untimed-only dates display 无固定时段 instead of 0 分钟", () => {
  const result = summary([], [], [untimedTask("u-1", "done"), untimedTask("u-2", "scheduled")]);
  assert.equal(result.summaryArrangementCount, 2);
  assert.equal(result.completedArrangementCount, 1);
  assert.equal(result.summaryPendingCount, 1);
  assert.equal(result.summaryMinutes, 0);
  const html = render(result);
  assert.match(html, /待完成<\/span><strong>1 项/);
  assert.match(html, /安排时长<\/span><strong class="is-quiet">无固定时段/);
  assert.doesNotMatch(html, /0 分钟/);
});

test("mixed progress weights actual tasks equally without splitting by type", () => {
  const result = summary([occurrence("repeat", "completed")], Array.from({ length: 9 }, (_, i) => block(String(i))));
  assert.equal(result.summaryArrangementCount, 10);
  assert.equal(result.completedArrangementCount, 1);
  assert.equal(result.summaryPendingCount, 9);
  assert.equal(result.summaryProgress, 10);
  assert.equal(result.summaryMinutes, 270, "unspecified recurring duration is not invented");
});

test("arranged duration sums ordinary blocks and recurring durations and formats compactly", () => {
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
  assert.equal(result.summaryMinutes, 125);
  assert.match(render(result), /安排时长<\/span><strong[^>]*>2 小时 5 分/);
  assert.doesNotMatch(render(result), /普通安排|重复事项/);
  assert.equal(summary(items).summaryMinutes, 65);
  assert.equal(summary().summaryMinutes, 0);
  items[0].outcome = null;
  items[1].outcome = "completed";
  assert.equal(summary(items).summaryMinutes, 65, "completion does not change arranged duration");
  assert.equal(formatSidebarSummaryDuration(45), "45 分钟");
  assert.equal(formatSidebarSummaryDuration(120), "2 小时");
});

test("historical and future duration uses selected-date occurrence snapshots rather than current rules", () => {
  const item = { ...occurrence("saved", "completed", selectedDate, "10:00", 25), schedule_rule: { display_duration_minutes: 90 } };
  for (const today of ["2026-11-05", "2026-11-07"]) {
    assert.equal(summary([item], [block("ordinary")], [], selectedDate, today).summaryMinutes, 55);
  }
});

test("ordinary block and saved-review completion facts keep their existing precedence", () => {
  const result = summary([], [block("completed", "completed"), block("review-completed", "planned", { outcome: "completed" }), block("review-partial", "completed", { outcome: "partial" })]);
  assert.equal(result.summaryTaskBlocksCount, 3);
  assert.equal(result.completedArrangementCount, 2);
  assert.equal(result.summaryPendingCount, 1);
  assert.equal(result.summaryProgress, 67);
});

test("empty dates do not imply completion and keep concise 暂无安排 state", () => {
  expectSummary([], 0, 0, 0);
  expectSummary([occurrence("other-date", "completed", "2026-11-05")], 0, 0, 0);
  expectSummary([occurrence("future", null, "2026-11-07")], 1, 0, 0, "2026-11-07");
  const html = render(summary());
  assert.match(html, /<\/header><p class="sidebar-summary-empty">暂无安排<\/p><\/section>/);
  assert.doesNotMatch(html, /progressbar|100%|0\/0|sidebar-summary-body|sidebar-summary-stats/);
});

test("historical ordinary blocks retain their original execution result", () => {
  const result = summary([occurrence("repeat", "completed")], [block("past", "completed")], [], selectedDate, "2026-11-07");
  assert.equal(result.summaryArrangementCount, 2);
  assert.equal(result.completedArrangementCount, 2);
  assert.equal(result.summaryPendingCount, 0);
  assert.equal(result.summaryProgress, 100);
});

for (const [name, ordinary, ordinaryDone, untimed, untimedDone, repeats, repeatsDone] of [
  ["mixed", 4, 2, 2, 1, 3, 1], ["ordinary timed only", 5, 3, 0, 0, 0, 0], ["untimed only", 0, 0, 3, 2, 0, 0],
  ["completed", 3, 3, 2, 2, 1, 1], ["unstarted", 2, 0, 1, 0, 2, 0], ["large counts", 100, 75, 20, 15, 80, 34]
]) test(`scheme A card renders unified progress without type split: ${name}`, () => {
  const total = ordinary + untimed + repeats;
  const done = ordinaryDone + untimedDone + repeatsDone;
  const value = summary(
    Array.from({ length: repeats }, (_, i) => occurrence(`r${i}`, i < repeatsDone ? "completed" : null, selectedDate, null, 20)),
    Array.from({ length: ordinary }, (_, i) => block(`b${i}`, i < ordinaryDone ? "completed" : "planned", null, `t${i}`)),
    Array.from({ length: untimed }, (_, i) => untimedTask(`u${i}`, i < untimedDone ? "done" : "scheduled"))
  );
  const html = render(value);
  assert.equal((html.match(/role="progressbar"/g) || []).length, 1);
  assert.match(html, new RegExp(`aria-label="当日任务完成进度"[^>]*aria-valuenow="${value.summaryProgress}"[^>]*aria-valuetext="已完成 ${done} 项，共 ${total} 项"`));
  assert.match(html, new RegExp(`待完成<\\/span><strong>${total - done} 项<\\/strong>`));
  assert.match(html, /class="sidebar-summary-stats"/);
  assert.doesNotMatch(html, /普通安排|重复事项|sidebar-summary-breakdown/);
  if (value.summaryProgress === 100) assert.match(html, /class="sidebar-summary-percent is-done"/);
  assert.match(html, /<time dateTime="2026-11-06" title="2026-11-06">11月6日<\/time>/i);
});

test("date text follows selection rather than a hard-coded today label", () => {
  const html = render(summary(), "2027-01-02");
  assert.match(html, /2027-01-02/);
  assert.match(html, /1月2日/);
  assert.doesNotMatch(html, /11月6日|今日进度/);
});

test("approved summary styles stay scoped to the card and light mode", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const colors = readFileSync(new URL("./color-system.css", import.meta.url), "utf8");
  const approved = css.match(/\/\* Approved summary:[\s\S]*?(?=@media)/)?.[0];
  assert.ok(approved);
  const rules = [...approved.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  for (const [, selector] of rules) {
    if (selector.trim() === ".sidebar-summary-body") continue;
    assert.match(selector, /html:root:not\(\[data-mode="dark"\]\)/);
    assert.match(selector, /\.sidebar-summary-card/);
  }
  assert.match(approved, /sidebar-summary-stats \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(colors, /html:root:not\(\[data-mode="dark"\]\) \.sidebar-summary-card \.sidebar-summary-stats \{/);
  assert.match(colors, /html:root:not\(\[data-mode="dark"\]\) \.sidebar-summary-card \.sidebar-summary-stat \{/);
  assert.match(approved, /sidebar-summary-empty \{[^}]*margin: 0; padding: 20px 16px/);
});
