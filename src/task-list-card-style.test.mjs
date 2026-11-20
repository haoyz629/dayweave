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
  const row = approvedDeclarations(".ledger-row.task-capsule-row");
  assert.equal(row.width, "100%");
  assert.equal(row.margin, "0");
  assert.equal(row.border, "1px solid #e2e8f0");
  assert.equal(row["border-radius"], "10px");
  assert.equal(row.background, "#ffffff");
  assert.equal(approvedDeclarations(".ledger-row-select.task-capsule-select").padding, "10px 12px");
  assert.equal(approvedDeclarations(".task-capsule-content").padding, "0");
  const selected = approvedDeclarations(".ledger-row.task-capsule-row.selected");
  assert.equal(selected["border-color"], "#3168dc");
  assert.equal(selected.background, "#eff5ff");
  assert.equal(row["box-shadow"], "none");
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

test("single-line titles share row with status slot and metadata stays in the bottom footer", () => {
  const heading = approvedDeclarations(".task-capsule-heading");
  assert.equal(heading.display, "grid");
  assert.equal(heading["grid-template-columns"], "minmax(0, 1fr) auto");
  const title = approvedDeclarations(".task-capsule-heading > strong");
  assert.equal(title["text-overflow"], "ellipsis");
  assert.equal(title["white-space"], "nowrap");
  assert.equal(title["font-size"], "13.5px");
  const headingMeta = approvedDeclarations(".task-capsule-heading-meta");
  assert.equal(headingMeta["max-width"], "none");
  assert.equal(headingMeta.overflow, "hidden");
  assert.equal(approvedDeclarations(".task-capsule-content .task-capsule-facts").flex, "0 0 auto");
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

test("deadline icon, dropdown filters and persisted list width keep their behavior", () => {
  assert.match(app, /<Icon name=\{deadline \? "clock" : icon\} size=\{13\}/);
  assert.match(app, /<TaskStatusDropdown id="task-status-filter"/);
  assert.match(app, /const TASK_LEDGER_LIST_DEFAULT_WIDTH = 400;/);
  assert.match(app, /const TASK_LEDGER_WIDTH_SETTING = "ui.task_ledger_list_width";/);
  for (const tone of ["open", "scheduled", "not_completed"]) {
    assert.ok(declarations(`${list} .task-capsule-status.status-${tone}`).color);
  }
});

test("priority border colors are at least as specific as the compact badge border", () => {
  assert.equal(approvedDeclarations(".task-ledger-list .priority-badge").height, "18px");
  assert.equal(approvedDeclarations(".task-ledger-list .priority-badge").border, "1px solid");
  for (const priority of ["urgent", "low", "medium", "high"]) {
    const badge = approvedDeclarations(`.task-capsule-footer .priority-${priority}`);
    assert.ok(badge["border-color"], priority);
  }
});

test("cards live in their own scrollport below the filter header so hover actions clip together", () => {
  assert.match(app, /className="task-ledger-scroll">/);
  assert.ok(app.indexOf('<header className="task-queue-header">') < app.indexOf('<div className="task-ledger-scroll">'));
  const scroller = postcss.parse(css).nodes.reduce((acc, rule) => rule.type === "rule" && rule.selectors?.includes("html:root:not([data-mode=\"dark\"]) .tasks-workspace .task-ledger-scroll") ? [...acc, ...rule.nodes.filter(n => n.type === "decl").map(n => [n.prop, n.value])] : acc, []);
  assert.deepEqual(Object.fromEntries(scroller), { flex: "1 1 auto", "min-width": "0", "min-height": "0", "overflow-x": "hidden", "overflow-y": "auto", "padding-bottom": "24px", "scrollbar-gutter": "auto" });
});
