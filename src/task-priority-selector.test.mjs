import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import ts from "typescript";

const text = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["emptyNewTaskForm", "taskFormForManualUpdate", "manualUpdateForTaskForm"];
const selectorText = readFileSync(new URL("./task-priority-selector.tsx", import.meta.url), "utf8");
const selectorSource = ts.createSourceFile("task-priority-selector.tsx", selectorText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const selector = selectorSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "TaskPrioritySelector");
const code = [...source.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => node.getText(source)), selector.getText(selectorSource).replace("export ", "")].join("\n");
function harness(priority = "medium", disabled = false) {
  const changes = [], effects = [], focus = [], listeners = new Map();
  let contains = true;
  const options = [0, 1, 2].map(index => ({ focus() { focus.push(index); context.document.activeElement = this; } }));
  const trigger = { focus() { focus.push("trigger"); context.document.activeElement = this; } };
  const state = { open: true };
  const context = vm.createContext({
    React, priorityCopy: { high: "高优先级", medium: "中优先级", low: "低优先级" },
    useState: () => [state.open, value => { state.open = value; }],
    useRef: () => ({ current: { querySelector: selector => selector.includes("trigger") ? trigger : options[1], querySelectorAll: () => options, contains: () => contains } }),
    useEffect: fn => { effects.push(fn); },
    document: { activeElement: options[1], addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); } },
    TaskNotesInputs: () => null, TaskScheduleEditor: () => null, TaskTagEditor: () => null,
    taskRangeDurationMinutes: () => null
  });
  vm.runInContext(ts.transpileModule(code, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const form = { ...context.emptyNewTaskForm(), title: "任务", priority };
  function render() {
    const root = context.TaskPrioritySelector({ value: form.priority, disabled, id: "test-priority", onChange(value) { changes.push({ ...form, priority: value }); } });
    const nodes = [];
    function walk(node) { if (!node || typeof node !== "object") return; if (Array.isArray(node)) { node.forEach(walk); return; } nodes.push(node); React.Children.forEach(node.props?.children, walk); }
    walk(root);
    return { nodes, control: nodes.find(n => n.props?.onKeyDown), trigger: nodes.find(n => n.props?.className?.startsWith("priority-dropdown-trigger")), options: nodes.filter(n => n.props?.role === "option") };
  }
  return { context, form, state, changes, effects, focus, options, render, listeners, setContains(value) { contains = value; } };
}
function key(value) { return { key: value, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } }; }

test("new tasks default to medium and the shared selector has exactly three choices", () => {
  const h = harness();
  assert.equal(h.context.emptyNewTaskForm().priority, "medium");
  const view = h.render();
  assert.deepEqual(view.options.map(n => n.props.children[0].props.children[1].props.children), ["高优先级", "中优先级", "低优先级"]);
  assert.deepEqual(view.options.map(n => n.props["aria-selected"]), [false, true, false]);
  assert.equal(view.nodes.some(n => n.type === "select"), false);
  assert.equal(view.trigger.props["aria-controls"], "test-priority-menu");
});

test("legacy null displays medium without writing or changing the task form", () => {
  const h = harness(null);
  const view = h.render();
  assert.equal(view.trigger.props["aria-label"], "优先级：中优先级");
  assert.equal(view.options[1].props["aria-selected"], true);
  h.effects.forEach(fn => fn());
  assert.equal(h.form.priority, null);
  assert.equal(h.changes.length, 0);
  const form = h.context.taskFormForManualUpdate({ title: "历史任务", priority: null });
  assert.equal(h.context.manualUpdateForTaskForm(form).priority, null);
});

test("a choice updates once on click and returns focus; pointer-down never writes", () => {
  const h = harness();
  const option = h.render().options[0];
  option.props.onMouseDown(key("pointer"));
  assert.equal(h.changes.length, 0);
  option.props.onClick();
  assert.equal(h.changes.length, 1);
  assert.equal(h.changes[0].priority, "high");
  assert.equal(h.state.open, false);
  assert.deepEqual(h.focus, ["trigger"]);
});

test("keyboard navigation wraps, supports endpoints, and isolates Escape", () => {
  const h = harness();
  const view = h.render();
  for (const value of ["ArrowDown", "ArrowDown", "End", "Home"]) view.control.props.onKeyDown(key(value));
  assert.deepEqual(h.focus, [2, 0, 2, 0]);
  const escape = key("Escape");
  view.control.props.onKeyDown(escape);
  assert.equal(escape.prevented, true);
  assert.equal(escape.stopped, true);
  assert.equal(h.state.open, false);
  assert.equal(h.focus.at(-1), "trigger");
  h.render().control.props.onKeyDown(key("ArrowDown"));
  assert.equal(h.state.open, true);
});

test("disabled selectors cannot be opened with keyboard or the trigger", () => {
  const h = harness("medium", true);
  h.state.open = false;
  const view = h.render();
  assert.equal(view.trigger.props.disabled, true);
  view.trigger.props.onClick();
  view.control.props.onKeyDown(key("ArrowDown"));
  assert.equal(h.state.open, false);
  assert.equal(h.changes.length, 0);
});

test("outside pointer and focus departure close without writes; internal focus stays open", () => {
  const h = harness();
  const view = h.render();
  const cleanup = h.effects.map(fn => fn()).filter(Boolean);
  assert.deepEqual(h.focus, [1]);
  h.listeners.get("pointerdown")({ target: {} });
  assert.equal(h.state.open, true);
  h.setContains(false);
  h.listeners.get("pointerdown")({ target: {} });
  assert.equal(h.state.open, false);
  h.state.open = true;
  view.control.props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: null });
  assert.equal(h.state.open, false);
  assert.equal(h.changes.length, 0);
  cleanup.forEach(fn => fn());
  assert.equal(h.listeners.size, 0);
});

test("Tab closes without preventing native focus traversal or choosing a value", () => {
  const h = harness();
  const event = key("Tab");
  h.render().control.props.onKeyDown(event);
  assert.equal(h.state.open, false);
  assert.equal(event.prevented, false);
  assert.deepEqual(h.focus, ["trigger"]);
  assert.equal(h.changes.length, 0);
});

test("disabled state hides an already open menu and resets it without changes", () => {
  const h = harness("medium", true);
  const view = h.render();
  assert.equal(view.options.length, 0);
  assert.equal(view.trigger.props["aria-expanded"], false);
  h.effects.forEach(fn => fn());
  assert.equal(h.state.open, false);
  assert.equal(h.changes.length, 0);
});

test("task editors and slide creation use the same selector without normalizing persisted nulls", () => {
  assert.match(text, /<TaskPrioritySelector id=\{priorityId\} value=\{form.priority\} disabled=\{disabled\}/);
  const timeline = readFileSync(new URL("./timeline-task-create.tsx", import.meta.url), "utf8");
  assert.match(timeline, /setForm\(\{ title: "", start: clock\(range.start\), end: clock\(range.end\), priority: "medium", tags: \[\] \}\)/);
  assert.match(timeline, /<TaskPrioritySelector[^>]*value=\{form.priority\} disabled=\{saving \|\| disabled\}/);
  assert.doesNotMatch(timeline, /<select name="priority"/);
  assert.match(timeline, /title: form.title.trim\(\), notes: null, priority: form.priority/);
  // The timeline's Escape shortcut detects explicit dialog roles before native cancel runs.
  assert.match(timeline, /<dialog ref=\{dialogRef\} role="dialog"/);
});
