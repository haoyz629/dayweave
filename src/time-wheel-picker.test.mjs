import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { parseClockMinutes } from "./time-range-control.ts";

const pickerSourceText = readFileSync(new URL("./time-wheel-picker.tsx", import.meta.url), "utf8");
const pickerSource = ts.createSourceFile("time-wheel-picker.tsx", pickerSourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const pickerDeclarations = pickerSource.statements
  .filter((node) => !ts.isImportDeclaration(node))
  .map((node) => node.getText(pickerSource).replace(/^export /, ""));
const compiledPicker = ts.transpileModule(pickerDeclarations.join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React }
}).outputText;

function elements(node, predicate) {
  if (!React.isValidElement(node)) return [];
  const children = node.props?.children ? React.Children.toArray(node.props.children) : [];
  return [...(predicate(node) ? [node] : []), ...children.flatMap((child) => elements(child, predicate))];
}

function loadPicker(overrides = {}) {
  const slots = [];
  const pendingEffects = [];
  const cleanups = [];
  let cursor = 0;
  let idSeq = 0;

  const globals = {
    React,
    parseClockMinutes,
    useId() {
      const index = cursor++;
      return (slots[index] ??= `wheel-${++idSeq}`);
    },
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      return (slots[index] ??= { current: initial });
    },
    useEffect(fn, deps = []) {
      const index = cursor++;
      if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index][i]))) {
        slots[index] = deps;
        pendingEffects.push(() => {
          cleanups[index]?.();
          cleanups[index] = fn();
        });
      }
    },
    useLayoutEffect(fn, deps = []) {
      const index = cursor++;
      if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index][i]))) {
        slots[index] = deps;
        pendingEffects.push(() => {
          cleanups[index]?.();
          cleanups[index] = fn();
        });
      }
    },
    document: { addEventListener() {}, removeEventListener() {} },
    window: {
      matchMedia: () => ({ matches: false }),
      setTimeout: () => 1,
      clearTimeout() {},
      addEventListener() {},
      removeEventListener() {}
    },
    ...overrides
  };
  vm.runInNewContext(compiledPicker, globals);

  function renderComponent(Component, props) {
    cursor = 0;
    const raw = Component(props);
    function expand(node) {
      if (!React.isValidElement(node)) return node;
      if (typeof node.type === "function") return expand(node.type(node.props));
      const children = React.Children.map(node.props.children, expand);
      return React.cloneElement(node, undefined, ...(Array.isArray(children) ? children : children == null ? [] : [children]));
    }
    const tree = expand(raw);
    pendingEffects.splice(0).forEach((fn) => fn());
    return tree;
  }

  return { globals, renderComponent, unmount() { cleanups.forEach((fn) => fn?.()); } };
}

test("TimeWheelTrigger toggles accessible popup state", () => {
  const { globals } = loadPicker();
  let toggled = 0;
  const closedHtml = renderToStaticMarkup(React.createElement(globals.TimeWheelTrigger, {
    active: false,
    label: "打开开始时间滚轴",
    controlsId: "wheel-1",
    onToggle: () => { toggled++; }
  }));
  assert.match(closedHtml, /aria-expanded="false"/);
  assert.match(closedHtml, /aria-haspopup="dialog"/);
  assert.doesNotMatch(closedHtml, /aria-controls=/);

  const openTree = globals.TimeWheelTrigger({
    active: true,
    label: "打开开始时间滚轴",
    controlsId: "wheel-1",
    onToggle: () => { toggled++; }
  });
  assert.equal(openTree.props["aria-controls"], "wheel-1");
  assert.ok(openTree.props.className.includes("is-active"));
  openTree.props.onClick({ stopPropagation() {} });
  assert.equal(toggled, 1);
});

