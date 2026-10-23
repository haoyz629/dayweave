import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";

const app = ts.createSourceFile("App.tsx", readFileSync(new URL("./App.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = app.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "RecurringValidityPicker");
let grid;
function collect(node) {
  if (ts.isJsxElement(node) && node.openingElement.getText(app).includes('className="recurring-calendar-grid"')) grid = node.getText(app);
  ts.forEachChild(node, collect);
}
collect(component);
const compiledGrid = ts.transpileModule(`(${grid})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
function rule(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `missing style: ${selector}`);
  return css.slice(start, css.indexOf("}", start) + 1);
}
function declaration(selector, property) {
  return rule(selector).match(new RegExp(`${property}: ([^;]+);`))?.[1];
}
function calendar({ start = "2026-10-23", end = "2026-10-29", active = "start" } = {}) {
  const clicks = [];
  const cells = Array.from({ length: 42 }, (_, index) => {
    const key = new Date(Date.UTC(2026, 8, 28 + index)).toISOString().slice(0, 10);
    return { key, day: Number(key.slice(8)), inMonth: key.startsWith("2026-10") };
  });
  const context = { React, cells, hasEnd: Boolean(end), draftStartsOn: start, draftEndsOn: end, activeField: active, todayDate: "2026-10-23", handleDateClick: key => clicks.push(key) };
  const rendered = vm.runInNewContext(compiledGrid, context);
  return { days: rendered.props.children, clicks };
}
const dateButton = node => React.Children.toArray(node.props.children).find(child => child.type === "button");

test("recurring and ordinary calendars share light/dark range colors", () => {
  for (const prefix of ["", 'html[data-mode="dark"] ']) {
    for (const property of ["--schedule-range-fill", "--schedule-range-node"]) {
      assert.equal(declaration(`${prefix}.recurring-calendar-grid`, property), declaration(`${prefix}.schedule-picker-calendar`, property));
    }
  }
});

test("recurring range nodes fill their cells with mirrored rounded ends and no white outline or shadow", () => {
  const node = rule(".recurring-calendar-btn.circle");
  assert.match(node, /width: 100%;/);
  assert.match(node, /height: 100%;/);
  assert.match(node, /background: var\(--schedule-range-node\);/);
  assert.match(node, /box-shadow: none;/);
  assert.match(node, /outline: none;/);
  assert.equal(declaration(".recurring-calendar-cell.is-start .recurring-calendar-btn.circle", "border-radius"), "19px 0 0 19px");
  assert.equal(declaration(".recurring-calendar-cell.is-end .recurring-calendar-btn.circle", "border-radius"), "0 19px 19px 0");
  assert.equal(declaration(".recurring-calendar-cell .recurring-calendar-half-bar", "display"), "none");
  assert.equal(declaration(".recurring-calendar-cell", "height"), "38px");
  assert.doesNotMatch(rule(".recurring-calendar-grid"), /(?:^|\n)\s*(?:column-)?gap:/);
});

test("intermediate recurring dates keep a square translucent band and normal reading color even at week boundaries", () => {
  const middle = rule(".recurring-calendar-cell.in-range-middle");
  assert.match(middle, /border-radius: 0;/);
  assert.match(middle, /background: var\(--schedule-range-fill\);/);
  assert.match(middle, /color: var\(--jx-ink-soft\);/);
  assert.doesNotMatch(css, /\.recurring-calendar-cell\.in-range-middle\.(?:row-start|row-end|outside)\s*\{/);
  assert.doesNotMatch(css, /html\[data-mode="dark"\] \.recurring-calendar-cell\.in-range-middle/);
  const { days } = calendar({ start: "2026-10-20", end: "2026-10-29" });
  assert.match(days.find(day => day.key === "2026-10-25").props.className, /in-range-middle.*row-end/);
  assert.match(days.find(day => day.key === "2026-10-26").props.className, /in-range-middle.*row-start/);
});

test("single-day and open-ended recurring ranges use a complete closed node", () => {
  for (const end of ["2026-10-23", ""]) {
    const { days } = calendar({ end });
    const selected = days.find(day => day.key === "2026-10-23");
    assert.match(selected.props.className, /is-single-selected/);
    assert.match(dateButton(selected).props.className, /circle/);
    assert.equal(days.filter(day => /is-start|is-end|in-range-middle/.test(day.props.className)).length, 0);
  }
  const selector = ".recurring-calendar-cell.is-single-selected .recurring-calendar-btn.circle";
  assert.equal(declaration(selector, "width"), "38px");
  assert.equal(declaration(selector, "max-width"), "100%");
  assert.equal(declaration(selector, "border-radius"), "19px");
});

test("both recurring endpoints keep the same node style regardless of the active editing target", () => {
  for (const active of ["start", "end"]) {
    const { days } = calendar({ active });
    for (const key of ["2026-10-23", "2026-10-29"]) {
      assert.equal(dateButton(days.find(day => day.key === key)).props.className, "recurring-calendar-btn circle");
    }
  }
  assert.doesNotMatch(css, /\.recurring-calendar-cell[^\{]*\.selected\s*\{/);
  assert.match(rule(".recurring-calendar-btn:focus-visible"), /outline: 2px solid var\(--schedule-range-node\)/);
});

test("recurring date cells retain their original click handling", () => {
  const { days, clicks } = calendar();
  for (const key of ["2026-10-23", "2026-10-26", "2026-10-29", "2026-10-30"]) {
    days.find(day => day.key === key).props.onClick();
  }
  assert.deepEqual(clicks, ["2026-10-23", "2026-10-26", "2026-10-29", "2026-10-30"]);
});
