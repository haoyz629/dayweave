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
const selector = readFileSync(new URL("./task-priority-selector.tsx", import.meta.url), "utf8");
const selectorSource = ts.createSourceFile("task-priority-selector.tsx", selector, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const copy = selectorSource.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(selectorSource) === "priorityCopy"));
const context = vm.createContext({ React, taskBlockTypeLabels });
vm.runInContext(ts.transpileModule(`${copy.getText(selectorSource).replace("export ", "")}\n${facts.getText(source)}`, { compilerOptions: { jsx: ts.JsxEmit.React } }).outputText, context);

test("unset priorities render no timeline badge in full or compact blocks", () => {
  for (const priority of [null, undefined]) for (const inline of [false, true]) {
    const html = renderToStaticMarkup(context.TimelineTaskFacts({ type: "single", priority, inline }));
    assert.doesNotMatch(html, /priority-|未设|无优先级/);
    assert.match(html, /单日任务/);
  }
  for (const [priority, label, short] of [["urgent", "P0", "P0"], ["high", "P1", "P1"], ["medium", "P2", "P2"], ["low", "P3", "P3"]]) {
    const html = renderToStaticMarkup(context.TimelineTaskFacts({ type: "multi", priority }));
    assert.match(html, new RegExp(`priority-${priority}`));
    assert.ok(html.includes(`timeline-fact-full">${label}</span>`));
    assert.ok(html.includes(`timeline-fact-short">${short}</span>`));
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
  assert.equal(light["--color-canvas"], "#fffefa", "right workspace stays near-white");
  assert.equal(light["--color-group"], "#faf9f7", "left sidebar stays warm gray-white");
  assert.equal(light["--color-panel"], "#ffffff", "raised content stays white");
  assert.equal(light["--color-edge"], "#e4e0d8", "shared dividers stay faint");
  assert.equal(dark["--color-plan-bg"], "#193e50");
  assert.match(css, /--task-state-scheduled-surface: var\(--color-plan-bg\)/);
  assert.match(css, /--state-plan-surface: var\(--color-plan-bg\)/);
  assert.match(css, /--priority-low-surface: var\(--color-blue-bg\)/);
  assert.match(css, /--task-state-draft-surface: var\(--color-gray-bg\)/);
  assert.match(css, /\.feedback-confirm\.caution[^}]+--confirm-surface: var\(--color-amber-bg\)/);
  assert.doesNotMatch(css, /!important/);
  assert.ok(readFileSync(new URL("./main.tsx", import.meta.url), "utf8").indexOf('./color-system.css') > readFileSync(new URL("./main.tsx", import.meta.url), "utf8").indexOf('./styles.css'));
});

