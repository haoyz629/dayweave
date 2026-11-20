import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compactBlockDuration } from "./task-block-display.ts";

const source = ts.createSourceFile("task-time-range-fields.tsx", readFileSync(new URL("./task-time-range-fields.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = source.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(source).replace(/^export /, ""));
const context = vm.createContext({ React, compactBlockDuration });
vm.runInContext(ts.transpileModule(declarations.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, context);
const render = (props = {}) => context.TaskTimeRangeFields({
  startInput: React.createElement("input", { "aria-label": "输入开始时间", defaultValue: "09:00" }),
  endInput: React.createElement("input", { "aria-label": "输入结束时间", defaultValue: "10:00" }),
  duration: 60, maxDuration: 900, onDuration() {}, ...props
});
const buttons = tree => React.Children.toArray(context.TaskDurationPresets(tree.props.children[2].props).props.children);

test("shared range shows the six slide-create presets without a timeline or submit button", () => {
  const tree = render(), markup = renderToStaticMarkup(tree);
  assert.deepEqual(buttons(tree).map(button => button.props.children), ["15m", "30m", "45m", "1h", "1.5h", "2h"]);
  assert.ok(buttons(tree).every(button => button.props.type === "button"));
  assert.deepEqual(buttons(tree).map(button => button.props["aria-pressed"]), [false, false, false, true, false, false]);
  assert.match(markup, /时间范围/);
  assert.match(markup, /role="group" aria-label="快捷时长"/);
  assert.doesNotMatch(markup, /type="range"|time-rail-surface/);
});

test("clock labels do not duplicate the accessible names of the supplied inputs", () => {
  const markup = renderToStaticMarkup(render());
  assert.match(markup, /<small aria-hidden="true">开始<\/small><input aria-label="输入开始时间"/);
  assert.match(markup, /<small aria-hidden="true">结束<\/small><input aria-label="输入结束时间"/);
});

test("preset clicks pass the requested duration to the existing caller", () => {
  const calls = [];
  buttons(render({ onDuration: value => calls.push(value) })).forEach(button => button.props.onClick());
  assert.deepEqual(calls, [15, 30, 45, 60, 90, 120]);
});

test("late-day, invalid-time and saving states disable unavailable durations", () => {
  assert.deepEqual(buttons(render({ maxDuration: 30 })).map(button => button.props.disabled), [false, false, true, true, true, true]);
  for (const props of [{ maxDuration: 14 }, { maxDuration: NaN }, { disabled: true }]) {
    assert.ok(buttons(render(props)).every(button => button.props.disabled));
  }
  assert.equal(render({ showPresets: false }).props.children[2], false);
});
