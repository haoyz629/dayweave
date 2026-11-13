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
function approvedDeclarations(ending) {
  const values = {};
  postcss.parse(readFileSync(new URL("./task-comfort.css", import.meta.url), "utf8")).walkRules(rule => {
    if (rule.selector.endsWith(ending)) rule.walkDecls(decl => { values[decl.prop] = decl.value; });
  });
  assert.ok(Object.keys(values).length, ending);
  return values;
}

test("compact cards use list-scoped spacing, rounded borders and distinct selection", () => {
  const row = declarations(`${list} .ledger-row.task-capsule-row`);
  assert.equal(row.width, "calc(100% - 24px)");
  assert.equal(row.margin, "6px 12px 0");
  assert.equal(row.border, "1px solid var(--task-card-border)");
  assert.equal(row["border-radius"], "14px");
  assert.equal(row.background, "var(--task-card-bg)");
  assert.equal(approvedDeclarations(".task-capsule-content").padding, "12px");
  const selected = declarations(`${list} .ledger-row.task-capsule-row.selected`);
  assert.equal(selected["border-color"], "var(--task-card-selected-border)");
  assert.equal(selected.background, "var(--task-card-selected-bg)");
  assert.equal(approvedDeclarations(".ledger-row.task-capsule-row:is(.selected, :hover)")["box-shadow"], "none");
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

test("single-line titles get a full row and metadata stays below, not beside quick actions", () => {
  const heading = approvedDeclarations(".task-capsule-heading");
  assert.equal(heading["flex-wrap"], "wrap");
  assert.equal(heading["padding-right"], undefined);
  const title = declarations(".task-capsule-heading > strong");
  assert.equal(title["text-overflow"], "ellipsis");
  assert.equal(title["white-space"], "nowrap");
  assert.equal(approvedDeclarations(".task-capsule-heading-meta")["max-width"], "100%");
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

test("compact quick actions overlay the upper right without reserving a bottom row", () => {
  const actions = declarations(`${list} .task-capsule-row .ledger-row-actions`);
  assert.equal(actions.position, "absolute");
  assert.equal(actions.top, "8px");
  assert.equal(actions.right, "8px");
  assert.equal(actions["min-height"], "28px");
  assert.equal(actions.transform, "none");
  assert.equal(actions.margin, "0");
  const button = declarations(`${list} .task-capsule-row .ledger-quick-action`);
  assert.equal(button.height, "28px");
  assert.equal(button["font-size"], "12px");
  assert.equal(button["font-weight"], "500");
  assert.equal(button["border-color"], "var(--color-gray-edge)");
  assert.equal(button["box-shadow"], "none");
  assert.equal(declarations(`${list} .task-capsule-row .ledger-quick-action.caution`)["border-color"], "var(--color-amber-edge)");
  assert.equal(declarations(`${list} .task-capsule-row .ledger-quick-action.danger`)["border-color"], "var(--color-red-edge)");
  assert.equal(declarations(".ledger-row-actions").opacity, "0");
  assert.equal(declarations(".ledger-row-actions")["pointer-events"], "none");
  assert.match(css, /\.task-ledger-row:hover \.ledger-row-actions, \.task-ledger-row:has\(:focus-visible\) \.ledger-row-actions/);
  assert.equal(declarations(`${list} .task-capsule-footer`)["padding-right"], undefined);
  assert.doesNotMatch(app, /TaskCardActions|task-card-action-menu/);
  assert.doesNotMatch(css, /task-card-action-menu/);
  assert.equal((app.match(/<div className="ledger-row-actions"/g) || []).length, 4);
});

test("deadline icon, flat filters and persisted list width keep their behavior", () => {
  assert.match(app, /<Icon name=\{deadline \? "clock" : icon\} size=\{13\}/);
  assert.match(app, /id="task-status-filter"[^>]*task-tag-filter-options[^>]*statusFilterExpanded/);
  assert.match(app, /const TASK_LEDGER_LIST_DEFAULT_WIDTH = 400;/);
  assert.match(app, /const TASK_LEDGER_WIDTH_SETTING = "ui.task_ledger_list_width";/);
  for (const tone of ["open", "scheduled", "not_completed"]) {
    assert.ok(declarations(`${list} .task-capsule-status.status-${tone}`).color);
  }
});

test("priority border colors are at least as specific as the compact badge border", () => {
  for (const priority of ["low", "medium", "high"]) {
    const badge = declarations(`${list} .task-capsule-footer .priority-${priority}`);
    assert.equal(badge["border-color"], `var(--priority-${priority}-border)`);
    assert.equal(declarations(`${list} .task-capsule-footer .priority-badge`).border, "1px solid");
    assert.equal(approvedDeclarations(".task-capsule-footer .priority-badge").height, "24px");
  }
});

test("cards live in their own scrollport below the filter header so hover actions clip together", () => {
  assert.match(app, /className="task-ledger-scroll">/);
  assert.ok(app.indexOf('<header className="task-queue-header">') < app.indexOf('<div className="task-ledger-scroll">'));
  const scroller = postcss.parse(css).nodes.reduce((acc, rule) => rule.type === "rule" && rule.selectors?.includes("html:root:not([data-mode=\"dark\"]) .tasks-workspace .task-ledger-scroll") ? [...acc, ...rule.nodes.filter(n => n.type === "decl").map(n => [n.prop, n.value])] : acc, []);
  assert.deepEqual(Object.fromEntries(scroller), { flex: "1 1 auto", "min-width": "0", "min-height": "0", "overflow-x": "hidden", "overflow-y": "auto", "padding-bottom": "24px", "scrollbar-gutter": "auto" });
});