test("priority editing defaults to P1 and offers four semantic levels", () => {
  const selector = readFileSync(new URL("./task-priority-selector.tsx", import.meta.url), "utf8");
  assert.match(selector, /const priority = value \?\? "high";/);
  assert.match(selector, /priority-dot priority-dot-\$\{priority\}/);
  assert.match(selector, /priority-dropdown-option priority-tone-\$\{opt\.tone\}/);
  assert.doesNotMatch(selector, /清除优先级|不设置优先级|unset: \{ label: "优先级" \}/);
  for (const priority of ["urgent", "high", "medium", "low"]) {
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

test("light semantic surfaces share the task-priority 5% fill and 20% edge without changing ink or actions", () => {
  const rules = [];
  postcss.parse(css).walkRules(rule => rules.push(rule));
  const rule = rules.find(rule => rule.selector === 'html:root:not([data-mode="dark"])');
  assert.ok(rule, "light-only semantic palette");
  const values = Object.fromEntries(rule.nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]));
  const roles = ["blue", "plan", "green", "amber", "orange", "red", "teal", "gray", "purple", "pink", "yellow", "cyan"];
  assert.equal(Object.keys(values).length, roles.length * 2, "only fills and edges change");
  for (const role of roles) {
    const ink = light[`--color-${role}-ink`];
    assert.equal(values[`--color-${role}-bg`], `color-mix(in srgb, var(--color-${role}-ink) 5%, white)`);
    assert.equal(values[`--color-${role}-edge`], `color-mix(in srgb, var(--color-${role}-ink) 20%, white)`);
    const fill = "#" + ink.slice(1).match(/../g).map(channel => Math.round(parseInt(channel, 16) * .05 + 255 * .95).toString(16).padStart(2, "0")).join("");
    assert.ok(contrast(ink, fill) >= 4.5, `${role} softened text contrast`);
  }
});

test("task-page badges consume shared semantic colors without double tinting", () => {
  const comfort = readFileSync(new URL("./task-comfort.css", import.meta.url), "utf8");
  assert.doesNotMatch(comfort, /color-mix|--color-(?:\w+)-(?:bg|edge):/);
  const tags = readFileSync(new URL("./task-tags.css", import.meta.url), "utf8");
  assert.match(tags, /background: var\(--task-tag-bg/);
  assert.match(css, /--status-bg: var\(--color-green-bg\)/);
  assert.match(css, /--priority-medium-surface: var\(--color-amber-bg\)/);
});

test("light badge corners match without enlarging compact blocks or controls", () => {
  const rules = [];
  postcss.parse(css).walkRules(rule => rules.push(rule));
  const rule = rules.find(rule => rule.selector.startsWith('html:root:not([data-mode="dark"]) :is('));
  for (const badge of ["priority-badge", "timeline-fact-priority", "task-capsule-status", "terminal-task-status", "execution-status-badge", "confirmed-plan-status", "setting-state", "task-tag-chip", "task-list-tags > span"]) {
    assert.ok(rule.selector.includes(`.${badge}`), badge);
  }
  const declarations = rule.nodes.filter(node => node.type === "decl");
  assert.deepEqual(declarations.map(node => [node.prop, node.value]), [["border-radius", "5px"]]);
});

test("active recurring controls and overflow tags cannot bypass the shared light treatment", () => {
  const rules = [];
  postcss.parse(css).walkRules(rule => rules.push(rule));
  const rule = rules.find(rule => rule.selector.includes('.task-list-tags > span:not([data-tag-color])'));
  for (const selector of [".task-tag-option:has(input:checked)", ".recurring-weekday-btn.is-active", ".recurring-daily-tag", ".recurring-info-icon", ".apple-schedule-error"]) assert.ok(rule.selector.includes(selector), selector);
  assert.equal(rule.nodes.find(node => node.prop === "background")?.value, "color-mix(in srgb, currentColor 5%, white)");
  assert.equal(rule.nodes.find(node => node.prop === "border-color")?.value, "color-mix(in srgb, currentColor 20%, white)");
  postcss.parse(readFileSync(new URL("./styles.css", import.meta.url), "utf8")).walkRules(rule => {
    if (![".recurring-weekday-btn.is-active", ".recurring-type-card.is-active", ".recurring-editor-surface .recurring-weekday-btn.is-active"].includes(rule.selector)) return;
    for (const node of rule.nodes) if (["background", "border", "border-color"].includes(node.prop)) assert.ok(!node.important, rule.selector);
  });
});

test("day and week blocks restore original light surfaces without reverting shared badges", () => {
  const rules = [];
  postcss.parse(css).walkRules(rule => rules.push(rule));
  function originalPair(selector, surface, edge, role) {
    const rule = rules.find(rule => rule.selector === `html:root:not([data-mode="dark"]) ${selector}`);
    assert.ok(rule, selector);
    const values = Object.fromEntries(rule.nodes.map(node => [node.prop, node.value]));
    assert.deepEqual(values, { [surface]: light[`--color-${role}-bg`], [edge]: light[`--color-${role}-edge`] });
  }
  originalPair('.today-page .timeline-event:is(.plan-draft-block, .execution-block)', '--state-plan-surface', '--state-plan-border', 'plan');
  const recurring = rules.find(rule => rule.selector === 'html:root:not([data-mode="dark"]) .today-page .timeline-event.recurring-event');
  assert.deepEqual(Object.fromEntries(recurring.nodes.map(node => [node.prop, node.value])), { '--state-recurring': 'var(--state-plan)', '--state-recurring-surface': light['--color-plan-bg'], '--state-recurring-border': light['--color-plan-edge'] });
  for (const suffix of ['', ':hover']) {
    const result = rules.find(rule => rule.selector === `html:root:not([data-mode="dark"]) .today-page .timeline-event.recurring-event:not(.execution-planned)${suffix}`);
    const values = Object.fromEntries(result.nodes.map(node => [node.prop, node.value]));
    assert.equal(values['border-color'], suffix ? 'var(--execution-color)' : 'var(--execution-border)');
    assert.equal(values.background, 'var(--execution-surface)');
    if (!suffix) assert.equal(values.color, 'var(--execution-color)');
  }
  originalPair('.today-page .timeline-event.fixed-event', 'background', 'border-color', 'gray');
  for (const [outcome, role] of [['completed', 'green'], ['partial', 'cyan'], ['blocked', 'amber'], ['cancelled', 'gray'], ['not_started', 'amber']]) {
    originalPair(`.today-page .timeline-event.execution-${outcome}`, '--execution-surface', '--execution-border', role);
  }
  const week = ':is(.week-timeline-event, .week-timeline-legend > span)';
  for (const [suffix, role] of [['', 'plan'], ['.tone-completed', 'green'], ['.tone-partial', 'cyan'], [':is(.tone-blocked, .tone-not-started)', 'amber'], [':is(.tone-cancelled, .tone-fixed)', 'gray']]) {
    originalPair(week + suffix, '--week-bg', '--week-edge', role);
  }
  assert.doesNotMatch(css, /--timeline-block-tone|14%, white|38%, white/);
  assert.doesNotMatch(css, /week-timeline[^{}]*\.tone-recurring/);
});

test("toasts restore original light fills and edges without changing their ink or behavior", () => {
  const rules = [];
  postcss.parse(css).walkRules(rule => rules.push(rule));
  for (const [suffix, role] of [['', 'blue'], ['.success', 'green'], ['.error', 'red']]) {
    const rule = rules.find(rule => rule.selector === `html:root:not([data-mode="dark"]) .feedback-toast${suffix}`);
    assert.ok(rule);
    assert.deepEqual(Object.fromEntries(rule.nodes.map(node => [node.prop, node.value])), {
      '--toast-surface': light[`--color-${role}-bg`], '--toast-edge': light[`--color-${role}-edge`]
    });
  }
});

test("light nonworking time is a quiet fill without stripes or boundary borders", () => {
  const rules = [];
  postcss.parse(css).walkRules(rule => rules.push(rule));
  const rule = rules.find(rule => rule.selector === 'html:root:not([data-mode="dark"]) .timeline-nonworking');
  assert.ok(rule);
  assert.deepEqual(Object.fromEntries(rule.nodes.map(node => [node.prop, node.value])), {
    border: "0", "background-image": "none"
  });
  const shared = rules.find(rule => rule.selector === "html:root :is(.timeline-nonworking, .time-rail-break)");
  assert.equal(shared.nodes.find(node => node.prop === "background-color")?.value, "var(--color-gray-bg)");
  assert.ok(rules.indexOf(rule) > rules.findIndex(candidate => candidate.selector === "html:root .timeline-nonworking"));
  const legacy = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  assert.match(legacy, /\.timeline-nonworking:focus-visible \{[^}]*outline: 2px solid/);
});

test("P0 reuses urgent red across badges, dropdowns and waiting-pool dots", () => {
  for (const [suffix, role] of [["", "ink"], ["-accent", "solid"], ["-border", "edge"], ["-surface", "bg"]]) {
    assert.ok(css.includes(`--priority-urgent${suffix}: var(--color-red-${role});`));
  }
  assert.ok(css.includes(':is(.priority-badge, .timeline-fact-priority).priority-urgent { color: var(--priority-urgent); border-color: var(--priority-urgent-border); background: var(--priority-urgent-surface); }'));
  assert.ok(css.includes('.waiting-pool-dot.priority-urgent { background: var(--priority-urgent-accent); }'));
  assert.ok(css.includes('.priority-select-control.priority-tone-urgent { --priority-tone: var(--priority-urgent); --priority-border: var(--priority-urgent-border); --priority-surface: var(--priority-urgent-surface); }'));
});
