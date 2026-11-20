import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const text = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map();
let recurringHeader;
function collect(node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(source));
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "header" && node.getText(source).includes('aria-label="关闭重复任务块"')) recurringHeader = node.getText(source);
  ts.forEachChild(node, collect);
}
collect(source);
const compile = code => ts.transpileModule(code, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;

test("completed recurring header reuses the normal dialog heading and status badge", () => {
  const state = { React, selectedRecurringOccurrence: { title: "重复事项", outcome: "completed" }, recurringTimeEdit: null, savingRecurringChange: false, quickCompletingBlockId: null, closeTimelinePanel() {}, Icon: () => null, CopySeparator: () => null };
  const html = renderToStaticMarkup(vm.runInNewContext(compile(`(${recurringHeader})`), state));
  assert.match(html, /class="execution-dialog-heading"/);
  assert.match(html, /class="execution-status-badge status-completed"/);
  assert.match(html, /本次已完成/);
});

test("completed recurring readonly facts and footer use the ordinary result shell", () => {
  const state = { React, useState: initial => [initial, () => {}], useEffect() {} };
  vm.runInNewContext(compile(["CompletedBlockRecord", "RecurringOccurrenceResult"].map(name => functions.get(name)).join("\n")), state);
  const tree = state.RecurringOccurrenceResult({ occurrence: { outcome: "completed", review_notes: "本次笔记" }, writable: false, disabled: false, onCancel() {} });
  const html = renderToStaticMarkup(tree);
  assert.match(html, /class="completed-record"/);
  assert.match(html, /本次笔记/);
  assert.match(html, /class="execution-capture-footer completed-record-footer"/);
  assert.match(html, />关闭</);
  assert.doesNotMatch(html, /floating-capture-fact|>取消<|>保存</);
  assert.doesNotMatch(html, /尚无执行记录|未来日期暂不可记录/);
});

test("note-only task history names the action instead of reporting an incomplete result", () => {
  const state = { React, Icon: () => null, taskListStatus: () => "scheduled" };
  vm.runInNewContext(compile(["taskDisplayHistory", "TaskStatusHistory"].map(name => functions.get(name)).join("\n")), state);
  const html = renderToStaticMarkup(state.TaskStatusHistory({ task: { id: "t", created_at: "2026-11-01", earliest_start_date: "2026-11-01", due_date: "2026-11-01" }, metadata: { history: [{ id: "note", kind: "note", status: null, plan_date: "2026-11-01", occurred_at: "2026-11-01T12:00:00+08:00", note: "一条进展" }] }, busy: false }));
  assert.match(html, /<strong>随手记<\/strong>/);
  assert.match(html, /一条进展/);
  assert.doesNotMatch(html, /任务未完成|状态更新为/);
});

test("save deltas stay independent at the same timestamp and distinguish clearing a note", () => {
  const state = { React, Icon: () => null, taskListStatus: () => "scheduled" };
  vm.runInNewContext(compile(["taskDisplayHistory", "TaskStatusHistory"].map(name => functions.get(name)).join("\n")), state);
  const date = "2026-11-01";
  const task = { id: "t", created_at: date, earliest_start_date: date, due_date: date };
  const event = { occurred_at: `${date}T12:00:00+08:00`, plan_date: date, status: null, note: null };
  const history = [
    { ...event, id: "capture:1", kind: "note", note: "111222" },
    { ...event, id: "capture:2", kind: "execution", status: "done" },
    { ...event, id: "capture:3", kind: "cleared", status: "scheduled" },
    { ...event, id: "capture:4", kind: "note", note_cleared: true },
  ];
  const html = renderToStaticMarkup(state.TaskStatusHistory({ task, metadata: { history }, busy: false }));
  assert.equal((html.match(/<li /g) ?? []).length, 4);
  assert.equal((html.match(/111222/g) ?? []).length, 1);
  assert.match(html, /<strong>随手记<\/strong>.*111222.*<strong>任务已完成<\/strong>.*<strong>已取消任务完成<\/strong>.*已清空随手记/);
  const independent = { ...event, id: "independent", kind: "status", status: "done" };
  assert.equal(state.taskDisplayHistory(task, [history[1], independent]).length, 2);
});

function navigationHarness(context, dirty = false) {
  const state = { active: "任务", timelineReturnContext: context, selectedDate: "2026-11-01", planPreview: null, taskEditorDirty: dirty, settingsEditorDirty: false, normalizeTodayNavigation: active => ({ active }), refreshSchedule() {}, setScheduleLoading() {}, setSelectedDate(date) { state.selectedDate = date; }, setRequestedTaskView() {}, setTimelineReturnContext(value) { state.timelineReturnContext = value; }, setActive(value) { state.active = value; }, setMobileNavOpen() {}, setPendingNavigation(value) { state.pendingNavigation = value; } };
  vm.runInNewContext(compile(["requestNavigation", "applyNavigation", "resolvePendingNavigation"].map(name => functions.get(name)).join("\n")), state);
  return state;
}

test("Today navigation preserves the exact normal or recurring return target", () => {
  for (const target of [{ blockId: "block-2", taskId: "task" }, { occurrenceId: "occ-2" }]) {
    const context = { date: "2026-11-01", ...target };
    const state = navigationHarness(context);
    state.requestNavigation({ active: "今日" });
    assert.equal(state.active, "今日");
    assert.equal(state.timelineReturnContext, context);
  }
});

test("Today return honors dirty protection, explicit destinations and context lifetime", () => {
  const context = { date: "2026-11-01", blockId: "block" };
  const state = navigationHarness(context, true);
  state.requestNavigation({ active: "今日" });
  assert.equal(state.active, "任务");
  assert.equal(state.pendingNavigation.timelineReturnContext, context);
  state.resolvePendingNavigation(false);
  assert.equal(state.active, "任务");
  assert.equal(state.timelineReturnContext, context);
  state.requestNavigation({ active: "今日" });
  state.resolvePendingNavigation(true);
  assert.equal(state.timelineReturnContext, context);
  const explicit = navigationHarness(context);
  explicit.requestNavigation({ active: "今日", date: "2026-11-05", timelineReturnContext: { date: "2026-11-05", taskId: "other" } });
  assert.equal(explicit.timelineReturnContext.taskId, "other");
  const dateOnly = navigationHarness(context);
  dateOnly.requestNavigation({ active: "今日", date: "2026-11-05" });
  assert.equal(dateOnly.timelineReturnContext, null);
  const unrelated = navigationHarness(context);
  unrelated.requestNavigation({ active: "设置" });
  assert.equal(unrelated.timelineReturnContext, null);
  unrelated.requestNavigation({ active: "今日" });
  assert.equal(unrelated.timelineReturnContext, null);
});

test("timed and untimed historical recurring records share compact A across every series lifecycle", () => {
  for (const lifecycle of ["active", "paused", "ended", "deleted", "missing-rule"]) for (const display_time of ["09:00", null]) {
    const calls = [];
    const state = { React, useState: initial => [initial, () => {}], useEffect() {} };
    vm.runInNewContext(compile(["CompletedBlockRecord", "RecurringOccurrenceResult"].map(name => functions.get(name)).join("\n")), state);
    const tree = state.RecurringOccurrenceResult({ occurrence: { id: lifecycle, display_time, outcome: "completed", review_notes: "本次原始记录" }, writable: false, disabled: false, onCancel() { calls.push("close"); }, onSave() { calls.push("write"); } });
    const html = renderToStaticMarkup(tree);
    assert.match(html, /class="completed-record"/);
    assert.match(html, /本次原始记录/);
    assert.match(html, /完成记录只读，不可修改/);
    assert.doesNotMatch(html, /floating-capture-fact|>保存<|>取消<|<textarea|data-outcome/);
    const record = tree.type(tree.props);
    React.Children.toArray(record.props.children).find(child => child.type === "footer").props.children[1].props.onClick();
    assert.deepEqual(calls, ["close"]);
  }
});

test("hidden readonly recurring result cannot style or expose a time-editor footer", () => {
  const state = { React, useState: initial => [initial, () => {}], useEffect() {} };
  vm.runInNewContext(compile(["CompletedBlockRecord", "RecurringOccurrenceResult"].map(name => functions.get(name)).join("\n")), state);
  const tree = state.RecurringOccurrenceResult({ occurrence: { outcome: "completed" }, writable: false, hidden: true, disabled: true, onCancel() {} });
  const html = renderToStaticMarkup(tree);
  assert.match(html, /class="completed-record" hidden=""/);
  assert.match(html, /class="quiet-button" disabled=""/);
});
