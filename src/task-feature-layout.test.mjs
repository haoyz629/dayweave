import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("removed Gantt module has no navigation, runtime imports or dedicated files", () => {
  for (const file of ["App.tsx", "styles.css", "color-system.css"]) {
    assert.doesNotMatch(source(`./${file}`), /gantt|甘特图/i);
  }
  for (const file of ["gantt-page.tsx", "gantt-page.css", "gantt-model.ts", "gantt-model.test.mjs", "assets/nav-gantt.svg"]) {
    assert.equal(existsSync(new URL(`./${file}`, import.meta.url)), false, file);
  }
});

test("wide editor centers its complete writing column while retaining left-aligned fields", () => {
  const styles = source("./styles.css");
  assert.match(styles, /:is\(#new-task-form, #task-editor-form, #recurring-editor-form\) \.task-compact-body > \* \{\s*width: 100%;\s*max-width: 760px;\s*margin-inline: auto;\s*text-align: left;/);
  assert.match(styles, /padding-inline: max\(24px, calc\(\(100% - 720px\) \/ 2\)\)/);
});

test("task tags sit after priority in the shared title controls and use a dropdown", () => {
  const app = source("./App.tsx");
  const start = app.indexOf("function TaskEditorRegions(");
  const editor = app.slice(start, app.indexOf("\nfunction ", start + 1));
  assert.match(editor, /className="task-title-controls">[\s\S]*<TaskPrioritySelector[\s\S]*<TaskTagEditor[^>]*dropdown/);
  assert.equal((editor.match(/<TaskTagEditor/g) ?? []).length, 1);
  const tags = source("./task-tag-editor.tsx");
  assert.match(tags, /aria-haspopup="dialog" aria-expanded=\{open\}/);
  assert.match(tags, /type="checkbox" aria-label=\{tag\} checked=\{checked\}/);
  assert.match(tags, /createPortal\(/);
  assert.match(tags, /event.key !== "Escape"/);
  assert.match(source("./task-tags.css"), /\.task-title-controls \{ display: flex;[^}]*gap: 8px/);
});

test("task creation disables browser history suggestions without removing app drafts", () => {
  const app = source("./App.tsx");
  assert.match(app, /<form\b[^>]*\bid="new-task-form"[^>]*\bautoComplete="off"[^>]*\bonSubmit=\{submitNewTask\}/);
  assert.match(app, /<TaskEditorRegions[^>]*idPrefix="new-task"/);
  assert.match(app, /<RecurringItemEditor[^>]*idPrefix="new-recurring"/);
  assert.match(app, /className="task-draft-save-state" role="status"/);
});

test("block result choices retain semantic selection colors in the centered popup", () => {
  const styles = source("./styles.css");
  assert.match(styles, /\.task-block-editor \.execution-capture-fields \.floating-outcomes button:not\(\[aria-pressed="true"\]\) \{ border-color:/);
  assert.match(styles, /\.task-block-editor \.execution-capture-fields \.floating-outcomes button:not\(\[aria-pressed="true"\]\):hover:not\(:disabled\)/);
  assert.match(styles, /button\[data-outcome="partial"\]\[aria-pressed="true"\][\s\S]*?background: var\(--state-partial-surface\)/);
});

test("recurring title and tag dropdown share one non-wrapping row", () => {
  const app = source("./App.tsx");
  const start = app.indexOf("function RecurringItemEditor(");
  const editor = app.slice(start, app.indexOf("\nfunction ", start + 1));
  assert.match(editor, /className="recurring-title-row">[\s\S]*className="recurring-title-field">[\s\S]*<input[\s\S]*?<\/div>\s*<TaskTagEditor/);
  assert.equal((editor.match(/<TaskTagEditor/g) ?? []).length, 1);
  const styles = source("./styles.css");
  assert.match(styles, /\.recurring-editor-surface \.recurring-title-row \{ display: flex; flex-wrap: nowrap; align-items: center;/);
  assert.match(styles, /\.recurring-editor-surface \.recurring-title-field \{ flex: 1 1 0; min-width: 0;/);
});
