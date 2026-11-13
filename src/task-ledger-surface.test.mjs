import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import postcss from "postcss";
import ts from "typescript";

const css = postcss.parse(readFileSync(new URL("./styles.css", import.meta.url), "utf8"));
const ledger = ".next-workspace .task-ledger";
function declarations(selector) {
  const values = {};
  css.walkRules(rule => {
    if (!rule.selectors.includes(selector)) return;
    rule.walkDecls(decl => { values[decl.prop] = decl.value; });
  });
  assert.ok(Object.keys(values).length, `Missing selector: ${selector}`);
  return values;
}

test("application canvases use the right workspace gray and a separate left sidebar gray", () => {
  assert.equal(declarations(":root")["--app-workspace-bg"], "#f4f5f7");
  assert.equal(declarations(":root")["--app-sidebar-bg"], "#f3f3f3");
  assert.equal(declarations(".next-sidebar").background, "var(--app-sidebar-bg)");
  for (const selector of [
    ".next-shell", ".next-workspace", ".tasks-workspace",
    ".next-workspace > .settings-page", ".next-workspace > .review-page",
    ".calendar-composition", ".timeline-page-shell",
    ".next-workspace .today-workspace", ".next-workspace .today-schedule-pane",
    ".next-workspace .today-page", ".next-workspace .today-page .timeline-main",
    ".today-page .is-timeline-view .timeline-design-topbar", ".today-page .timeline-week",
    ".next-workspace .today-page .timeline-lanes", ".next-workspace .today-page .calendar-topbar",
    ".next-workspace .today-page .month-sheet", ".next-workspace .today-page .today-month-sheet",
    ".next-workspace .today-page .date-inspector", ".next-workspace .today-page .today-calendar-resize-handle",
    ".next-workspace .today-workspace > .review-page"
  ]) assert.equal(declarations(selector).background, "var(--app-workspace-bg)", selector);
  assert.equal(declarations(":root")["--jx-raised"], "#ffffff");
  assert.equal(declarations(ledger)["--task-workspace-bg"], declarations(":root")["--app-workspace-bg"]);
});

test("list, header, divider and inspector share the requested light canvas", () => {
  assert.equal(declarations(ledger)["--task-workspace-bg"], "#f4f5f7");
  for (const selector of [ledger, `${ledger} .task-queue-header`, `${ledger} > .ledger-resize-handle`, `${ledger} > .task-inspector`, `${ledger} > .task-inspector .inspector-scroll`]) {
    assert.equal(declarations(selector).background, "var(--task-workspace-bg)");
  }
  assert.equal(declarations(".next-workspace .task-ledger-list").background, "var(--task-workspace-bg, #f4f5f7)");
  assert.equal(declarations(`${ledger} > .task-inspector:has(.ordinary-task-detail)`)["--task-detail-bg"], "var(--task-workspace-bg)");
  assert.equal(declarations(".next-workspace .task-ledger-list")["--task-card-bg"], "#fff");
});

test("dark canvas remains dark and is shared instead of hardcoding the light color", () => {
  assert.equal(declarations(`html[data-mode="dark"] ${ledger}`)["--task-workspace-bg"], "var(--jx-paper)");
  assert.equal(declarations(`html[data-mode="dark"] ${ledger} .task-queue-header`).background, "var(--task-workspace-bg)");
  assert.equal(declarations('html[data-mode="dark"] .next-workspace .task-ledger-list').background, "var(--task-workspace-bg, var(--jx-paper))");
});

test("resting line and active stroke end at the inspector edge inside the resize hit area", () => {
  for (const pseudo of ["before", "after"]) {
    const style = declarations(`${ledger} > .ledger-resize-handle::${pseudo}`);
    assert.equal(style.left, "100%");
    assert.equal(style.transform, "translateX(-100%)");
    assert.equal(style["pointer-events"], "none");
  }
  const resting = declarations(`${ledger} > .ledger-resize-handle::before`);
  assert.equal(resting.width, "1px");
  assert.equal(resting.background, "var(--task-workspace-divider)");
  assert.equal(declarations(`${ledger} > .task-inspector`)["border-left"], "0");
});

