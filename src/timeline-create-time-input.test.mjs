import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { constrainTimeRange, normalizeClockInput, sanitizeTimeInput } from "./time-range-control.ts";

const source = ts.createSourceFile("timeline-task-create.tsx", readFileSync(new URL("./timeline-task-create.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = [];
function collect(node) {
  if (ts.isFunctionDeclaration(node) && ["updateTimes", "commitTimeInput", "renderTimeInput", "submit"].includes(node.name?.text)) declarations.push(node.getText(source));
  if (ts.isVariableDeclaration(node) && ["clock", "minute"].includes(node.name.getText(source))) declarations.push(`const ${node.getText(source)};`);
  ts.forEachChild(node, collect);
}
collect(source);
const code = ts.transpileModule(declarations.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
function harness(start = "09:00", end = "10:00") {
  const toMinute = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const calls = [];
  const state = {
    React, constrainTimeRange, normalizeClockInput, sanitizeTimeInput,
    form: { title: "输入验证", priority: "medium", start, end }, rangeRef: { current: { start: toMinute(start), end: toMinute(end) } },
    savingRef: { current: false }, disabled: false, titleRef: { current: { focus() {} } },
    setForm(value) { state.form = value; }, setError(value) { state.error = value; }, onRange(value) { calls.push(value); }
  };
  vm.runInContext(code, vm.createContext(state));
  const input = field => state.renderTimeInput(field);
  const key = (field, key, value = state.form[field]) => {
    let prevented = false, selected = false;
    input(field).props.onKeyDown({ key, currentTarget: { value, select() { selected = true; } }, preventDefault() { prevented = true; } });
    return { prevented, selected };
  };
  return { state, calls, input, key };
}

test("slide creation uses only numeric text inputs without a native time picker", () => {
  const h = harness();
  for (const field of ["start", "end"]) {
    const props = h.input(field).props;
    assert.equal(props.type, "text"); assert.equal(props.inputMode, "numeric"); assert.equal(props.maxLength, 5);
    assert.equal(props.autoComplete, "off"); assert.equal(props.name, field); assert.equal(props.list, undefined);
    let selected = false;
    props.onFocus({ currentTarget: { select() { selected = true; } } }); assert.equal(selected, true);
  }
});

test("typing stays local until blur normalizes short clock forms using recurring-task helpers", () => {
  const h = harness();
  h.input("start").props.onChange({ target: { value: "a930" } });
  assert.equal(h.state.form.start, "930"); assert.equal(h.calls.length, 0);
  h.input("start").props.onBlur({ currentTarget: { value: "930" } });
  assert.equal(h.state.form.start, "09:30"); assert.equal(h.state.form.end, "10:00");
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [{ start: 570, end: 600 }]);
});

test("Enter commits and selects the input instead of submitting the form", () => {
  const h = harness();
  assert.deepEqual(h.key("end", "Enter", "1030"), { prevented: true, selected: true });
  assert.equal(h.state.form.end, "10:30");
});

test("arrow keys use five-minute steps and preserve the minimum and same-day boundaries", () => {
  const h = harness("23:30", "23:59");
  assert.equal(h.key("start", "ArrowUp").prevented, true); assert.equal(h.state.form.start, "23:35");
  h.key("start", "ArrowUp", "23:59"); assert.equal(h.state.form.start, "23:44");
  h.key("end", "ArrowUp"); assert.equal(h.state.form.end, "23:59");
  h.key("end", "ArrowDown"); assert.equal(h.state.form.end, "23:59");
  const midnight = harness("00:00", "00:15");
  midnight.key("start", "ArrowDown"); assert.equal(midnight.state.form.start, "00:00");
});

test("invalid input restores the last valid time and Escape discards an uncommitted edit", () => {
  const h = harness();
  for (const raw of ["", "99:99", "24:00", "09:99"]) {
    h.input("start").props.onBlur({ currentTarget: { value: raw } });
    assert.equal(h.state.form.start, "09:00");
  }
  h.input("start").props.onChange({ target: { value: "930" } });
  assert.equal(h.key("start", "Escape").prevented, true);
  assert.equal(h.state.form.start, "09:00");
});

test("creation still rejects malformed raw clocks before any IPC call", async () => {
  const h = harness();
  for (const raw of ["930", "09:99", "-1:00", "24:00", ""]) {
    h.state.form.start = raw;
    await h.state.submit({ preventDefault() {} });
    assert.match(h.state.error, /结束时间/);
  }
});
