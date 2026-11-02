import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const text = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlers = new Map();
let selectionEffect;
function collect(node) {
  if (ts.isFunctionDeclaration(node) && ["cancelTaskEditing", "applyTaskChange", "discardAndContinue"].includes(node.name?.text)) handlers.set(node.name.text, node.getText(source));
  if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" && node.arguments[0]?.getText(source).includes("pendingTaskEdit.current === selectedTask.id")) selectionEffect = node.arguments[0].getText(source);
  ts.forEachChild(node, collect);
}
collect(source);
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function harness() {
  const initial = { task_id: "task", tags: ["原标签"], recurrence: null, history: [{ id: "real-history" }] };
  const state = {
    busy: false, creating: false, selectedTask: { id: "task", title: "原任务" },
    initialTaskMetadata: { current: initial }, taskMetadata: { ...initial, tags: ["已取消标签"], recurrence: { frequency: "daily" } },
    draft: { title: "未保存标题" }, taskDetailEditing: true, pendingTaskEdit: { current: null }, preferredSelection: { current: null },
    draftForTask: task => ({ title: task.title }), resolvePendingChange: proceed => { state.proceeded = proceed; }
  };
  for (const name of ["Draft", "TaskMetadata", "TaskDetailEditing", "Feedback", "SelectedRecurringId", "SelectedId", "CompactTaskEditorDismissed"]) {
    const key = name[0].toLowerCase() + name.slice(1);
    state[`set${name}`] = value => { state[key] = value; };
  }
  const context = vm.createContext(state);
  for (const code of handlers.values()) vm.runInContext(compile(code), context);
  return { state, runSelectionEffect: () => vm.runInContext(compile(`(${selectionEffect})();`), context) };
}

test("cancel restores all edited fields and metadata, preserving loaded history", () => {
  const { state } = harness();
  state.cancelTaskEditing();
  assert.deepEqual(state.draft, { title: "原任务" });
  assert.equal(state.taskMetadata, state.initialTaskMetadata.current);
  assert.deepEqual(state.taskMetadata.tags, ["原标签"]);
  assert.equal(state.taskMetadata.recurrence, null);
  assert.equal(state.taskMetadata.history[0].id, "real-history");
  assert.equal(state.taskDetailEditing, false);
});

test("discard-before-navigation uses the same full cancellation", async () => {
  const { state } = harness();
  await state.discardAndContinue();
  assert.equal(state.taskMetadata, state.initialTaskMetadata.current);
  assert.equal(state.taskDetailEditing, false);
  assert.equal(state.proceeded, true);
});

test("quick edit survives task selection initialization, normal selection shows details", () => {
  const { state, runSelectionEffect } = harness();
  state.applyTaskChange({ kind: "select", taskId: "other", edit: true });
  state.selectedTask = { id: "other", title: "另一任务" };
  runSelectionEffect();
  assert.equal(state.taskDetailEditing, true);
  assert.equal(state.pendingTaskEdit.current, null);
  state.applyTaskChange({ kind: "select", taskId: "third" });
  state.selectedTask = { id: "third", title: "第三任务" };
  runSelectionEffect();
  assert.equal(state.taskDetailEditing, false);
});

test("busy cancel cannot discard an in-flight edit", () => {
  const { state } = harness();
  state.busy = true;
  const metadata = state.taskMetadata;
  state.cancelTaskEditing();
  assert.equal(state.taskMetadata, metadata);
  assert.equal(state.draft.title, "未保存标题");
});

test("ordinary detail grid preserves both pane minimums without changing recurring-item layouts", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  assert.match(css, /@media \(min-width: 861px\) \{\s*\.task-ledger:has\(\.ordinary-task-detail\) \{ grid-template-columns: minmax\(320px, min\(var\(--task-list-width\), calc\(100% - 394px\)\)\) 14px minmax\(380px, 1fr\);/);
});

test("default details keep the contextual return action in the shared page header", () => {
  assert.match(text, /<CompletedTaskDetails[^\n]*onBack=\{timelineReturnContext \? \(\) => onReturnToTimeline\(timelineReturnContext\) : undefined\}/);
  assert.match(text, /<DeletedTaskDetails[^\n]*onBack=\{timelineReturnContext \? \(\) => onReturnToTimeline\(timelineReturnContext\) : undefined\}/);
});

test("detail and edit headers share a fixed centered bar outside the form column inset", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  assert.match(css, /\.task-compact-header\.task-page-header \{[^}]*height: 56px;[^}]*min-height: 56px;[^}]*flex: 0 0 56px;[^}]*align-items: center;[^}]*padding: 0 24px;/);
  assert.match(css, /:is\(\.task-compact-header:not\(\.task-page-header\), \.task-compact-actions\)/);
  assert.match(css, /\.task-page-header \.task-detail-breadcrumb \{[^}]*align-items: center;[^}]*line-height: 20px;/);
});

test("ordinary creation and editing share expandable notes instead of a fixed-height empty tail", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const shared = css.match(/:is\(#new-task-form, #task-editor-form\) \.task-notes-region \{([^}]+)\}/);
  assert.ok(shared, "new and edited ordinary tasks must use the same notes growth rule");
  assert.match(shared[1], /flex: 1 0 150px;/);
  assert.match(shared[1], /height: auto;/);
});
