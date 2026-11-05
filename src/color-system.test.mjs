import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import postcss from "postcss";
import { taskBlockTypeLabels } from "./task-block-display.ts";

const css = readFileSync(new URL("./color-system.css", import.meta.url), "utf8");
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const facts = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "TimelineTaskFacts");
const context = vm.createContext({ React, taskBlockTypeLabels, priorityCopy: { high: "高优先级", medium: "中优先级", low: "低优先级" } });
vm.runInContext(ts.transpileModule(facts.getText(source), { compilerOptions: { jsx: ts.JsxEmit.React } }).outputText, context);

test("unset priorities render no timeline badge in full or compact blocks", () => {
  for (const priority of [null, undefined]) for (const inline of [false, true]) {
    const html = renderToStaticMarkup(context.TimelineTaskFacts({ type: "single", priority, inline }));
    assert.doesNotMatch(html, /priority-|未设|无优先级/);
    assert.match(html, /单日任务/);
  }
  for (const priority of ["high", "medium", "low"]) {
    assert.match(renderToStaticMarkup(context.TimelineTaskFacts({ type: "multi", priority })), new RegExp(`priority-${priority}`));
  }
  assert.doesNotMatch(renderToStaticMarkup(context.TimelineTaskFacts({ type: "recurring", priority: "high" })), /priority-high/);
  assert.doesNotMatch(app, /未设优先级|无优先级/);
  assert.doesNotMatch(app, /onChange\(\{ \.\.\.form, priority: null \}\)/);
});

