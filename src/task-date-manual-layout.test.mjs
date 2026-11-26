import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as controls from "./time-range-control.ts";
import postcss from "postcss";

const source = ts.createSourceFile("App.tsx", readFileSync(new URL("./App.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = name => source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
const fieldsSource = ts.createSourceFile("task-time-range-fields.tsx", readFileSync(new URL("./task-time-range-fields.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const fields = fieldsSource.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(fieldsSource).replace(/^export /, "")).join("\n");
function descendants(node, predicate) {
  const found = [];
  function visit(current) { if (predicate(current)) found.push(current); ts.forEachChild(current, visit); }
  visit(node);
  return found;
}
const hasClass = (node, value) => ts.isJsxElement(node) && node.openingElement.attributes.properties.some(prop => prop.name?.getText(source) === "className" && ts.isStringLiteral(prop.initializer) && prop.initializer.text.split(" ").includes(value));

test("both date dialogs keep boundaries in the right panel and only request duration presets", () => {
  for (const name of ["TaskScheduleEditor", "RecurringValidityPicker"]) {
    const component = declaration(name);
    const panels = descendants(component, node => hasClass(node, "schedule-picker-range-panel"));
    assert.equal(panels.length, 1);
    assert.equal(descendants(component, node => hasClass(node, "schedule-picker-boundaries")).length, 1);
    assert.equal(descendants(panels[0], node => hasClass(node, "schedule-picker-boundaries")).length, 1);
    assert.match(component.getText(source), /manual-time-picker/);
    const rail = descendants(panels[0], node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === "BlockEditorTimeRangeRail");
    assert.equal(rail.length, 1);
    assert.ok(rail[0].attributes.properties.some(prop => prop.name?.getText(source) === "presetsOnly" && !prop.initializer));
    assert.ok(!rail[0].attributes.properties.some(prop => prop.name?.getText(source) === "describedBy"));
  }
});

function range(props = {}) {
  const changes = [];
  const globals = {
    React, Fragment: React.Fragment, ...controls,
    Icon: () => null, TimeWheelTrigger: () => null, TimeWheelPopover: () => null, MIN_TASK_BLOCK_MINUTES: 15,
    useRef: value => ({ current: value }), useState: value => [typeof value === "function" ? value() : value, () => {}], useEffect() {},
    formatWorkloadMinutes: value => `${value} 分钟`
  };
  const code = [fields, ...["BlockEditorTimeRangeRail", "clockMinutes", "minutesClock"].map(name => declaration(name).getText(source))].join("\n");
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, globals);
  const tree = globals.BlockEditorTimeRangeRail({ start: "09:30", end: "10:30", onChange: next => changes.push({ ...next }), ...props });
  function buttons(node) {
    if (!React.isValidElement(node)) return [];
    if (node.type === globals.TaskDurationPresets) return buttons(node.type(node.props));
    return [...(node.type === "button" ? [node] : []), ...React.Children.toArray(node.props.children).flatMap(buttons)];
  }
  return { html: renderToStaticMarkup(tree), buttons: buttons(tree), changes };
}

test("presets-only rendering removes timeline, duplicate inputs and dragging instructions", () => {
  const h = range({ presetsOnly: true, describedBy: "old-rail-help" });
  assert.equal(h.buttons.length, 6);
  assert.match(h.html, /aria-pressed="true">1h<\/button>/);
  assert.doesNotMatch(h.html, /<input|time-rail-surface|time-range-values|old-rail-help|拖动|方向键/);
  assert.match(h.html, /快捷时长/);
  h.buttons[4].props.onClick();
  assert.deepEqual(h.changes, [{ start: "09:30", end: "11:00" }]);
});

test("presets preserve ordinary day-end, recurring midnight, disabled and cross-day guards", () => {
  const ordinary = range({ presetsOnly: true, start: "23:30", end: "23:45" });
  assert.deepEqual(ordinary.buttons.map(button => button.props.disabled), [false, true, true, true, true, true]);
  const recurring = range({ presetsOnly: true, start: "23:30", end: "23:45", maxMinute: 1440, allowMidnightEnd: true, minimumDuration: 1 });
  assert.deepEqual(recurring.buttons.map(button => button.props.disabled), [false, false, true, true, true, true]);
  recurring.buttons[1].props.onClick();
  assert.deepEqual(recurring.changes, [{ start: "23:30", end: "24:00" }]);
  assert.ok(range({ presetsOnly: true, disabled: true }).buttons.every(button => button.props.disabled));
  const crossDay = range({ presetsOnly: true, showPresets: false, endMinuteOffset: 1440, maxMinute: 2879 });
  assert.equal(crossDay.buttons.length, 0);
  assert.doesNotMatch(crossDay.html, /<input|time-rail-surface/);
});

test("the default rail still renders its time inputs and sliders for unrelated callers", () => {
  const h = range();
  assert.equal((h.html.match(/type="text"/g) ?? []).length, 2);
  assert.equal((h.html.match(/type="range"/g) ?? []).length, 2);
  assert.match(h.html, /time-rail-surface/);
});

test("manual layout CSS stays scoped to date dialogs and light mode", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const local = css.slice(css.indexOf("/* Approved manual date picker:"));
  assert.match(local, /\.schedule-picker-range-panel \{ justify-content: center; padding: 24px;/);
  assert.match(local, /gap: 12px; padding: 0;/);
  assert.match(local, /\.selection-presets-row \{ margin-top: 20px;/);
  for (const line of local.split("\n").filter(line => line.includes(" { "))) {
    assert.ok(line.trim().startsWith('html:root:not([data-mode="dark"]) .manual-time-picker'), line);
  }
});

test("desktop date dialogs spread only right-panel spacing without expanding the narrow layout", () => {
  const css = postcss.parse(readFileSync(new URL("./styles.css", import.meta.url), "utf8"));
  const scope = 'html:root:not([data-mode="dark"]) .manual-time-picker ';
  const expected = new Map([
    [".schedule-picker-range-panel > header", ["margin-bottom", "24px"]],
    [".schedule-picker-boundaries.schedule-picker-rows", ["gap", "20px"]],
    [".schedule-picker-range-panel .selection-presets-row", ["margin-top", "32px"]],
    [".schedule-occurrence-preview", ["margin-top", "32px"]]
  ]);
  const actual = new Map();
  css.walkAtRules("media", media => {
    if (media.params !== "(min-width: 761px)") return;
    media.walkRules(rule => {
      if (!rule.selector.startsWith(scope)) return;
      actual.set(rule.selector.slice(scope.length), rule.nodes.map(node => [node.prop, node.value]).flat());
    });
  });
  assert.deepEqual(actual, expected);
});

test("recurring calendar puts selection feedback before the separated validity shortcuts", () => {
  const calendar = descendants(declaration("RecurringValidityPicker"), node => hasClass(node, "schedule-picker-calendar"))[0];
  const elements = calendar.children.filter(ts.isJsxElement);
  const feedback = elements.findIndex(node => node.openingElement.tagName.getText(source) === "footer");
  const shortcuts = elements.findIndex(node => hasClass(node, "schedule-validity-presets"));
  assert.equal(shortcuts, feedback + 1);
  assert.ok(feedback >= 0);
});

test("validity shortcuts fill the divider width with six equal columns and three on narrow windows", () => {
  const css = postcss.parse(readFileSync(new URL("./styles.css", import.meta.url), "utf8"));
  const selector = 'html:root:not([data-mode="dark"]) .manual-time-picker .schedule-validity-presets';
  const columns = [];
  css.walkRules(selector, rule => {
    rule.walkDecls("grid-template-columns", decl => columns.push([rule.parent.type === "atrule" ? rule.parent.params : null, decl.value]));
  });
  assert.deepEqual(columns, [[null, "repeat(6, minmax(0, 1fr))"], ["(max-width: 899px)", "repeat(3, minmax(0, 1fr))"]]);
  const local = css.toString().slice(css.toString().indexOf("/* Approved manual date picker:"));
  assert.match(local, /\.schedule-validity-presets \{[^}]*display: grid;[^}]*gap: 6px;/);
  assert.match(local, /\.schedule-validity-presets > button \{ min-width: 0; width: 100%; padding: 4px 2px; white-space: nowrap; \}/);
});

test("date picker spacing is compact and the boundary gap inherits the panel surface", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const local = css.slice(css.indexOf("/* Approved manual date picker:"));
  assert.match(local, /\.schedule-picker-boundaries\.schedule-picker-rows \{[^}]*background: var\(--jx-raised\);/);
  assert.match(local, /\.schedule-validity-presets \{ margin-top: 12px; padding-top: 12px; border-top: 1px solid/);
  assert.match(local, /\.schedule-picker-calendar > footer \{ min-height: 24px; padding-top: 0; border-top: 0;/);
  assert.match(local, /\.schedule-picker-body \{ min-height: 0;/);
});

test("light task list removes the idle scrollbar gutter and draws the divider at the list edge", () => {
  const css = readFileSync(new URL("./task-comfort.css", import.meta.url), "utf8");
  assert.match(css, /html:root:not\(\[data-mode="dark"\]\) \.tasks-workspace \.task-ledger-list \{[^}]*scrollbar-gutter: auto;/);
  assert.match(css, /\.ledger-resize-handle::after \{ left: 0; transform: none; \}/);
  assert.match(css, /\.ledger-row\.task-capsule-row \{[^}]*width: 100%;/);
});