const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["currentLedgerListWidth", "setConstrainedLedgerWidth", "persistLedgerWidth", "startLedgerResize", "moveLedgerResize", "endLedgerResize", "resizeLedgerWithKeyboard", "resetLedgerWidth"];
const functions = new Map();
function collect(node) {
  if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) functions.set(node.name.text, node.getText(source));
  ts.forEachChild(node, collect);
}
collect(source);
function harness() {
  const calls = [];
  const state = {
    ledgerListWidth: 340, ledgerRef: { current: { clientWidth: 1100 } }, ledgerResizeSession: { current: null },
    TASK_LEDGER_LIST_MIN_WIDTH: 320, TASK_LEDGER_INSPECTOR_MIN_WIDTH: 380, TASK_LEDGER_HANDLE_WIDTH: 14,
    TASK_LEDGER_LIST_DEFAULT_WIDTH: 340, TASK_LEDGER_WIDTH_SETTING: "ui.task_ledger_list_width",
    setLedgerListWidth: width => { state.ledgerListWidth = width; }, setLedgerMaximumWidth: () => {},
    setResizingLedger: active => calls.push(["resizing", active]),
    setUiSetting: (key, width) => { calls.push([key, width]); return Promise.resolve(); },
    setFeedback: () => {}, uiErrorMessage: String,
    window: { getComputedStyle: () => ({ gridTemplateColumns: "340px 14px 746px" }) }
  };
  for (const name of ["TASK_LEDGER_LIST_MIN_WIDTH", "TASK_LEDGER_INSPECTOR_MIN_WIDTH", "TASK_LEDGER_HANDLE_WIDTH", "TASK_LEDGER_LIST_DEFAULT_WIDTH"]) {
    state[name] = Number(app.match(new RegExp(`const ${name} = (\\d+);`))[1]);
  }
  const context = vm.createContext(state);
  for (const name of names) {
    assert.ok(functions.has(name), name);
    vm.runInContext(ts.transpileModule(functions.get(name), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  }
  return { state, calls };
}

test("grabbing any point in the fourteen-pixel handle moves by delta without a jump", () => {
  for (const offset of [0.5, 7, 13.5]) {
    const { state, calls } = harness();
    const target = { focus() {}, setPointerCapture: () => {}, hasPointerCapture: () => true, releasePointerCapture: () => {} };
    const event = { button: 0, clientX: 340 + offset, pointerId: 1, currentTarget: target, preventDefault() {} };
    state.startLedgerResize(event);
    state.moveLedgerResize(event);
    assert.equal(state.ledgerListWidth, 340);
    state.moveLedgerResize({ ...event, clientX: event.clientX + 100 });
    assert.equal(state.ledgerListWidth, 440);
    state.endLedgerResize(event);
    assert.equal(state.ledgerResizeSession.current, null);
    assert.deepEqual(calls.at(-1), ["ui.task_ledger_list_width", "440"]);
  }
});

test("keyboard resizing, bounds and reset retain the existing saved-width contract", () => {
  const { state, calls } = harness();
  state.resizeLedgerWithKeyboard({ key: "ArrowRight", shiftKey: false, preventDefault() {} });
  assert.equal(state.ledgerListWidth, 356);
  state.resizeLedgerWithKeyboard({ key: "ArrowLeft", shiftKey: true, preventDefault() {} });
  assert.equal(state.ledgerListWidth, 320);
  assert.equal(state.setConstrainedLedgerWidth(-100), 320);
  assert.equal(state.setConstrainedLedgerWidth(2000), 706);
  state.resetLedgerWidth();
  assert.equal(state.ledgerListWidth, 400);
  assert.deepEqual(calls.at(-1), ["ui.task_ledger_list_width", "400"]);
});


test("saved narrow widths are clamped and resizing preserves both panes", () => {
  const { state } = harness();
  assert.equal(state.setConstrainedLedgerWidth(260), 320);
  for (let available = 714; available <= 1600; available += 1) {
    state.ledgerRef.current.clientWidth = available;
    for (const requested of [0, 320, 340, 380, 900, 2000]) {
      const width = state.setConstrainedLedgerWidth(requested);
      assert.ok(width >= 320);
      assert.ok(available - width - 14 >= 380);
    }
  }
});

test("right click does not start a resize", () => {
  const { state, calls } = harness();
  state.startLedgerResize({ button: 2 });
  assert.equal(state.ledgerResizeSession.current, null);
  assert.deepEqual(calls, []);
});

test("CSS and runtime agree on minimum sizes and the container stacking threshold", () => {
  const { state } = harness();
  assert.equal(state.TASK_LEDGER_LIST_MIN_WIDTH, 320);
  assert.equal(state.TASK_LEDGER_HANDLE_WIDTH, 14);
  assert.equal(state.TASK_LEDGER_LIST_DEFAULT_WIDTH, 400);
  assert.equal(declarations(".task-ledger")["--task-list-width"], "400px");
  const rules = [];
  css.walkRules(rule => {
    if (rule.selector === ".task-ledger" || rule.selector === ".task-ledger:has(.ordinary-task-detail)") rule.walkDecls("grid-template-columns", d => rules.push(d.value));
  });
  assert.ok(rules.includes("minmax(320px, min(var(--task-list-width), calc(100% - 394px))) 14px minmax(380px, 1fr)"));
  const stacked = [];
  css.walkAtRules("container", rule => { if (rule.params === "(max-width: 713px)") stacked.push(rule.toString()); });
  assert.equal(stacked.length, 1);
  assert.match(stacked[0], /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(stacked[0], /ledger-resize-handle \{ display: none;/);
});
