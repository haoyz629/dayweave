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
  assert.equal(row.margin, "6px 12px 0");
  assert.equal(row.border, "1px solid var(--task-card-border)");
  assert.equal(row["border-radius"], "14px");
  assert.equal(row.background, "var(--task-card-bg)");
  assert.equal(declarations(`${list} .task-capsule-content`).padding, "10px 10px 8px");
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

test("single-line titles reserve room for metadata, not quick actions", () => {
  const heading = declarations(`${list} .task-capsule-heading`);
  assert.equal(heading["flex-wrap"], "nowrap");
  assert.equal(heading["padding-right"], undefined);
  const title = declarations(".task-capsule-heading > strong");
  assert.equal(title["text-overflow"], "ellipsis");
  assert.equal(title["white-space"], "nowrap");
  assert.equal(declarations(`${list} .task-capsule-heading-meta`)["max-width"], "62%");
  assert.equal(declarations(`${list} .task-capsule-heading > strong`)["font-size"], "15px");
  assert.match(app, /sourceType === "ai_assistant" && <span/);
  assert.doesNotMatch(app, /aria-label=\{sourceType === "ai_assistant" \? "AI 创建" : "手动创建"/);
});

test("long dates and workload can wrap instead of colliding with the status", () => {
  assert.equal(declarations(`${list} .task-capsule-footer`)["flex-wrap"], "wrap");
  assert.equal(declarations(`${list} .task-capsule-content .task-capsule-facts`)["flex-wrap"], "wrap");
  assert.equal(declarations(`${list} .task-capsule-facts > span`)["max-width"], "100%");
  assert.equal(declarations(`${list} .task-capsule-status`)["min-height"], "24px");
});

test("quick actions appear directly at the upper right on hover or keyboard focus", () => {
  const actions = declarations(`${list} .task-capsule-row .ledger-row-actions`);
  assert.equal(actions.top, "8px");
  assert.equal(actions.right, "8px");
  assert.equal(actions.bottom, undefined);
  assert.equal(declarations(".ledger-row-actions").opacity, "0");
  assert.equal(declarations(".ledger-row-actions")["pointer-events"], "none");
  assert.match(css, /\.task-ledger-row:hover \.ledger-row-actions, \.task-ledger-row:has\(:focus-visible\) \.ledger-row-actions/);
  assert.equal(declarations(`${list} .task-capsule-footer`)["padding-right"], undefined);
  assert.doesNotMatch(app, /TaskCardActions|task-card-action-menu/);
  assert.doesNotMatch(css, /task-card-action-menu/);
  assert.equal((app.match(/<div className="ledger-row-actions"/g) || []).length, 4);
});

test("deadline icon, filter control and persisted list width keep their existing behavior", () => {
  assert.match(app, /<Icon name=\{deadline \? "clock" : icon\} size=\{13\}/);
  assert.match(app, /className=\{`queue-filter-button/);
  assert.match(app, /const TASK_LEDGER_LIST_DEFAULT_WIDTH = 340;/);
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
