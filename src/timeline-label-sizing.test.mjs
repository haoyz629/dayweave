import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";

const css = postcss.parse(readFileSync(new URL("./styles.css", import.meta.url), "utf8"));
function declaration(selector, property, container = null) {
  let value;
  css.walkRules(selector, rule => {
    const query = rule.parent.type === "atrule" ? rule.parent.params : null;
    if (query !== container) return;
    rule.walkDecls(property, decl => { value = decl.value; });
  });
  assert.notEqual(value, undefined, `${selector}: ${property} (${container})`);
  return value;
}

test("timeline label size is bounded by the block's own width and height", () => {
  assert.equal(declaration(".timeline-task-body", "--timeline-label-size"), "clamp(10px, min(3.5cqw, 16cqh), 12px)");
  assert.equal(declaration(".timeline-task-facts > span", "font-size"), "var(--timeline-label-size)");
  assert.equal(declaration(".timeline-task-tags .task-list-tags > span", "font-size"), "var(--timeline-label-size)");
});

test("badge and tag heights grow with their text without changing other task tags", () => {
  assert.equal(declaration(".timeline-task-facts > span", "line-height"), "calc(var(--timeline-label-size) + 5px)");
  assert.equal(declaration(".timeline-task-tags .task-list-tags > span", "line-height"), "calc(var(--timeline-label-size) + 6px)");
  assert.equal(declaration(".timeline-task-tags", "height"), "calc(var(--timeline-label-size) + 8px)");
  assert.equal(declaration(".timeline-task-tags", "overflow"), "hidden");
});

test("short and narrow blocks retain compact badges and hidden metadata rules", () => {
  assert.equal(declaration(".timeline-task-facts > span", "line-height", "(max-height: 51px)"), "13px");
  assert.equal(declaration(".timeline-task-facts > span", "font-size", "(max-height: 51px) and (max-width: 240px)"), "9px");
  assert.equal(declaration(".timeline-task-metadata, .timeline-task-tags", "display", "(max-height: 40px)"), "none");
});

test("borderline two-row blocks reserve enough room for their tags", () => {
  const selector = ".timeline-task-body, .timeline-event.execution-block .timeline-task-body";
  const query = "(min-height: 52px) and (max-height: 60px)";
  assert.equal(declaration(selector, "padding-top", query), "4px");
  assert.equal(declaration(selector, "padding-bottom", query), "4px");
});