test("TimeWheelPopover renders 5-minute wheel steps and optional recurring 24:00", () => {
  const closed = loadPicker();
  assert.equal(
    closed.renderComponent(closed.globals.TimeWheelPopover, {
      open: false,
      edge: "start",
      value: "09:00",
      anchorRef: { current: null },
      onSelect() {},
      onClose() {}
    }),
    null
  );

  const selections = [];
  let closes = 0;
  const ordinary = loadPicker();
  const tree = ordinary.renderComponent(ordinary.globals.TimeWheelPopover, {
    open: true,
    edge: "end",
    value: "09:37",
    anchorRef: { current: null },
    onSelect: (clock) => selections.push(clock),
    onClose: () => { closes++; }
  });
  const listboxes = elements(tree, (node) => node.props?.role === "listbox");
  assert.equal(listboxes.length, 2);
  const hourOptions = elements(listboxes[0], (node) => node.props?.role === "option");
  const minuteOptions = elements(listboxes[1], (node) => node.props?.role === "option");
  assert.equal(hourOptions.length, 24);
  assert.deepEqual(minuteOptions.map((option) => option.props.children), ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"]);

  const readout = elements(tree, (node) => node.type === "output")[0];
  assert.equal(readout.props.children, "09:37");
  assert.match(renderToStaticMarkup(tree), /精确 09:37 · 滚轮按 5 分/);

  // Changing only the hour preserves the typed single-minute offset (37).
  hourOptions[10].props.onClick();
  minuteOptions[3].props.onClick();
  assert.deepEqual(selections, ["10:37", "09:15"]);

  elements(tree, (node) => node.type === "button" && node.props.className === "time-wheel-done")[0].props.onClick();
  assert.equal(closes, 1);

  const recurring = loadPicker();
  const midnightSelections = [];
  const midnightTree = recurring.renderComponent(recurring.globals.TimeWheelPopover, {
    open: true,
    edge: "end",
    value: "24:00",
    allowMidnightEnd: true,
    anchorRef: { current: null },
    onSelect: (clock) => midnightSelections.push(clock),
    onClose() {}
  });
  const midnightListboxes = elements(midnightTree, (node) => node.props?.role === "listbox");
  const midnightHours = elements(midnightListboxes[0], (node) => node.props?.role === "option");
  const midnightMinutes = elements(midnightListboxes[1], (node) => node.props?.role === "option");
  assert.equal(midnightHours.length, 25);
  assert.equal(midnightHours[24].props.children, "24");
  assert.equal(midnightHours[24].props["aria-selected"], true);
  assert.deepEqual(midnightMinutes.map((option) => Boolean(option.props.disabled)), [false, true, true, true, true, true, true, true, true, true, true, true]);
  midnightMinutes[6].props.onClick(); // disabled -> ignored
  assert.deepEqual(midnightSelections, []);
  midnightHours[24].props.onClick();
  assert.deepEqual(midnightSelections, ["24:00"]);
});

test("WheelColumn applies damped wheel thresholds, cooldown, pointer resistance, and keyboard navigation", () => {
  const listeners = new Map();
  const classSet = new Set();
  const listNode = {
    scrollTop: 0,
    classList: {
      add(name) { classSet.add(name); },
      remove(name) { classSet.delete(name); }
    },
    scrollTo({ top }) { listNode.scrollTop = top; },
    addEventListener(type, fn, opts) { listeners.set(type, { fn, opts }); },
    removeEventListener(type) { listeners.delete(type); },
    focus() {}
  };
  const docListeners = new Map();
  let fakeNow = 1000;
  const h = loadPicker({
    performance: { now: () => fakeNow },
    document: {
      addEventListener(type, fn) { docListeners.set(type, fn); },
      removeEventListener(type) { docListeners.delete(type); }
    }
  });
  const selections = [];
  let closes = 0;
  const anchorEl = {
    contains: () => false,
    getBoundingClientRect: () => ({ top: 100, bottom: 132, left: 200, width: 118 })
  };
  const tree = h.renderComponent(h.globals.TimeWheelPopover, {
    open: true,
    edge: "start",
    value: "09:00",
    anchorRef: { current: anchorEl },
    onSelect: (clock) => selections.push(clock),
    onClose: () => { closes++; }
  });
  const listboxes = elements(tree, (node) => node.props?.role === "listbox");

  const hWheel = loadPicker({
    performance: { now: () => fakeNow },
    document: {
      addEventListener(type, fn) { docListeners.set(type, fn); },
      removeEventListener(type) { docListeners.delete(type); }
    }
  });
  const calls = [];
  const columnTree = hWheel.renderComponent(hWheel.globals.WheelColumn, {
    ariaLabel: "选择小时",
    heading: "时",
    options: Array.from({ length: 24 }, (_, value) => ({ value, label: String(value).padStart(2, "0") })),
    selectedIndex: 9,
    exactMatch: true,
    open: true,
    listRef: { current: listNode },
    onSelectValue: (value) => calls.push(value),
    onSwitchColumn() {},
    onConfirmClose: () => { closes++; }
  });
  const wheelEntry = listeners.get("wheel");
  assert.ok(wheelEntry);
  assert.equal(wheelEntry.opts?.passive, false);

  // Small single micro-delta is resisted below damped trackpad threshold.
  let prevented = false;
  wheelEntry.fn({ deltaY: 20, deltaMode: 0, preventDefault() { prevented = true; }, stopPropagation() {} });
  assert.equal(prevented, true);
  assert.deepEqual(calls, []);

  // Reversing direction clears prior residue without jumping.
  wheelEntry.fn({ deltaY: -10, deltaMode: 0, preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(calls, []);

  // Discrete mouse detent steps once cleanly after cooldown, and rapid bounce inside cooldown is damped.
  fakeNow = 1200;
  wheelEntry.fn({ deltaY: 96, deltaMode: 0, preventDefault() {}, stopPropagation() {} });
  fakeNow = 1215;
  wheelEntry.fn({ deltaY: 96, deltaMode: 0, preventDefault() {}, stopPropagation() {} });
  fakeNow = 1300;
  wheelEntry.fn({ deltaY: 28, deltaMode: 0, preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(calls, [10]);
  fakeNow = 1400;
  wheelEntry.fn({ deltaY: 28, deltaMode: 0, preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(calls, [10, 10]);

  // Pointer drag applies 0.68 damping resistance instead of loose 1:1 movement.
  listNode.scrollTop = 9 * 34;
  const captureSet = new Set();
  const currentTarget = {
    setPointerCapture: (id) => captureSet.add(id),
    hasPointerCapture: (id) => captureSet.has(id),
    releasePointerCapture: (id) => captureSet.delete(id)
  };
  const listboxEl = elements(columnTree, (node) => node.props?.role === "listbox")[0];
  listboxEl.props.onPointerDown({ button: 0, pointerId: 1, clientY: 200, stopPropagation() {} });
  listboxEl.props.onPointerMove({ pointerId: 1, clientY: 150, currentTarget });
  // delta = -50 * 0.68 = -34 -> scrollTop increases from 306 to 340 (index 10)
  assert.equal(listNode.scrollTop, 9 * 34 + 34);
  listboxEl.props.onPointerUp({ pointerId: 1, currentTarget });
  assert.deepEqual(calls, [10, 10, 10]);
  hWheel.unmount();

  listboxes[0].props.onKeyDown({ key: "ArrowDown", preventDefault() {} });
  listboxes[0].props.onKeyDown({ key: "Enter", preventDefault() {} });
  docListeners.get("keydown")?.({ key: "Escape", preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(selections, ["10:00"]);
  assert.equal(closes, 2);
});

test("all five light-mode time inputs share unified wheel trigger, monospace font, and focus styles", () => {
  const stylesCss = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const fieldsCss = readFileSync(new URL("./task-time-range-fields.css", import.meta.url), "utf8");
  const wheelCss = readFileSync(new URL("./time-wheel-picker.css", import.meta.url), "utf8");

  assert.match(wheelCss, /\.time-wheel-list\.is-animating\s*\{[^}]*scroll-snap-type:\s*none;/);
  assert.match(wheelCss, /\.selection-time-box,\s*\.task-time-range-box,\s*\.block-editor-input-box\):has\(>\s*\.time-wheel-trigger\.is-active\)/);
  assert.match(fieldsCss, /\.selection-time-box > input,[\s\S]*?font: 600 13\.5px\/1 var\(--jx-font-mono\)/);
  assert.match(stylesCss, /\.time-range-values\.block-editor-values input \{[^}]*font: 600 13\.5px\/1 var\(--jx-font-mono\)/);
});

test("all time-editing surfaces wire TimeWheelTrigger and TimeWheelPopover", () => {
  const timelineCreateText = readFileSync(new URL("./timeline-task-create.tsx", import.meta.url), "utf8");
  const timelineCreateSource = ts.createSourceFile("timeline-task-create.tsx", timelineCreateText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const appText = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  const appSource = ts.createSourceFile("App.tsx", appText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  function jsxTagCounts(node) {
    const counts = { TimeWheelTrigger: 0, TimeWheelPopover: 0 };
    function visit(child) {
      if (ts.isJsxSelfClosingElement(child) || ts.isJsxOpeningElement(child)) {
        const name = child.tagName.getText(node.getSourceFile());
        if (name in counts) counts[name]++;
      }
      ts.forEachChild(child, visit);
    }
    visit(node);
    return counts;
  }

  const timelineCreate = timelineCreateSource.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "TimelineTaskCreate");
  assert.ok(timelineCreate);
  assert.deepEqual(jsxTagCounts(timelineCreate), { TimeWheelTrigger: 2, TimeWheelPopover: 1 });

  const blockRail = appSource.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "BlockEditorTimeRangeRail");
  const scheduleEditor = appSource.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "TaskScheduleEditor");
  const recurringPicker = appSource.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "RecurringValidityPicker");
  assert.ok(blockRail && scheduleEditor && recurringPicker);
  // Each of these three renders TimeWheelTrigger inside a shared helper called for both "start" and "end".
  assert.deepEqual(jsxTagCounts(blockRail), { TimeWheelTrigger: 1, TimeWheelPopover: 1 });
  assert.deepEqual(jsxTagCounts(scheduleEditor), { TimeWheelTrigger: 1, TimeWheelPopover: 1 });
  assert.deepEqual(jsxTagCounts(recurringPicker), { TimeWheelTrigger: 1, TimeWheelPopover: 1 });
  for (const picker of [scheduleEditor, recurringPicker]) {
    const markup = picker.getText(appSource);
    assert.match(markup, /className="schedule-time-control selection-time-box"/);
    assert.match(markup, /<small aria-hidden="true">\{label\}<\/small>\s*<input[^>]*[\s\S]*?<TimeWheelTrigger/);
    assert.doesNotMatch(markup, /className="schedule-boundary-time-control"/);
  }
  for (const fn of [blockRail, scheduleEditor, recurringPicker]) {
    assert.match(fn.getText(appSource), /applyTimeWheelSelection/);
  }
});
