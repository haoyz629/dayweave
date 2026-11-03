import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compactBlockDuration } from "./task-block-display.ts";

const source = ts.createSourceFile("task-time-range-fields.tsx", readFileSync(new URL("./task-time-range-fields.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "TaskTimeRangeFields").getText(source).replace("export ", "");
const context = vm.createContext({ React, compactBlockDuration });
vm.runInContext(ts.transpileModule(declaration, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, context);
const render = (props = {}) => context.TaskTimeRangeFields({
  startInput: React.createElement("input", { "aria-label": "输入开始时间", defaultValue: "09:00" }),
  endInput: React.createElement("input", { "aria-label": "输入结束时间", defaultValue: "10:00" }),
  duration: 60, maxDuration: 900, onDuration() {}, ...props
});
const buttons = tree => React.Children.toArray(tree.props.children[2].props.children[1]);

test("shared range shows the same four presets without a timeline or submit button", () => {
  const tree = render(), markup = renderToStaticMarkup(tree);
  assert.equal(buttons(tree).length, 4);
  assert.deepEqual(buttons(tree).map(button => button.props.type), ["button", "button", "button", "button"]);
  assert.deepEqual(buttons(tree).map(button => button.props["aria-pressed"]), [false, false, true, false]);
  assert.match(markup, /时间范围/);
  assert.match(markup, /推荐时长/);
  assert.doesNotMatch(markup, /type="range"|time-rail-surface/);
});

test("preset clicks pass the requested duration to the existing caller", () => {
  const calls = [];
  buttons(render({ onDuration: value => calls.push(value) })).forEach(button => button.props.onClick());
  assert.deepEqual(calls, [15, 30, 60, 120]);
});

test("late-day, invalid-time and saving states disable unavailable durations", () => {
  assert.deepEqual(buttons(render({ maxDuration: 30 })).map(button => button.props.disabled), [false, false, true, true]);
  for (const props of [{ maxDuration: 14 }, { maxDuration: NaN }, { disabled: true }]) {
    assert.ok(buttons(render(props)).every(button => button.props.disabled));
  }
  assert.equal(render({ showPresets: false }).props.children[2], false);
});
