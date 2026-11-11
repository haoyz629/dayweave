import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";

const css = readFileSync(new URL("./month-view.css", import.meta.url), "utf8");
const main = readFileSync(new URL("./main.tsx", import.meta.url), "utf8");
const rules = [];
postcss.parse(css).walkRules(rule => rules.push(rule));
const scope = 'html:root:not([data-mode="dark"]) .today-page .today-month-sheet';
const values = selector => Object.assign({}, ...rules.filter(rule => rule.selector === `${scope} ${selector}` && rule.parent.type === "root").map(rule => Object.fromEntries(rule.nodes.map(node => [node.prop, node.value]))));

test("approved A is loaded after the existing color system and scoped to the light month sheet", () => {
  assert.ok(main.indexOf('./month-view.css') > main.indexOf('./color-system.css'));
  assert.ok(rules.length > 25);
  for (const rule of rules) assert.ok(rule.selector.startsWith(scope), rule.selector);
  assert.doesNotMatch(css, /!important|data-month-preview|next-sidebar|timeline-main|week-timeline|schedule-picker/);
});

test("continuous month grid keeps readable day, lunar, category count and keyboard focus hierarchy", () => {
  assert.equal(values('.month-grid')["grid-auto-rows"], "minmax(0, 1fr)");
  assert.equal(values('.month-grid').flex, "1 1 0");
  assert.equal(values('.solar-day-number')["font-size"], "16px");
  assert.equal(values('.lunar-day-number')["font-size"], "12px");
  assert.equal(values('.task-indicator')["font-size"], "12px");
  assert.equal(values('.calendar-indicators')["grid-row"], "1 / -1");
  assert.equal(values('.calendar-indicators')["align-self"], "end");
  assert.equal(values('.calendar-indicators')["flex-direction"], "column");
  assert.equal(values('.month-grid > button:focus-visible').outline, "2px solid var(--color-primary)");
});

test("today and selection retain separate meanings without recoloring count categories", () => {
  assert.equal(values('.month-grid > button.today .solar-day-number').color, "var(--today-red-label)");
  assert.equal(values('.month-grid > button.today .solar-day-number').background, "var(--today-red)");
  assert.equal(values('.month-grid > button.selected')["box-shadow"], "inset 0 0 0 1px var(--color-selected-edge)");
  assert.equal(values('.task-indicator').color, undefined);
  assert.equal(values('.task-indicator').background, undefined);
  for (const rule of rules.filter(rule => rule.selector.includes(':nth-child(7n+6)'))) assert.ok(rule.selector.includes(':not(.selected)'));
});

test("compact layouts shrink padding instead of imposing overflowing row heights or hiding counts", () => {
  const responsive = rules.filter(rule => rule.parent.type === "atrule");
  assert.ok(responsive.some(rule => rule.selector === `${scope} .month-grid > button` && rule.nodes.some(node => node.prop === "padding" && node.value === "5px")));
  assert.ok(!responsive.some(rule => rule.nodes.some(node => node.prop === "grid-auto-rows")));
  assert.doesNotMatch(css, /display:\s*none|font-size:\s*(?:[0-9]|1[01])px|minmax\((?:112|128|160)px/);
});
