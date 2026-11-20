import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";

const css = readFileSync(new URL("./month-view.css", import.meta.url), "utf8");
const main = readFileSync(new URL("./main.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const rules = [];
postcss.parse(css).walkRules(rule => rules.push(rule));
const scope = 'html:root:not([data-mode="dark"]) .today-page .today-month-sheet';
const values = selector => Object.assign({}, ...rules.filter(rule => (selector ? rule.selector === `${scope} ${selector}` : rule.selector === scope) && rule.parent.type === "root").map(rule => Object.fromEntries(rule.nodes.map(node => [node.prop, node.value]))));

test("approved card matrix is loaded after the color system and scoped to the light month sheet", () => {
  assert.ok(main.indexOf('./month-view.css') > main.indexOf('./color-system.css'));
  assert.ok(rules.length >= 25);
  for (const rule of rules) assert.ok(rule.selector.startsWith(scope), rule.selector);
  assert.doesNotMatch(css, /!important|data-month-preview|next-sidebar|timeline-main|week-timeline|schedule-picker/);
});

test("6x7 card matrix uses crisp weekday pills, sharp outside-month contrast and bottom-right count pills", () => {
  assert.match(app, /<div className="weekday-row">\{"?\["一", "二", "三", "四", "五", "六", "日"\]\.map\(\(day\) => <span key=\{day\}>周\{day\}<\/span>\)\}<\/div>/);
  assert.equal(values("")["background"], "#eef2f6");
  assert.equal(values(".weekday-row span")["font-size"], "13px");
  assert.equal(values(".weekday-row span")["color"], "#0f172a");
  assert.equal(values(".weekday-row span")["background"], "#ffffff");
  assert.equal(values(".month-grid")["gap"], "6px");
  assert.equal(values(".month-grid")["grid-auto-rows"], "minmax(0, 1fr)");
  assert.equal(values(".month-grid").flex, "1 1 0");
  assert.equal(values(".month-grid > button")["border-radius"], "8px");
  assert.equal(values(".month-grid > button")["background"], "#ffffff");
  assert.equal(values(".month-grid > button.outside:not(.selected)")["background"], "#f4f6f9");
  assert.equal(values(".month-grid > button.outside:not(.today) .solar-day-number")["color"], "#475569");
  assert.equal(values(".day-number")["flex-direction"], "row");
  assert.equal(values(".solar-day-number")["font-size"], "16px");
  assert.equal(values(".lunar-day-number")["font-size"], "12px");
  assert.equal(values(".calendar-solar-term")["background"], "#ecfdf5");
  assert.equal(values(".task-indicator")["font-size"], "12px");
  assert.equal(values(".calendar-indicators")["align-self"], "flex-end");
  assert.equal(values(".calendar-indicators")["justify-content"], "flex-end");
  assert.equal(values(".calendar-indicators")["margin-top"], "auto");
  assert.equal(values(".month-grid > button:focus-visible").outline, "2px solid var(--color-primary)");
});

test("today uses vivid red circle while selection uses blue frame without recoloring count categories", () => {
  assert.equal(values(".month-grid > button.today .solar-day-number").color, "var(--today-red-label)");
  assert.equal(values(".month-grid > button.today .solar-day-number").background, "var(--today-red)");
  assert.equal(values(".month-grid > button.selected")["border-color"], "var(--color-primary)");
  assert.equal(values(".month-grid > button.selected")["background"], "#eff6ff");
  assert.equal(values(".task-indicator").color, undefined);
  assert.equal(values(".task-indicator").background, undefined);
  for (const rule of rules.filter(rule => rule.selector.includes(":nth-child(7n+6)") && !rule.selector.endsWith(".solar-day-number"))) {
    assert.ok(rule.selector.includes(":not(.selected)"));
  }
});

test("compact layouts shrink padding and gap instead of imposing overflowing row heights or hiding counts", () => {
  const responsive = rules.filter(rule => rule.parent.type === "atrule" && rule.parent.name === "media" && rule.parent.params.includes("max-width"));
  assert.ok(responsive.some(rule => rule.selector === `${scope} .month-grid > button` && rule.nodes.some(node => node.prop === "padding" && node.value === "5px")));
  assert.ok(!responsive.some(rule => rule.nodes.some(node => node.prop === "grid-auto-rows")));
  assert.doesNotMatch(css, /display:\s*none|font-size:\s*(?:[0-9]|1[01])px|minmax\((?:112|128|160)px/);
});
