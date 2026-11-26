import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import * as controls from "./time-range-control.ts";
import { recurringClockRange, recurringRangeInput, recurringTimeBlockIssue } from "./recurring-schedule.ts";
import { CopySeparator } from "./copy-separator.test-helper.mjs";

const app = ts.createSourceFile("App.tsx", readFileSync(new URL("./App.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["UntimedScheduleNote", "ScheduleDateGrid", "RecurringValidityPicker", "BlockEditorTimeRangeRail", "calendarCells", "shiftDateValue", "shiftMonthKey", "clockMinutes", "minutesClock", "validDraftClock", "shanghaiDateValue"];
const code = app.statements
  .filter(node => (ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
    || (ts.isVariableStatement(node) && node.declarationList.declarations.some(decl => decl.name.getText(app) === "UNTIMED_SCHEDULE_NOTE")))
  .map(node => node.getText(app))
  .join("\n");
const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

// Run the production JSX and callbacks with deterministic hooks; no Tauri runtime required.
function mount(name, props) {
  const slots = [], pending = [], cleanup = [];
  let cursor = 0, tree;
  const globals = {
    React, CopySeparator, Fragment: React.Fragment, ...controls, recurringClockRange, recurringRangeInput, recurringTimeBlockIssue,
    MIN_TASK_BLOCK_MINUTES: 15, Icon: () => null, TimeWheelTrigger: () => null, TimeWheelPopover: () => null, createPortal: node => node,
    TaskDurationPresets: () => null,
    pickerDateLabel: value => value, formatWorkloadMinutes: value => `${value} 分钟`,
    recurringItemPreviewDates: form => [form.starts_on, ...(form.ends_on ? [form.ends_on] : [])],
    document: { body: { style: { overflow: "" } }, activeElement: { focus() {} } },
    window: { requestAnimationFrame(fn) { fn(); return 1; }, cancelAnimationFrame() {}, addEventListener() {}, removeEventListener() {} },
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useMemo(fn) { cursor++; return fn(); },
    useEffect(fn, dependencies) {
      const index = cursor++;
      if (!slots[index] || dependencies.some((value, i) => !Object.is(value, slots[index][i]))) {
        slots[index] = dependencies;
        pending.push(() => { cleanup[index]?.(); cleanup[index] = fn(); });
      }
    }
  };
  vm.runInNewContext(compiled, globals);
  function render() {
    // A second render reflects state synchronized by effects.
    for (let pass = 0; pass < 2; pass++) {
      cursor = 0;
      tree = globals[name](props);
      pending.splice(0).forEach(fn => fn());
    }
    return tree;
  }
  return { globals, render, unmount() { cleanup.forEach(fn => fn?.()); } };
}
function elements(node, predicate) {
  if (!React.isValidElement(node)) return [];
  return [...(predicate(node) ? [node] : []), ...React.Children.toArray(node.props.children).flatMap(child => elements(child, predicate))];
}
const byLabel = (tree, label) => elements(tree, node => node.props["aria-label"] === label)[0];
const byClass = (tree, name) => elements(tree, node => node.props.className?.split(" ").includes(name))[0];
function picker(overrides = {}) {
  const confirmed = [], closed = [];
  const props = { startsOn: "2026-10-23", endsOn: "", displayTime: "09:00", displayDurationMinutes: 60, todayDate: "2026-10-23", previewForm: {}, onConfirm: (...values) => confirmed.push(values), onClose: () => closed.push(true), ...overrides };
  const h = mount("RecurringValidityPicker", props);
  const grid = () => { const element = elements(h.render(), node => node.type === h.globals.ScheduleDateGrid)[0]; return element.type(element.props); };
  const days = () => grid().props.children;
  return {
    ...h, confirmed, closed, grid, days,
    date(key) { return days().find(day => day.key === key); },
    boundary(edge) { return byLabel(h.render(), `选择${edge === "start" ? "开始" : "结束"}日期`); },
    input(edge) { return byLabel(h.render(), `输入${edge === "start" ? "开始" : "结束"}时间`); },
    rail() { return elements(h.render(), node => node.type === h.globals.BlockEditorTimeRangeRail)[0]; },
    confirm() { return byClass(h.render(), "schedule-picker-confirm"); },
    preset(label) { return elements(byClass(h.render(), "schedule-validity-presets"), node => node.type === "button" && node.props.children === label)[0]; }
  };
}
const dates = h => [Array.from(h.grid().props.children).filter(day => day.props["aria-pressed"]).map(day => day.key), h.boundary("end").props.children[1]];

test("both pickers render the same grid and inherit range colors, solid endpoints and middle band", () => {
  for (const name of ["TaskScheduleEditor", "RecurringValidityPicker"]) {
    const component = app.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(app);
    assert.match(component, /<ScheduleDateGrid/);
    assert.match(component, /schedule-picker-calendar/);
    assert.doesNotMatch(component, /recurring-calendar-grid|recurring-target-tabs/);
  }
  for (const prefix of ["", 'html[data-mode="dark"] ']) assert.ok(css.includes(`${prefix}.schedule-picker-calendar {`));
  const rule = selector => { const start = css.indexOf(`${selector} {`); assert.notEqual(start, -1); return css.slice(start, css.indexOf("}", start)); };
  const prefix = ".schedule-picker-calendar .apple-date-grid button";
  assert.match(rule(`${prefix}.in-range`), /border-radius: 0; background: var\(--schedule-range-fill\)/);
  assert.match(rule(`${prefix}.selected`), /background: var\(--schedule-range-node\); box-shadow: none/);
  assert.match(rule(`${prefix}.range-start`), /border-radius: 19px 0 0 19px/);
  assert.match(rule(`${prefix}.range-end`), /border-radius: 0 19px 19px 0/);
  assert.match(rule(`${prefix}.range-start.range-end`), /width: 38px;.*border-radius: 19px/);
});

test("recurring clicks and hover sort both directions, including middle dates at week boundaries", () => {
  for (const [start, end] of [["2026-10-23", "2026-10-29"], ["2026-10-29", "2026-10-23"]]) {
    const h = picker();
    h.date(start).props.onClick();
    h.date(end).props.onPointerEnter({ pointerType: "mouse" });
    for (const key of ["2026-10-25", "2026-10-26"]) {
      const node = h.date(key);
      assert.match(node.props.className, /in-range/);
      assert.match(node.props.className, /is-preview/);
      assert.doesNotMatch(node.props.className, /selected/);
      assert.equal(node.props["aria-pressed"], false);
    }
    h.date(end).props.onClick();
    assert.deepEqual(dates(h)[0], ["2026-10-23", "2026-10-29"]);
    assert.equal(h.boundary("end").props.children[1], "2026-10-29");
    assert.doesNotMatch(h.date("2026-10-25").props.className, /is-preview/);
    assert.equal(h.input("start").props.value, "09:00");
    assert.equal(h.input("end").props.value, "10:00");
  }
});

test("open-ended and single-day ranges show the same closed node; long validity remains available", () => {
  for (const endsOn of ["", "2026-10-23"]) {
    const h = picker({ endsOn });
    assert.match(h.date("2026-10-23").props.className, /range-start.*range-end.*selected/);
  }
  const h = picker();
  h.date("2026-10-25").props.onClick();
  assert.equal(h.boundary("end").props.children[1], "长期有效");
  h.confirm().props.onClick();
  assert.deepEqual(h.confirmed[0], ["2026-10-25", "", "09:00", 60]);
  h.preset("1 个月").props.onClick();
  assert.equal(h.boundary("end").props.children[1], "2026-11-24");
  h.preset("长期有效").props.onClick();
  assert.equal(h.boundary("end").props.children[1], "长期有效");
  assert.equal(h.preset("长期有效").props["aria-pressed"], true);
});

test("date boundary editing and time focus preserve the shared current-operation and endpoint feedback", () => {
  const h = picker({ endsOn: "2026-10-29" });
  h.boundary("start").props.onClick({ stopPropagation() {} });
  h.date("2026-10-25").props.onClick();
  assert.deepEqual(dates(h)[0], ["2026-10-25", "2026-10-29"]);
  h.boundary("end").props.onClick({ stopPropagation() {} });
  h.input("start").props.onFocus({ currentTarget: { select() {} } });
  assert.equal(h.boundary("start").props["aria-pressed"], true);
  assert.equal(h.boundary("end").props["aria-pressed"], false);
  h.date("2026-10-26").props.onClick();
  assert.deepEqual(dates(h)[0], ["2026-10-25", "2026-10-26"]);
  for (const key of ["2026-10-25", "2026-10-26"]) assert.match(h.date(key).props.className, /selected/);
});

test("keyboard focus previews ranges, touch does not, and leave/month changes clear previews", () => {
  const h = picker();
  h.date("2026-10-23").props.onClick();
  h.date("2026-10-29").props.onPointerEnter({ pointerType: "touch" });
  assert.doesNotMatch(h.date("2026-10-25").props.className, /is-preview/);
  h.date("2026-10-29").props.onFocus();
  assert.match(h.date("2026-10-25").props.className, /is-preview/);
  h.grid().props.onPointerLeave();
  assert.doesNotMatch(h.date("2026-10-25").props.className, /is-preview/);
  h.date("2026-10-29").props.onFocus();
  byLabel(h.render(), "下个月").props.onClick();
  assert.equal(h.days().some(day => /is-preview/.test(day.props.className)), false);
});

test("recurring time range edits synchronize rail and headers and persist midnight without wrapping", () => {
  const h = picker();
  h.input("start").props.onChange({ target: { value: "2330" } });
  h.input("end").props.onChange({ target: { value: "2400" } });
  h.input("end").props.onBlur({ currentTarget: { value: "2400" } });
  assert.equal(h.input("end").props.value, "24:00");
  assert.equal(h.rail().props.start, "23:30");
  assert.equal(h.rail().props.end, "24:00");
  assert.equal(h.confirm().props.disabled, false);
  h.confirm().props.onClick();
  assert.deepEqual(h.confirmed[0], ["2026-10-23", "", "23:30", 30]);
  h.rail().props.onChange({ start: "08:15", end: "09:45" });
  assert.equal(h.input("start").props.value, "08:15");
  assert.equal(h.input("end").props.value, "09:45");
});

test("invalid, reversed and cross-midnight recurring inputs block confirmation and keep last valid rail", () => {
  for (const [start, end] of [["24:00", "24:00"], ["23:30", "24:01"], ["23:30", "00:30"], ["09:00", "09:00"], ["", "10:00"]]) {
    const h = picker();
    h.input("start").props.onChange({ target: { value: start } });
    h.input("end").props.onChange({ target: { value: end } });
    assert.equal(h.confirm().props.disabled, true);
    h.confirm().props.onClick();
    assert.equal(h.confirmed.length, 0);
    assert.equal(h.rail().props.start, "09:00");
    assert.equal(h.rail().props.end, "10:00");
  }
  const untimed = picker({ displayTime: "", displayDurationMinutes: null });
  assert.equal(untimed.confirm().props.disabled, false);
  untimed.confirm().props.onClick();
  assert.deepEqual(untimed.confirmed[0], ["2026-10-23", "", "", null]);
  const incomplete = picker({ displayTime: "09:00", displayDurationMinutes: null });
  assert.equal(incomplete.confirm().props.disabled, true);
});

test("Escape restores the last valid recurring input even when blur is delivered before rerender", () => {
  const h = picker();
  h.input("end").props.onChange({ target: { value: "9999" } });
  const input = h.input("end");
  const event = { key: "Escape", preventDefault() {}, stopPropagation() {}, currentTarget: { blur() { input.props.onBlur({ currentTarget: { value: "9999" } }); } } };
  input.props.onKeyDown(event);
  assert.equal(h.input("end").props.value, "10:00");
  assert.equal(h.confirm().props.disabled, false);
  assert.equal(h.closed.length, 0);
});

test("cancel closes without saving and restores page scrolling on unmount", () => {
  const h = picker();
  const cancel = elements(h.render(), node => node.type === "button" && node.props.children === "取消")[0];
  cancel.props.onClick();
  assert.equal(h.closed.length, 1);
  assert.equal(h.confirmed.length, 0);
  assert.equal(h.globals.document.body.style.overflow, "hidden");
  h.unmount();
  assert.equal(h.globals.document.body.style.overflow, "");
});

test("shared rail preserves 24:00 display, slider boundary and one-minute precision only when enabled", () => {
  for (const allowMidnightEnd of [true, false]) {
    const changes = [];
    const h = mount("BlockEditorTimeRangeRail", { start: "23:30", end: "23:45", minimumDuration: 1, maxMinute: allowMidnightEnd ? 1440 : 1439, allowMidnightEnd, onChange: range => changes.push(range) });
    byLabel(h.render(), "输入结束时间").props.onChange({ target: { value: "2400" } });
    byLabel(h.render(), "输入结束时间").props.onBlur();
    assert.equal(changes.length, allowMidnightEnd ? 1 : 0);
    if (allowMidnightEnd) assert.equal(changes[0].end, "24:00");
    const slider = elements(h.render(), node => node.props.className === "time-rail-range end")[0];
    assert.equal(slider.props.max, allowMidnightEnd ? 1440 : 1439);
    slider.props.onChange({ target: { value: 1440 } });
    assert.equal(changes.at(-1).end, allowMidnightEnd ? "24:00" : "23:59");
  }
  const h = mount("BlockEditorTimeRangeRail", { start: "23:30", end: "24:00", minimumDuration: 1, maxMinute: 1440, allowMidnightEnd: true, onChange() {} });
  assert.equal(byLabel(h.render(), "输入结束时间").props.value, "24:00");
  assert.equal(elements(h.render(), node => node.props.className === "time-rail-range end")[0].props["aria-valuetext"], "24:00");
});

test("untimed recurring validity opens untimed note on date click and timed controls on clock click", () => {
  for (const initialField of ["start", "end"]) {
    const h = picker({ displayTime: "", displayDurationMinutes: null, initialField });
    const tree = h.render();
    const untimedButton = elements(tree, node => node.type === "button" && node.props.children === "不限时刻")[0];
    assert.equal(untimedButton.props["aria-pressed"], true);
    const note = elements(tree, node => node.type === h.globals.UntimedScheduleNote)[0];
    assert.ok(note);
    assert.equal(byClass(note.type(note.props), "schedule-picker-untimed-note").props.role, "note");
  }
  const timedFromClock = picker({ displayTime: "", displayDurationMinutes: null, initialField: "time" });
  const timedButton = elements(timedFromClock.render(), node => node.type === "button" && node.props.children === "指定时刻")[0];
  assert.equal(timedButton.props["aria-pressed"], true);
});
