import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { recurringClockRange, recurringRangeInput } from "./recurring-schedule.ts";
import { compactBlockDuration } from "./task-block-display.ts";

const text = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map();
let requestedEffect, returnEffect, panelClass, layerClass, recurringPanel;
function collect(node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(source));
  if (ts.isJsxAttribute(node) && node.name.text === "className" && node.initializer && ts.isJsxExpression(node.initializer)) {
    const code = node.initializer.expression?.getText(source);
    if (code?.startsWith("`timeline-floating-panel$")) panelClass = code;
    if (code?.startsWith("`timeline-floating-layer$")) layerClass = code;
  }
  if (ts.isConditionalExpression(node) && node.condition.getText(source) === "selectedRecurringOccurrence && recurringTimeEdit") recurringPanel = node.whenTrue.getText(source);
  if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect") {
    const code = node.arguments[0]?.getText(source);
    if (code?.includes("handledRequestedView.current === requestedView")) requestedEffect = code;
    if (code?.includes("const block = timelineReturnContext.occurrenceId")) returnEffect = code;
  }
  ts.forEachChild(node, collect);
}
collect(source);
const fieldsSource = ts.createSourceFile("task-time-range-fields.tsx", readFileSync(new URL("./task-time-range-fields.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
functions.set("TaskTimeRangeFields", fieldsSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "TaskTimeRangeFields").getText(fieldsSource).replace("export ", ""));
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

test("recurring click dialog shares the ordinary task shell and footer without changing form submission", () => {
  const state = { selectedRecurringOccurrence: item, selectedBlock: null, planDraftTimeEdit: null };
  assert.equal(vm.runInNewContext(compile(`(${panelClass});`), state), "timeline-floating-panel task-block-editor");
  assert.equal(vm.runInNewContext(compile(`(${layerClass});`), state), "timeline-floating-layer is-block-editor");
  for (const editable of [true, false]) {
    const context = { React, selectedRecurringOccurrence: { ...item, title: "重复任务" }, recurringTimeEdit: { date: "2026-11-03", time: "09:00", duration: 120, error: "" }, today: "2026-11-03", isPastDate: !editable, savingRecurringChange: false, pendingRecurringChange: null, Icon: () => null, CopySeparator: () => null, closeTimelinePanel() {}, openTimelineRecurringItem() {}, saveRecurringTimeEdit() {}, canEditRecurringOccurrence: () => editable, recurringTimeRange: () => "09:00–11:00" };
    context.RecurringBlockTimeEditor = () => null;
    context.setRecurringTimeEdit = () => {};
    const html = renderToStaticMarkup(vm.runInNewContext(compile(`(${recurringPanel});`), context));
    assert.match(html, /class="execution-plan-time"/);
    assert.match(html, /class="execution-time-value"/);
    assert.match(html, /class="execution-open-task"/);
    assert.doesNotMatch(html, /floating-outcomes|execution-remove-today/);
    if (editable) {
      assert.match(html, /<form id="recurring-block-time-form"/);
      assert.match(html, /<\/form><footer class="execution-capture-footer">/);
      assert.match(html, /type="submit" form="recurring-block-time-form" class="primary-action"/);
    } else {
      assert.doesNotMatch(html, /<form|type="submit"/);
      assert.match(html, /历史任务块保持只读/);
    }
  }
});

test("recurring date grid optionally blocks past dates without changing existing callers", () => {
  const state = load(["ScheduleDateGrid"], { React });
  const props = { cells: [{ key: "2026-11-02", day: 2, inMonth: true }, { key: "2026-11-03", day: 3, inMonth: true }], today: "2026-11-03", start: "2026-11-03", end: "2026-11-03", range: { start: "2026-11-03", end: "2026-11-03", preview: false }, onSelect() {}, onHover() {} };
  assert.deepEqual(state.ScheduleDateGrid(props).props.children.map(button => button.props.disabled), [undefined, undefined]);
  assert.deepEqual(state.ScheduleDateGrid({ ...props, minDate: props.today }).props.children.map(button => button.props.disabled), [true, false]);
});

test("recurring block editor reuses an overlay calendar and compact midnight-aware inputs", () => {
  const slots = []; let cursor = 0, focused = false, value = { date: "2026-11-03", time: "23:30", duration: 30, error: "旧错误" };
  const state = load(["RecurringBlockTimeEditor"], {
    React, Icon: () => null, ScheduleDateGrid: () => null, BlockEditorTimeRangeRail: () => null,
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], next => { slots[index] = next; }]; },
    useRef: () => ({ current: { focus() { focused = true; } } }), useMemo: fn => fn(), useLayoutEffect() {}, calendarCells: () => [],
    pickerDateLabel: date => date, recurringClockRange, recurringRangeInput, formatWorkloadMinutes: minutes => `${minutes} 分钟`
  });
  const render = () => { cursor = 0; return state.RecurringBlockTimeEditor({ value, today: "2026-11-03", onChange: next => { value = next; } }); };
  let tree = render();
  const dateButton = () => tree.props.children[0].props.children[1];
  assert.equal(dateButton().props["aria-expanded"], false);
  dateButton().props.onClick(); tree = render();
  assert.equal(dateButton().props["aria-expanded"], true);
  const grid = tree.props.children[0].props.children[2].props.children[2];
  assert.equal(grid.props.minDate, "2026-11-03");
  grid.props.onSelect("2026-11-02"); assert.equal(value.date, "2026-11-03");
  grid.props.onSelect("2026-11-05"); tree = render();
  assert.equal(value.date, "2026-11-05"); assert.equal(value.error, ""); assert.equal(focused, true);
  assert.equal(dateButton().props["aria-expanded"], false);
  dateButton().props.onClick(); tree = render();
  let prevented = false, stopped = false;
  tree.props.onKeyDown({ key: "Escape", preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } }); tree = render();
  assert.equal(prevented && stopped, true); assert.equal(dateButton().props["aria-expanded"], false);
  const rail = tree.props.children[1];
  assert.equal(rail.props.start, "23:30"); assert.equal(rail.props.end, "24:00");
  assert.equal(rail.props.minimumDuration, 1); assert.equal(rail.props.maxMinute, 1440); assert.equal(rail.props.allowMidnightEnd, true);
  assert.equal(rail.props.inputsOnly, true); assert.equal(rail.props.describedBy, undefined);
  rail.props.onChange({ start: "23:59", end: "24:00" });
  assert.equal(value.time, "23:59"); assert.equal(value.duration, 1); assert.equal(value.date, "2026-11-05");
});

