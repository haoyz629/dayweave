import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = ts.createSourceFile("App.tsx", readFileSync(new URL("./App.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const effects = [];
let panelKeyDown, closePanel;
function collect(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "closeTimelinePanel") closePanel = node.getText(source);
  if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect"
    && (node.arguments[0]?.getText(source).includes("if (!timelineTooltip) return;") || node.arguments[0]?.getText(source).includes("const returnToMonthOnEscape"))) {
    effects.push({ body: node.arguments[0].getText(source), deps: node.arguments[1].getText(source) });
  }
  if (ts.isJsxOpeningElement(node) && node.attributes.properties.some(attr => attr.name?.getText(source) === "id" && attr.initializer?.getText(source) === '"timeline-context-panel"')) {
    panelKeyDown = node.attributes.properties.find(attr => attr.name?.getText(source) === "onKeyDown").initializer.expression.getText(source);
  }
  ts.forEachChild(node, collect);
}
collect(source);
assert.equal(effects.length, 2);
assert.ok(panelKeyDown);
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function harness(overrides = {}) {
  const host = new EventTarget(), installed = [], calls = [];
  class Element {
    constructor(parent = null) { this.parent = parent; }
    contains(target) { for (let node = target; node; node = node.parent) if (node === this) return true; return false; }
    matches() { return false; }
    focus() { state.document.activeElement = this; calls.push("focus"); }
  }
  const trigger = new Element(), card = new Element();
  const state = {
    window: host, HTMLElement: Element, Node: Element, visible: true, todayView: "timeline", selection: null, timelineTooltip: null,
    document: { activeElement: trigger, querySelector: () => state.selection || state.modal || null },
    timelineTooltipCardRef: { current: card }, timelineTooltipFocusRef: { current: trigger }, timelineTooltipTriggerRef: { current: trigger },
    setTimelineTooltip(value) { state.timelineTooltip = value; }, hideTimelineTooltip() { state.timelineTooltip = null; calls.push("hide"); },
    cancelTimelineTooltipHide() {}, setTodayView(value) { state.todayView = value; calls.push(value); },
    closeTimelinePanel() { calls.push("close"); if (!state.savingExecution) state.selection = null; },
    ...overrides
  };
  const context = vm.createContext(state);
  function render() {
    for (const [index, effect] of effects.entries()) {
      const deps = vm.runInContext(compile(`(${effect.deps})`), context);
      if (installed[index]?.deps.every((value, i) => Object.is(value, deps[i]))) continue;
      installed[index]?.cleanup?.();
      const run = vm.runInContext(compile(`(({visible, todayView, selection, timelineTooltip}) => (${effect.body})())`), context);
      installed[index] = { deps, cleanup: run(state) };
    }
  }
  render();
  return {
    state, calls, card, trigger, render,
    key(key = "Escape", prevented = false) {
      const event = new Event("keydown", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "key", { value: key });
      if (prevented) event.preventDefault();
      host.dispatchEvent(event);
      return event;
    },
    panelKey(key = "Escape") {
      let stopped = false;
      const event = { key, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { stopped = true; } };
      vm.runInContext(compile(`(${panelKeyDown})`), context)(event);
      return { event, stopped };
    }
  };
}

test("Escape dismisses a newly opened task tooltip before month navigation, then the next Escape returns", () => {
  const h = harness();
  h.state.timelineTooltip = { title: "task" };
  h.render();
  h.state.document.activeElement = new (h.state.HTMLElement)(h.card);
  const event = h.key();
  assert.equal(h.state.todayView, "timeline", "an earlier navigation listener must not leave the timeline");
  assert.equal(h.state.timelineTooltip, null);
  assert.equal(event.defaultPrevented, true);
  assert.equal(h.state.document.activeElement, h.trigger);
  h.render();
  h.key();
  assert.equal(h.state.todayView, "month");
});

test("task detail panel consumes Escape even when closing immediately updates its selection", () => {
  for (const savingExecution of [false, true]) {
    const h = harness({ selection: { kind: "block", id: "task" }, savingExecution });
    const { event, stopped } = h.panelKey();
    assert.equal(event.defaultPrevented, true);
    assert.equal(stopped, true);
    assert.equal(h.state.selection === null, !savingExecution);
    assert.equal(h.state.todayView, "timeline");
    h.render();
    h.key("Escape", event.defaultPrevented);
    assert.equal(h.state.todayView, "timeline", "the same consumed Escape cannot navigate after closing");
  }
});

test("month shortcut keeps its existing dialog, visibility and handled-key guards", () => {
  for (const overrides of [{ selection: { kind: "event", id: "event" } }, { modal: {} }, { visible: false }, { todayView: "month" }]) {
    const h = harness(overrides);
    h.key();
    assert.equal(h.calls.includes("month"), false);
  }
  const h = harness();
  h.key("Enter");
  h.key("Escape", true);
  assert.equal(h.state.todayView, "timeline");
  const { stopped } = h.panelKey("Enter");
  assert.equal(stopped, false);
  assert.equal(h.calls.includes("close"), false);
});

test("closing details restores task focus without immediately reopening its hover card", () => {
  for (const savingExecution of [false, true]) for (const recurringSaving of [false, true]) {
    const frames = [];
    const state = {
      savingExecution, recurringResultSavingRef: { current: recurringSaving }, selection: { kind: "block", id: "task" }, tooltip: null,
      setSelection(value) { state.selection = value; }, setPlanDraftTimeEdit() {}, setRecurringTimeEdit() {}, setRecycledCompletionNote() {},
      timelineSelectionAnchorRef: { current: {} }, timelineScrollRef: { current: null },
      timelineSelectionTriggerRef: { current: { isConnected: true, focus() { state.focused = true; state.tooltip = { title: "reopened by focus" }; } } },
      window: { requestAnimationFrame(fn) { frames.push(fn); } }, hideTimelineTooltip() { state.tooltip = null; }
    };
    vm.runInNewContext(compile(`${closePanel}\ncloseTimelinePanel();`), state);
    frames.forEach(fn => fn());
    assert.equal(state.selection === null, !savingExecution && !recurringSaving);
    assert.equal(Boolean(state.focused), !savingExecution && !recurringSaving);
    assert.equal(state.tooltip, null, "focus recovery must not create another floating card");
  }
});
