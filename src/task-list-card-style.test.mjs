import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const sheet = postcss.parse(css);
const list = ".next-workspace .task-ledger-list";
function declarations(selector) {
  const values = {};
  sheet.walkRules(rule => {
    if (rule.selector !== selector) return;
    rule.walkDecls(decl => { values[decl.prop] = decl.value; });
  });
  assert.ok(Object.keys(values).length, `Missing selector: ${selector}`);
  return values;
}

test("compact cards use list-scoped spacing, rounded borders and distinct selection", () => {
  const row = declarations(`${list} .ledger-row.task-capsule-row`);
  assert.equal(row.width, "calc(100% - 24px)");
  assert.equal(row.margin, "10px 12px 0");
  assert.equal(row.border, "1px solid var(--task-card-border)");
  assert.equal(row["border-radius"], "14px");
  assert.equal(row.background, "var(--task-card-bg)");
  assert.equal(declarations(`${list} .task-capsule-content`).padding, "14px 14px 12px");
  const selected = declarations(`${list} .ledger-row.task-capsule-row.selected`);
  assert.equal(selected["border-color"], "var(--task-card-selected-border)");
  assert.equal(selected.background, "var(--task-card-selected-bg)");
  assert.notEqual(selected["box-shadow"], "none");
});

test("every card palette token is local to the list and has a dark value", () => {
  const light = declarations(list);
  const dark = declarations(`html[data-mode="dark"] ${list}`);
  const palette = Object.keys(light).filter(name => name.startsWith("--task-card-"));
  assert.ok(palette.length >= 10);
  for (const name of palette) {
    assert.ok(dark[name], `Missing dark token: ${name}`);
    assert.notEqual(dark[name], light[name], name);
  }
  sheet.walkRules(rule => {
    rule.walkDecls(/^--task-card-/, () => {
      assert.ok(rule.selector.startsWith(list) || rule.selector.startsWith(`html[data-mode="dark"] ${list}`), rule.selector);
    });
  });
});

test("title metadata stays visible and reserves room for one or two hover actions", () => {
  const heading = declarations(`${list} .task-capsule-heading`);
  assert.equal(heading["padding-right"], "var(--task-card-actions-space, 0px)");
  assert.equal(heading["flex-wrap"], "wrap");
  assert.equal(declarations(`${list} .task-capsule-heading-meta`).opacity, "1");
  const single = declarations(`${list} .task-capsule-row:has(.ledger-row-actions > button)`);
  const double = declarations(`${list} .task-capsule-row:has(.ledger-row-actions > button:nth-child(2))`);
  assert.ok(parseInt(single["--task-card-actions-space"]) >= 60);
  assert.ok(parseInt(double["--task-card-actions-space"]) > parseInt(single["--task-card-actions-space"]));
  assert.equal(declarations(`${list} .task-capsule-heading > strong`)["font-size"], "16px");
});

test("long dates and workload can wrap instead of colliding with the status", () => {
  assert.equal(declarations(`${list} .task-capsule-footer`)["flex-wrap"], "wrap");
  assert.equal(declarations(`${list} .task-capsule-content .task-capsule-facts`)["flex-wrap"], "wrap");
  assert.equal(declarations(`${list} .task-capsule-facts > span`)["max-width"], "100%");
  assert.equal(declarations(`${list} .task-capsule-status`)["min-height"], "24px");
});

test("hover actions keep pointer and keyboard activation without sticking after clicks", () => {
  const hidden = declarations(".ledger-row-actions");
  assert.equal(hidden.opacity, "0");
  assert.equal(hidden["pointer-events"], "none");
  assert.match(css, /\.task-ledger-row:hover \.ledger-row-actions, \.task-ledger-row:has\(:focus-visible\) \.ledger-row-actions/);
  assert.doesNotMatch(css, /\.task-ledger-row:focus-within \.ledger-row-actions/);
  assert.match(css, /@media \(hover: none\) \{\s*\.next-workspace \.task-ledger-list \.task-capsule-row \.ledger-row-actions \{ opacity: 1; pointer-events: auto; transform: none;/);
});

test("deadline icon, filter control and persisted list width keep their existing behavior", () => {
  assert.match(app, /<Icon name=\{deadline \? "clock" : icon\} size=\{13\}/);
  assert.match(app, /className=\{`queue-filter-button/);
  assert.match(app, /const TASK_LEDGER_LIST_DEFAULT_WIDTH = 320;/);
  assert.match(app, /const TASK_LEDGER_WIDTH_SETTING = "ui.task_ledger_list_width";/);
  for (const tone of ["open", "scheduled", "not_completed"]) {
    assert.ok(declarations(`${list} .task-capsule-status.status-${tone}`).color);
  }
});

test("priority border colors are at least as specific as the compact badge border", () => {
  for (const priority of ["low", "medium", "high"]) {
    const badge = declarations(`${list} .task-capsule-heading .priority-${priority}`);
    assert.equal(badge["border-color"], `var(--priority-${priority}-border)`);
  }
});