test("inputs-only range keeps presets but omits the rail and edge labels while defaults stay intact", () => {
  const state = load(["TaskTimeRangeFields", "BlockEditorTimeRangeRail"], {
    React, compactBlockDuration, Fragment: React.Fragment, Icon: () => null, useRef: React.useRef, useState: React.useState, useEffect: React.useEffect,
    MIN_TASK_BLOCK_MINUTES: 15,
    clockMinutes: value => { const [h, m] = value.split(":").map(Number); return h * 60 + m; },
    minutesClock: minute => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`,
    focusedTimeRangePresentation: () => ({ kind: "continuous", window: { start: 480, end: 720 } }),
    continuousTimeRangeGeometry: () => ({ startPosition: 0, endPosition: 100, midpointPosition: 50 }),
    continuousTimeScaleMarks: () => [], formatWorkloadMinutes: value => `${value} m`
  });
  for (const inputsOnly of [false, true]) {
    const html = renderToStaticMarkup(React.createElement(state.BlockEditorTimeRangeRail, { start: "09:00", end: "11:00", onChange() {}, inputsOnly }));
    assert.equal((html.match(/type="text"/g) ?? []).length, 2);
    if (inputsOnly) {
      assert.doesNotMatch(html, /time-rail-surface|time-duration-presets|time-range-marker|>开始<|>结束</);
      assert.match(html, /task-time-range-presets/); assert.match(html, /推荐时长/);
      assert.match(html, /aria-label="输入开始时间"/); assert.match(html, /aria-label="输入结束时间"/);
    } else {
      assert.match(html, /time-rail-surface/); assert.match(html, /time-duration-presets/); assert.match(html, /time-range-marker/);
    }
  }
});
