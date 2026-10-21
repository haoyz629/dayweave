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
let locateEffect, toastActions;
function collect(node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(source));
  if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" && node.arguments[0]?.getText(source).includes('target.dataset.returnLocated = "true"')) locateEffect = node.arguments[0].getText(source);
  if (ts.isJsxAttribute(node) && node.name.getText(source) === "actions" && node.initializer?.getText(source).includes("successToast.openToday")) toastActions = node.initializer.expression.getText(source);
  ts.forEachChild(node, collect);
}
collect(source);
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const run = (code, state) => vm.runInContext(compile(code), vm.createContext(state));

test("creation toast carries the new task identity into its arrangement action", async () => {
  const calls = [];
  const state = {
    successToast: null, today: "2026-10-21",
    async latestUndo() { return { id: "undo" }; },
    setSuccessToast(value) { state.successToast = value; },
    onOpenToday(...args) { calls.push(args); }
  };
  run(functions.get("showCommittedToast"), state);
  await state.showCommittedToast("任务已创建并安排", true, "2026-10-23", "new-independent-task");
  const actions = run(`(${toastActions})`, state);
  actions.find(action => action.label === "查看安排").onClick();
  assert.deepEqual(calls, [["2026-10-23", "new-independent-task"]]);
  assert.equal(state.successToast.undoId, "undo");
  assert.match(functions.get("commitNewTask"), /showCommittedToast\([\s\S]*result.item.id\)/);
  assert.match(text, /onOpenToday=\{\(date = today, taskId\) => requestNavigation\(\{ active: "今日", date, timelineReturnContext: taskId \? \{ date, taskId \} : undefined \}\)\}/);
});

function locationHarness(overrides = {}) {
  const calls = [], frames = [];
  const target = {
    dataset: { timelineKind: "block", timelineId: "new-block" },
    querySelector() { return { focus(options) { calls.push(["focus", options]); } }; },
    getBoundingClientRect() { return { top: 700, height: 60 }; }
  };
  const scroller = {
    scrollTop: 0, clientHeight: 400, scrollHeight: 2200,
    querySelectorAll() { return [target]; },
    getBoundingClientRect() { return { top: 100 }; },
    scrollTo(options) { calls.push(["scroll", options]); }
  };
  const state = {
    timelineReturnContext: { date: "2026-10-23", taskId: "new-task" }, selectedDate: "2026-10-23", loading: false, error: null, schedule: {},
    taskBlocks: [{ id: "old-block", task_id: "old-task" }, { id: "new-block", task_id: "new-task" }],
    timelineScrollRef: { current: scroller },
    onSelectDate(date) { calls.push(["date", date]); },
    onTimelineReturnHandled() { calls.push(["handled"]); },
    window: {
      requestAnimationFrame(callback) { frames.push(callback); return 1; }, cancelAnimationFrame() {}, setTimeout() {},
      matchMedia() { return { matches: true }; }
    },
    ...overrides
  };
  for (const key of ["todayView", "followingNow", "timelineTooltip", "planDraftTimeEdit", "selection", "executionDraft", "executionMessage"]) state[`set${key[0].toUpperCase()}${key.slice(1)}`] = value => { state[key] = value; };
  const effect = run(`(${locateEffect})`, state);
  return { state, calls, target, effect, flush() { frames.splice(0).forEach(callback => callback()); } };
}

test("arrangement navigation locates, centers and highlights the new task block", () => {
  for (const context of [{ date: "2026-10-23", taskId: "new-task" }, { date: "2026-10-23", blockId: "new-block" }]) {
    const current = locationHarness({ timelineReturnContext: context });
    current.effect(); current.flush();
    assert.equal(current.state.todayView, "timeline");
    assert.equal(current.state.followingNow, false);
    assert.equal(current.target.dataset.returnLocated, "true");
    assert.deepEqual(JSON.parse(JSON.stringify(current.calls)), [["focus", { preventScroll: true }], ["scroll", { top: 430, behavior: "auto" }], ["handled"]]);
  }
});

