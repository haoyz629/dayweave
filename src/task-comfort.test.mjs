import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";

const read = name => readFileSync(new URL(name, import.meta.url), "utf8");
const css = read("./task-comfort.css");
const sheet = postcss.parse(css);
const app = read("./App.tsx");
const scope = 'html:root:not([data-mode="dark"])';
function declarations(ending) {
  const values = {};
  sheet.walkRules(rule => {
    if (!rule.selector.endsWith(ending)) return;
    rule.walkDecls(decl => { values[decl.prop] = decl.value; });
  });
  assert.ok(Object.keys(values).length, ending);
  return values;
}

test("approved task styles load after the existing palette and never depend on preview behavior", () => {
  const main = read("./main.tsx");
  assert.ok(main.indexOf('"./task-comfort.css"') > main.indexOf('"./color-system.css"'));
  sheet.walkRules(rule => {
    assert.ok(rule.selector.split(",\n").every(selector => selector.startsWith(scope)), rule.selector);
    assert.ok(rule.selector.includes(".tasks-workspace") || rule.selector.includes(".task-completion-backdrop"), rule.selector);
  });
  assert.doesNotMatch(css, /preview-a|preview-readonly|!important|\.next-sidebar|\.day-timeline/);
});

test("every list variant keeps one full-width single-line title and separate metadata", () => {
  const title = declarations(".task-capsule-heading > strong");
  assert.equal(title.flex, "1 1 100%");
  assert.equal(title["white-space"], "nowrap");
  assert.equal(title["text-overflow"], "ellipsis");
  assert.equal(title["font-weight"], "500");
  assert.equal(title["font-size"], "15px");
  assert.equal(declarations(".task-capsule-heading")["flex-wrap"], "wrap");
  assert.equal(declarations(".task-capsule-heading-meta")["max-width"], "100%");
  assert.equal(declarations(".task-capsule-content").padding, "12px");
  assert.equal(declarations(".ledger-row.task-capsule-row:is(.selected, :hover)")["box-shadow"], "none");
  assert.match(app, /<strong title=\{title\}>\{title\}<\/strong>/);
  assert.equal((app.match(/<div[^\n]*className=[^\n]*task-capsule-row/g) || []).length, 4);
});

test("ordinary and all recurring lifecycle details keep full-title hints and per-tag ellipsis", () => {
  assert.equal((app.match(/<h2 title=\{(?:task|item)\.title\}>\{(?:task|item)\.title\}<\/h2>/g) || []).length, 4);
  const title = declarations(".ordinary-task-detail > header h2");
  assert.equal(title["white-space"], "nowrap");
  assert.equal(title["text-overflow"], "ellipsis");
  assert.equal(title["font-weight"], "500");
  const tag = declarations(".ordinary-task-detail > header .task-list-tags > span");
  assert.equal(tag["max-width"], "min(100%, 180px)");
  assert.equal(tag["white-space"], "nowrap");
  assert.equal(tag["text-overflow"], "ellipsis");
  assert.match(read("./task-tag-editor.tsx"), /data-tag-color=\{colorFor\(definitions, tag\)\} title=\{tag\}>\{tag\}/);
  assert.equal(declarations(".task-completion-backdrop .task-completion-header h2")["text-overflow"], "ellipsis");
  assert.match(app, /id="task-completion-title" title=\{task\.title\}/);
});

test("all editor shells share calm typography without adding editable text clamping", () => {
  const forms = ':is(#new-task-form, #task-editor-form, #recurring-editor-form)';
  sheet.walkRules(rule => {
    if (!rule.selector.includes(forms)) return;
    rule.walkDecls(decl => assert.ok(!["overflow", "white-space", "text-overflow", "-webkit-line-clamp"].includes(decl.prop), decl.toString()));
  });
  const notes = declarations(".task-notes-inputs :is(input, textarea)");
  assert.equal(notes["font-size"], "14px");
  assert.equal(notes["line-height"], "24px");
  assert.match(app, /<textarea id=\{id\} rows=\{3\}/);
});

test("ordinary and recurring forms retain inline title attributes and flexible writing space", () => {
  assert.equal(declarations(".task-title-heading-row")["flex-wrap"], "nowrap");
  assert.equal(declarations(".task-title-heading-row > .task-title-input")["flex-basis"], "0");
  assert.equal(declarations(".task-title-controls").width, "auto");
  assert.equal(declarations(".task-title-controls").display, "flex");
  assert.equal(declarations(".task-title-controls")["flex-wrap"], "nowrap");
  assert.equal(declarations(".task-title-controls").flex, "0 0 auto");
  assert.ok(!css.includes(".recurring-title-field {"), "keep the original recurring title proportions");
  assert.equal(declarations(".task-compact-body").gap, "16px");
  assert.equal(declarations(":is(.task-notes-region, .recurring-optional-notes.is-expanded)").flex, "1 0 180px");
  const labels = declarations(".task-notes-inputs > label.sr-only");
  assert.equal(labels.position, "static");
  assert.equal(labels.clip, "auto");
  assert.equal(declarations(".task-notes-inputs")["grid-template-columns"], "16px 32px minmax(0, 1fr)");
  assert.equal(declarations(".task-notes-inputs > :is(input, textarea)")["grid-column"], "3");
});

test("form actions remain readable while title and notes retain the original borderless focus", () => {
  const buttons = declarations(".task-compact-actions button");
  assert.equal(buttons["min-height"], "36px");
  assert.equal(buttons["font-size"], "13px");
  assert.equal(buttons["font-weight"], "500");
  assert.doesNotMatch(buttons.transition, /\ball\b/);
  assert.equal(declarations(":is(.task-compact-lifecycle, .task-compact-primary-actions)")["flex-wrap"], "wrap");
  assert.doesNotMatch(css, /:is\(\.task-title-input[^}]+outline: 2px/);
  const legacy = read("./styles.css");
  assert.match(legacy, /\.task-title-input:focus-visible \{ outline: none; \}/);
  assert.match(legacy, /\.task-notes-inputs > :is\(input, textarea\):focus-visible \{\s*outline: none;/);
});
