import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const calculation = app
  .split("\n")
  .slice(
    app.split("\n").findIndex((line) => line.includes("const summaryRecurringOccurrences =")),
    app.split("\n").findIndex((line) => line.includes("const summaryRecurringOccurrences =")) + 4,
  )
  .join("\n");
assert.ok(calculation.includes("const recurringProgress ="));
const selectedDate = "2026-11-06";
const occurrence = (id, outcome, date = selectedDate, display_time = null) => ({
  id, recurring_item_id: "same-recurring-rule", occurrence_date: date, outcome, display_time
});

function summary(recurringOccurrences, date = selectedDate) {
  return vm.runInNewContext(`${calculation}\nJSON.stringify({ recurringItemCount, completedRecurringItemCount, recurringProgress })`, { recurringOccurrences, selectedDate: date });
}
function expectSummary(items, total, completed, progress, date = selectedDate) {
  assert.deepEqual(JSON.parse(summary(items, date)), { recurringItemCount: total, completedRecurringItemCount: completed, recurringProgress: progress });
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

test("empty dates follow the existing 0 / 0 full-progress convention", () => {
  expectSummary([], 0, 0, 100);
  expectSummary([occurrence("other-date", "completed", "2026-11-05")], 0, 0, 100);
  expectSummary([occurrence("future", null, "2026-11-07")], 1, 0, 0, "2026-11-07");
});

test("production sidebar renders separate accessible progress and retains task minutes", () => {
  const card = app.match(/<section className="sidebar-summary-card"[\s\S]*?<\/section>/)?.[0];
  assert.ok(card);
  const context = vm.createContext({ React, planProgress: 60, completedPlannedTaskCount: 3, plannedTaskCount: 5, plannedMinutes: 90,
    recurringProgress: 50, completedRecurringItemCount: 2, recurringItemCount: 4 });
  vm.runInContext(ts.transpileModule(`function Summary() { return (${card}); }`, { compilerOptions: { jsx: ts.JsxEmit.React } }).outputText, context);
  const html = renderToStaticMarkup(React.createElement(context.Summary));
  assert.match(html, /任务计划<\/span><strong>3 \/ 5<\/strong>/);
  assert.match(html, /重复事项<\/span><strong>2 \/ 4<\/strong>/);
  assert.match(html, /90 分钟已安排/);
  assert.match(html, /aria-label="任务计划完成进度"[^>]*aria-valuenow="60"/);
  assert.match(html, /aria-label="重复事项完成进度"[^>]*aria-valuenow="50"[^>]*aria-valuetext="已完成 2 次，共 4 次"/);
  assert.equal((html.match(/role="progressbar"/g) || []).length, 2);
  assert.match(html, /完成50%/);
});