test("arrangement location waits for date selection and loading before consuming its target", () => {
  const date = locationHarness({ selectedDate: "2026-10-21" });
  date.effect(); date.flush();
  assert.deepEqual(date.calls, [["date", "2026-10-23"]]);
  for (const flags of [{ loading: true }, { schedule: null }]) {
    const current = locationHarness(flags);
    current.effect(); current.flush();
    assert.deepEqual(current.calls, []);
  }
  const missing = locationHarness({ taskBlocks: [] });
  missing.effect(); missing.flush();
  assert.deepEqual(missing.calls, [["handled"]]);
});

test("same-date arrangement navigation refreshes schedule before looking for a new block", () => {
  const calls = [];
  const state = {
    selectedDate: "2026-10-23", normalizeTodayNavigation: active => ({ active }),
    refreshSchedule(date) { calls.push(["refresh", date]); },
    setScheduleLoading(value) { calls.push(["loading", value]); },
    setSelectedDate(date) { calls.push(["date", date]); },
    setRequestedTaskView() {}, setTimelineReturnContext(context) { calls.push(["target", context]); },
    setActive() {}, setAssistantOpen() {}, setMobileNavOpen() {}
  };
  run(functions.get("applyNavigation"), state);
  state.applyNavigation({ active: "今日", date: "2026-10-23", timelineReturnContext: { date: "2026-10-23", taskId: "new-task" } });
  assert.deepEqual(calls[0], ["refresh", "2026-10-23"]);
  assert.equal(calls[1][1].taskId, "new-task");
});

test("direct removal affects only the selected block, retains errors and respects guards", async () => {
  const make = (overrides = {}) => {
    const calls = [];
    const state = {
      selectedBlock: { id: "one-block", task_id: "task" }, canAdjustSelectedBlock: true,
      busy: false, loading: false, savingExecution: false, quickCompletingBlockId: null, savingDraggedBlock: false, timelineDrag: null, preview: null,
      async onRemoveBlock(block) { calls.push(["remove", block.id]); }, closeTimelinePanel() { calls.push(["close"]); },
      onNotify(...args) { calls.push(["error", ...args]); }, uiErrorMessage: String, ...overrides
    };
    run(functions.get("removeSelectedBlock"), state);
    return { state, calls };
  };
  const current = make(); await current.state.removeSelectedBlock();
  assert.deepEqual(current.calls, [["remove", "one-block"], ["close"]]);
  for (const flags of [{ busy: true }, { loading: true }, { savingExecution: true }, { quickCompletingBlockId: "block" }, { savingDraggedBlock: true }, { timelineDrag: {} }, { preview: {} }, { canAdjustSelectedBlock: false }]) {
    const blocked = make(flags); await blocked.state.removeSelectedBlock(); assert.deepEqual(blocked.calls, []);
  }
  const failed = make({ async onRemoveBlock() { throw "记录已变化"; } });
  await failed.state.removeSelectedBlock();
  assert.deepEqual(failed.calls, [["error", "安排未移除", "记录已变化", "review"]]);
});

test("deadline capsule fact uses an icon and keeps its complete accessible date and time", () => {
  const state = { React };
  run(`${functions.get("Icon")}\n${functions.get("TaskCapsuleFact")}`, state);
  const deadline = state.TaskCapsuleFact({ icon: "calendar", label: "截止 10月23日 09:30" });
  const markup = renderToStaticMarkup(deadline);
  assert.equal(React.Children.toArray(deadline.props.children).at(-1), "10月23日 09:30");
  assert.equal(deadline.props["aria-label"], "截止 10月23日 09:30");
  assert.equal(deadline.props.title, "截止 10月23日 09:30");
  assert.match(markup, /task-capsule-deadline/);
  assert.match(markup, /<svg/);
  const earliest = state.TaskCapsuleFact({ icon: "calendar", label: "最早 今天 09:30" });
  assert.equal(React.Children.toArray(earliest.props.children).at(-1), "最早 今天 09:30");
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  assert.match(css, /\.task-capsule-content:not\(\.recurring\) \.task-capsule-facts \{ flex-wrap: nowrap; gap: 6px; \}/);
  assert.match(css, /\.task-capsule-facts > span \{ flex-shrink: 0; \}/);
});
