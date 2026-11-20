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
  const heading = declarations(".task-capsule-heading");
  assert.equal(heading.display, "grid");
  assert.equal(heading["grid-template-columns"], "minmax(0, 1fr) auto");
  const title = declarations(".task-capsule-heading > strong");
  assert.equal(title["white-space"], "nowrap");
  assert.equal(title["text-overflow"], "ellipsis");
  assert.equal(title["font-weight"], "600");
  assert.equal(title["font-size"], "13.5px");
  const headingMeta = declarations(".task-capsule-heading-meta");
  assert.equal(headingMeta["max-width"], "none");
  assert.equal(headingMeta.overflow, "hidden");
  assert.equal(headingMeta["min-width"], "0");
  assert.equal(declarations(".task-capsule-content .task-capsule-facts").flex, "0 0 auto");
  assert.equal(declarations(".task-capsule-content").padding, "0");
  assert.equal(declarations(".ledger-row.task-capsule-row")["box-shadow"], "none");
  assert.match(app, /<strong title=\{title\}>\{title\}<\/strong>/);
  assert.equal((app.match(/<div[^\n]*className=[^\n]*task-capsule-row/g) || []).length, 4);
});

test("ordinary and all recurring lifecycle details keep full-title hints and full wrapped headings", () => {
  assert.equal((app.match(/<TaskDetailHero/g) ?? []).length, 4);
  const title = declarations(".detail-hero-title-block > h2");
  assert.equal(title["white-space"], "normal");
  assert.equal(title["overflow-wrap"], "anywhere");
  assert.equal(title["font-weight"], "500");
  const tag = declarations(".detail-hero-meta .task-list-tags > span");
  assert.equal(tag["max-width"], "none");
  assert.equal(tag["white-space"], "normal");
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
  const labels = declarations(".task-notes-inputs > .task-notes-label");
  assert.equal(labels.position, "static");
  assert.equal(labels.clip, "auto");
  assert.equal(declarations(".task-notes-inputs")["grid-template-columns"], "16px 36px minmax(0, 1fr)");
  assert.equal(declarations(".task-notes-inputs > :is(input, textarea)")["grid-column"], "3");
  assert.match(app, /className="task-notes-label sr-only">链接<\/label>/);
  assert.match(app, /placeholder="粘贴网址（选填）"/);
  assert.match(app, /placeholder="添加说明或补充信息（选填）"/);
  assert.doesNotMatch(app, /placeholder="(?:URL|备注)"/);
});

test("note labels share the first text line with URL inputs and multiline notes", () => {
  const labels = declarations(".task-notes-inputs > .task-notes-label");
  const fields = declarations(".task-notes-inputs :is(input, textarea)");
  assert.equal(labels["font-size"], fields["font-size"]);
  assert.equal(labels["line-height"], fields["line-height"]);
  // Placeholder is a separate pseudo-element; matching the field box alone misses its baseline.
  assert.equal(declarations(".task-notes-inputs :is(input, textarea)::placeholder").font, "inherit");
  assert.equal(labels["align-self"], "start");
  const url = declarations(".task-notes-inputs > input");
  assert.equal(url.height, fields["line-height"]);
  assert.equal(url["align-self"], "start");
  assert.equal(declarations(".task-notes-inputs > label:last-of-type").transform, undefined);
  assert.equal(declarations(".task-notes-inputs > svg")["margin-top"], "5px");
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

test("resource details share editor typography and natural height, including empty values", () => {
  const text = declarations(".ordinary-task-detail :is(.task-detail-note, .task-detail-url, .task-detail-empty, .task-detail-resource-label)");
  assert.equal(text["font-size"], "13px");
  assert.equal(text["line-height"], "1.65");
  const note = declarations(".ordinary-task-detail .task-detail-note");
  assert.equal(note["max-height"], "none");
  assert.equal(note["overflow-y"], "visible");
  const row = declarations(".ordinary-task-detail .task-detail-resource-row");
  assert.equal(row["grid-template-columns"], "62px minmax(0, 1fr) 28px");
  assert.equal(row.padding, "12px 16px");
  assert.equal(row.gap, "10px");
  assert.equal(declarations(".ordinary-task-detail .task-detail-resource-label")["grid-template-columns"], "16px 36px");
  assert.equal(declarations(".ordinary-task-detail .task-detail-resource-label")["align-items"], "center");
  const resources = app.slice(app.indexOf("function TaskDetailResources("), app.indexOf("function TaskPageHeader("));
  assert.match(resources, /<span>链接<\/span>/);
  assert.match(resources, /<span>备注<\/span>/);
});

test("search input delegates its focus indicator to the composite wrapper", () => {
  assert.equal(declarations(':is(.task-queue-search, .task-filter-popover-search) > input[type="search"]:focus-visible').outline, "none");
  assert.match(read("./styles.css"), /\.task-queue-search:focus-within \{[^}]*border-color: var\(--jx-focus\);[^}]*box-shadow:/);
});