function palette(block) { return Object.fromEntries([...block.matchAll(/(--color-[\w-]+):\s*(#[\da-f]{6})/gi)].map(([, key, value]) => [key, value])); }
function luminance(hex) {
  return hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
}
function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
const light = palette(css.match(/html:root \{([^}]+)\}/)[1]);
const dark = { ...light, ...palette(css.match(/html:root\[data-mode="dark"\] \{([^}]+)\}/)[1]) };

test("approved palettes retain readable role pairs and independent lake-blue plans", () => {
  for (const colors of [light, dark]) {
    for (const role of ["blue", "plan", "green", "amber", "orange", "red", "teal", "gray", "purple", "pink", "yellow", "cyan"]) {
      assert.ok(contrast(colors[`--color-${role}-ink`], colors[`--color-${role}-bg`]) >= 4.5, role);
    }
    for (const surface of ["canvas", "group", "panel", "raised"]) assert.ok(contrast(colors["--color-muted"], colors[`--color-${surface}`]) >= 4.5, surface);
    assert.notEqual(colors["--color-plan-bg"], colors["--color-purple-bg"]);
    assert.ok(contrast("#ffffff", colors["--color-primary"]) >= 4.5);
  }
  assert.equal(light["--color-plan-bg"], "#d6f2fa");
  assert.equal(dark["--color-plan-bg"], "#193e50");
  assert.match(css, /--task-state-scheduled-surface: var\(--color-plan-bg\)/);
  assert.match(css, /--state-plan-surface: var\(--color-plan-bg\)/);
  assert.match(css, /--priority-low-surface: var\(--color-blue-bg\)/);
  assert.match(css, /--task-state-draft-surface: var\(--color-gray-bg\)/);
  assert.match(css, /\.feedback-confirm\.caution[^}]+--confirm-surface: var\(--color-amber-bg\)/);
  assert.doesNotMatch(css, /!important/);
  assert.ok(readFileSync(new URL("./main.tsx", import.meta.url), "utf8").indexOf('./color-system.css') > readFileSync(new URL("./main.tsx", import.meta.url), "utf8").indexOf('./styles.css'));
});

test("priority editing defaults to medium and offers only three semantic levels", () => {
  const selector = readFileSync(new URL("./task-priority-selector.tsx", import.meta.url), "utf8");
  assert.match(selector, /const priority = value \?\? "medium";/);
  assert.match(selector, /priority-dot priority-dot-\$\{priority\}/);
  assert.match(selector, /priority-dropdown-option priority-tone-\$\{opt\.tone\}/);
  assert.doesNotMatch(selector, /清除优先级|不设置优先级|unset: \{ label: "优先级" \}/);
  for (const priority of ["high", "medium", "low"]) {
    assert.ok(css.includes(`.priority-dot-${priority} { background: var(--priority-${priority}-accent); }`));
    assert.ok(css.includes(`.priority-dropdown-option.priority-tone-${priority} { --priority-tone: var(--priority-${priority}); --priority-surface: var(--priority-${priority}-surface); }`));
  }
  const legacy = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  assert.doesNotMatch(legacy, /\.priority-dropdown-trigger\.is-open,[^}]+!important/);
});

test("dark text and waiting-pool dots do not override semantic colors or show unset priority", () => {
  const legacy = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  assert.doesNotMatch(legacy, /html\[data-mode="dark"\] p, html\[data-mode="dark"\] span/);
  assert.match(app, /\{task\?\.priority && <span className=\{`waiting-pool-dot priority-\$\{task\.priority\}`\}/);
  assert.match(css, /html:root \.next-workspace > \.settings-page \.settings-sections > section \{[^}]*background: var\(--color-panel\)/);
});

test("only live time and today markers use vivid red while date interactions stay blue", () => {
  const solid = css.match(/--today-red:\s*(#[\da-f]{6})/i)[1];
  const label = css.match(/--today-red-label:\s*(#[\da-f]{6})/i)[1];
  assert.equal(solid, "#ff3b30");
  assert.equal(label, "#3a1612");
  assert.doesNotMatch(css.match(/html:root\[data-mode="dark"\] \{([^}]+)\}/)[1], /--today-red:/);
  for (const colors of [light, dark]) {
    assert.ok(contrast(label, solid) >= 4.5, "today/time label");
    assert.ok(contrast(solid, colors["--color-panel"]) >= 3, "live time line");
    assert.ok(contrast(colors["--color-selected-ink"], colors["--color-selected-bg"]) >= 4.5, "selected date");
  }
  assert.match(css, /\.current-time-line > span \{ color: var\(--today-red-label\)/);
  assert.match(css, /\.timeline-week > button\.today\.selected \.timeline-week-date \{[^}]+background: var\(--today-red\)/);
  assert.match(css, /\.timeline-week-date > :is\(strong, span\) \{ color: inherit; \}/);
  const legacy = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  assert.match(legacy, /\.today-month-sheet \.month-grid > button\.today \.solar-day-number\{background:var\(--today-red\);/);
  assert.match(css, /\.schedule-picker-calendar \.apple-date-grid button\.selected \{ color: #ffffff; background: var\(--color-primary\)/);
  assert.match(css, /--schedule-range-fill: var\(--color-selected-bg\); --schedule-range-node: var\(--color-primary\)/);
  assert.doesNotMatch(css, /button\.schedule-picker-confirm[^}]*var\(--today-red/);
  assert.doesNotMatch(css, /--today-red-soft|--today-red-hover/);
  assert.match(legacy, /\.current-time-line \{[^}]+border-top: 1px solid var\(--today-red\)/);
  assert.equal(light["--color-primary"], "#3168dc");
  assert.equal(dark["--color-plan-bg"], "#193e50");
});

test("month indicators distinguish ordinary and recurring types, not completion", () => {
  assert.doesNotMatch(app, /completeOnly|task-indicator complete/);
  assert.match(app, /count > 0 && <span className="task-indicator">/);
  assert.match(app, /recurringCount > 0 && <span className="task-indicator recurring">/);
  assert.match(css, /\.task-indicator:not\(\.recurring\) \{ color: var\(--color-blue-ink\); background: var\(--color-blue-bg\); \}/);
  assert.match(css, /\.task-indicator\.recurring\) \{ color: var\(--color-teal-ink\); background: var\(--color-teal-bg\); \}/);
  assert.doesNotMatch(readFileSync(new URL("./styles.css", import.meta.url), "utf8"), /\.task-indicator\.complete/);
});

test("type, priority and status badges retain fine semantic borders", () => {
  const rules = [];
  postcss.parse(css).walkRules(rule => rules.push(rule));
  const border = rules.find(rule => rule.nodes.some(node => node.prop === "border-width"));
  for (const badge of ["task-type-badge", "timeline-fact-type", "priority-badge", "timeline-fact-priority", "task-capsule-status", "task-compact-status", "terminal-task-status", "execution-status-badge", "confirmed-plan-status", "setting-state"]) {
    assert.ok(border.selector.includes(`.${badge}`), badge);
  }
  const values = Object.fromEntries(border.nodes.map(node => [node.prop, node.value]));
  assert.equal(values["border-width"], "1px");
  assert.equal(values["border-style"], "solid");
  assert.equal(values["box-sizing"], "border-box");
  for (const [selector, role] of [
    ["html:root :is(.task-type-badge:not(.recurring), .timeline-fact-type:not(.type-recurring))", "gray"],
    ["html:root :is(.task-type-badge.recurring, .timeline-fact-type.type-recurring)", "teal"],
    ["html:root .setting-state", "amber"],
    ["html:root .setting-state.connected", "green"]
  ]) {
    const rule = rules.find(rule => rule.selector === selector);
    assert.ok(rule.nodes.some(node => node.prop === "border-color" && node.value === `var(--color-${role}-edge)`), selector);
    for (const colors of [light, dark]) {
      assert.notEqual(colors[`--color-${role}-edge`], colors[`--color-${role}-bg`]);
      assert.notEqual(colors[`--color-${role}-edge`], colors["--color-panel"]);
    }
  }
});

test("month rest and work markers have theme-aware rounded background blocks", () => {
  const legacy = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const rules = [];
  postcss.parse(legacy).walkRules(rule => rules.push(rule));
  const selector = ".today-page .today-month-sheet .work-state";
  const base = rules.find(rule => rule.selector === selector);
  assert.ok(base.nodes.some(node => node.prop === "border-radius" && node.value === "3px"));
  for (const [state, role] of [["rest", "orange"], ["work", "gray"]]) {
    const rule = rules.find(rule => rule.selector === `${selector}.${state}`);
    const values = Object.fromEntries(rule.nodes.map(node => [node.prop, node.value]));
    assert.equal(values.background, `var(--color-${role}-bg)`);
    assert.equal(values.color, `var(--color-${role}-ink)`);
    for (const colors of [light, dark]) assert.ok(contrast(colors[`--color-${role}-ink`], colors[`--color-${role}-bg`]) >= 4.5);
  }
  assert.doesNotMatch(legacy, /html\[data-mode="dark"\][^{]*\.work-state\.rest/);
  const narrow = rules.filter(rule => rule.selector === selector && rule.parent.type === "atrule").at(-1);
  assert.ok(narrow.nodes.some(node => node.prop === "min-width" && node.value === "16px"));
});

test("month weekends have scoped warm headers and cells without overriding selection or today", () => {
  const rules = [];
  postcss.parse(css).walkRules(rule => rules.push(rule));
  const weekend = rules.filter(rule => rule.selector.includes(":nth-child(7n+6)"));
  assert.equal(weekend.length, 4);
  for (const rule of weekend) {
    assert.ok(rule.selector.startsWith("html:root .today-page .today-month-sheet .month-grid > button"));
    assert.ok(rule.selector.includes(":nth-child(7n)"));
    if (!rule.selector.endsWith(".solar-day-number")) assert.ok(rule.selector.includes(":not(.selected)"));
  }
  const number = weekend.find(rule => rule.selector.endsWith(".solar-day-number"));
  assert.ok(number.selector.includes(":not(.today)"));
  assert.ok(!number.selector.includes(":not(.selected)"), "selected weekends must keep distinct date digits");
  assert.ok(number.nodes.some(node => node.prop === "color" && node.value === "var(--color-red-ink)"));
  assert.ok(number.nodes.some(node => node.prop === "font-weight" && node.value === "700"));
  for (const colors of [light, dark]) assert.ok(contrast(colors["--color-red-ink"], colors["--color-selected-bg"]) >= 4.5, "selected weekend date contrast");
  const header = rules.find(rule => rule.selector === "html:root .today-page .today-month-sheet .weekday-row span:nth-child(n+6)");
  assert.ok(header.nodes.some(node => node.prop === "background" && node.value === "var(--color-orange-bg)"));
  assert.ok(header.nodes.some(node => node.prop === "font-weight" && node.value === "700"));
});

test("day-view Saturday and Sunday digits stay red when selected without overriding today", () => {
  const rules = [];
  postcss.parse(css).walkRules(rule => rules.push(rule));
  const rule = rules.find(rule => rule.selector === "html:root .next-workspace .today-page .timeline-week > button.weekend:not(.today) .timeline-week-date");
  assert.ok(rule);
  assert.ok(rules.indexOf(rule) > rules.findIndex(candidate => candidate.selector === "html:root .next-workspace .today-page .timeline-week > button.selected:not(.today) .timeline-week-date"), "weekend digits must override the equally specific selected-date rule");
  assert.equal(rule.nodes.find(node => node.prop === "color")?.value, "var(--color-red-ink)");
  assert.ok(!rule.selector.includes(":not(.selected)"));
  assert.equal(rule.nodes.length, 1, "weekend emphasis must not change selected backgrounds or badges");
  const legacy = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  assert.doesNotMatch(legacy, /\.timeline-week > button\.weekend[^{}]*:nth-child\(7\)/);
  for (const colors of [light, dark]) for (const surface of ["canvas", "panel", "selected-bg"]) {
    const bg = surface === "selected-bg" ? colors["--color-selected-bg"] : colors[`--color-${surface}`];
    assert.ok(contrast(colors["--color-red-ink"], bg) >= 4.5, `weekend on ${surface}`);
  }
});
