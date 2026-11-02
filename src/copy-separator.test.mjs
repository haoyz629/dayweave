import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CopySeparator, SeparatedCopy } from "./copy-separator.test-helper.mjs";

const separator = '<b class="copy-separator" aria-hidden="true">·</b>';

test("the shared separator is a decorative bold middle dot with proportional spacing", () => {
  assert.equal(renderToStaticMarkup(React.createElement(CopySeparator)), separator);
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  assert.match(css, /\.copy-separator \{[^}]*margin-inline: \.4em;[^}]*font-weight: 800/);
  assert.match(css, /\.timeline-date-meta > \.copy-separator, \.filter-menu-footer > \.copy-separator \{ margin-inline: 0/);
});

test("generated interface copy normalizes dot spacing and preserves the surrounding text", () => {
  for (const text of ["农历九月二十 · 霜降第7天", "农历九月二十·霜降第7天", "农历九月二十  ·  霜降第7天"]) {
    assert.equal(renderToStaticMarkup(React.createElement(SeparatedCopy, { text })), `农历九月二十${separator}霜降第7天`);
  }
  assert.equal(renderToStaticMarkup(React.createElement(SeparatedCopy, { text: "没有分隔符" })), "没有分隔符");
  assert.equal(renderToStaticMarkup(React.createElement(SeparatedCopy, { text: "" })), "");
  assert.equal(renderToStaticMarkup(React.createElement(SeparatedCopy, { text: "任务 · 高优先级 · 点击查看" })), `任务${separator}高优先级${separator}点击查看`);
});
