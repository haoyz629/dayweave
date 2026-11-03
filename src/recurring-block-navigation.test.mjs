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
let requestedEffect, returnEffect;
function collect(node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(source));
  if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect") {
    const code = node.arguments[0]?.getText(source);
    if (code?.includes("handledRequestedView.current === requestedView")) requestedEffect = code;
    if (code?.includes("const block = timelineReturnContext.occurrenceId")) returnEffect = code;
  }
  ts.forEachChild(node, collect);
}
collect(source);
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
function load(names, state) {
  vm.createContext(state);
  vm.runInContext(compile(names.map(name => functions.get(name)).join("\n")), state);
  return state;
}
function setters(state, keys) {
  for (const key of keys) state[`set${key[0].toUpperCase()}${key.slice(1)}`] = value => { state[key] = value; };
}
const item = { id: "occurrence-2", recurring_item_id: "series-2" };

test("view recurring task sends the series and original occurrence without persisting edits", () => {
  for (const blocked of [false, true]) {
    const calls = [];
    const state = { savingRecurringChange: blocked, pendingRecurringChange: null, selectedDate: "2026-10-29", timelineSelectionAnchorRef: { current: {} }, onOpenRecurringItem: (...args) => calls.push(args) };
    setters(state, ["selection", "recurringTimeEdit", "timelineTooltip"]);
    load(["openTimelineRecurringItem"], state).openTimelineRecurringItem(item);
    assert.equal(calls.length, blocked ? 0 : 1);
    if (!blocked) {
      assert.equal(calls[0][0], "series-2");
      assert.equal(calls[0][1].date, "2026-10-29");
      assert.equal(calls[0][1].occurrenceId, "occurrence-2");
      assert.equal(state.recurringTimeEdit, null);
      assert.equal(state.timelineSelectionAnchorRef.current, null);
    }
  }
});

test("requested recurring navigation selects the exact active, ended or recycled series", () => {
  for (const status of ["active", "paused", "ended", "deleted"]) {
    const target = { id: "series-2", status, deleted_at: status === "deleted" ? "2026-10-29" : null };
    const state = { requestedView: { recurringItemId: target.id }, handledRequestedView: { current: null }, taskViewInitialized: { current: false }, recurringItems: [{ id: "series-1" }, target] };
    setters(state, ["view", "creating", "selectedId", "draft", "selectedRecurringId", "search", "tagFilter", "compactTaskEditorDismissed", "taskViewReady", "filterMenuOpen"]);
    vm.runInNewContext(compile(`(${requestedEffect})()`), state);
    assert.equal(state.selectedRecurringId, target.id);
    assert.equal(state.view, status === "deleted" ? "deleted" : "recurring");
    assert.equal(state.creating, false);
    assert.equal(state.selectedId, null);
    assert.equal(state.search, "");
    assert.equal(state.tagFilter, "");
    assert.equal(state.handledRequestedView.current, state.requestedView);
  }
});

test("returning locates, focuses and centers the original recurring block, not a normal block", () => {
  let focused = false, handled = false;
  const target = { dataset: { timelineKind: "recurring", timelineId: item.id }, querySelector: () => ({ focus() { focused = true; } }), getBoundingClientRect: () => ({ top: 400, height: 100 }) };
  const scroller = { scrollTop: 200, clientHeight: 500, scrollHeight: 1800, getBoundingClientRect: () => ({ top: 100 }), querySelectorAll: () => [{ dataset: { timelineKind: "block", timelineId: item.id } }, target], scrollTo(options) { this.scrollTop = options.top; } };
  let frame, timeout;
  const state = { timelineReturnContext: { date: "2026-10-29", occurrenceId: item.id }, selectedDate: "2026-10-29", loading: false, schedule: {}, error: null, recurringOccurrences: [item], taskBlocks: [], timelineScrollRef: { current: scroller }, onTimelineReturnHandled() { handled = true; }, window: { requestAnimationFrame(fn) { frame = fn; return 1; }, cancelAnimationFrame() {}, setTimeout(fn) { timeout = fn; }, matchMedia: () => ({ matches: true }) } };
  setters(state, ["todayView", "followingNow", "timelineTooltip", "planDraftTimeEdit", "selection", "executionDraft", "executionMessage"]);
  vm.runInNewContext(compile(`(${returnEffect})()`), state);
  frame();
  assert.equal(state.todayView, "timeline");
  assert.equal(state.followingNow, false);
  assert.equal(focused, true);
  assert.equal(handled, true);
  assert.equal(scroller.scrollTop, 300);
  assert.equal(target.dataset.returnLocated, "true");
  timeout();
  assert.equal(target.dataset.returnLocated, undefined);
});

test("recurring edit header returns to timeline while ordinary edit still returns to details", () => {
  const state = load(["TaskPageHeader"], { React, Icon: () => null, recurringItemStatusLabel: () => "进行中", taskListStatus: task => task.status, statusCopy: { scheduled: "已安排" } });
  for (const [props, expected] of [
    [{ task: { frequency: "daily", status: "active" }, editing: true, backLabel: "返回今日计划中的任务块" }, "返回今日计划中的任务块"],
    [{ task: { status: "scheduled" }, editing: true }, "返回任务详情"]
  ]) {
    let called = false;
    const tree = state.TaskPageHeader({ ...props, busy: true, onBack() { called = true; } });
    const button = tree.props.children[0].props.children[0];
    assert.equal(button.props["aria-label"], expected);
    assert.equal(button.props.disabled, true);
    button.props.onClick();
    assert.equal(called, true);
  }
});

test("all timeline task types receive tags and empty tags produce no reserved row", () => {
  const state = load(["TimelineTaskContent"], { React, TimelineTaskFacts: () => null, TaskTagList: ({ tags }) => React.createElement("span", null, tags.join("、")) });
  const props = { title: "带标签的任务", range: "09:00–11:00", duration: "2h", type: "recurring", url: "", note: "" };
  assert.match(renderToStaticMarkup(state.TimelineTaskContent({ ...props, tags: ["工作", "重点"] })), /timeline-task-tags.*工作、重点/);
  assert.doesNotMatch(renderToStaticMarkup(state.TimelineTaskContent(props)), /timeline-task-tags/);
  assert.equal((text.match(/<TimelineTaskContent[^>]+tags=\{/g) ?? []).length, 3);
  assert.equal((text.match(/上下拖动调整时间·点击精确编辑/g) ?? []).length, 3);
  assert.match(text, /onClick=\{\(\) => openTimelineRecurringItem\(selectedRecurringOccurrence\)\}/);
});
