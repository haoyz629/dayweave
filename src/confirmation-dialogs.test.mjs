import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const appText = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const stylesCss = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const feedbackCss = readFileSync(new URL("./feedback.css", import.meta.url), "utf8");
const settingsCss = readFileSync(new URL("./settings-dialog.css", import.meta.url), "utf8");
const recurringConfirmText = readFileSync(new URL("./recurring-scope-confirmation.tsx", import.meta.url), "utf8");

const source = ts.createSourceFile("App.tsx", appText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const compile = (code) => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;

function collectDeclarations() {
  const functions = new Map();
  function walk(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text) functions.set(node.name.text, node.getText(source));
    ts.forEachChild(node, walk);
  }
  walk(source);
  return functions;
}

function findJsxExpression(prefix) {
  let matched = null;
  function walk(node) {
    if (matched) return;
    if (ts.isJsxExpression(node) && node.expression?.getText(source).startsWith(prefix)) {
      matched = node.expression.getText(source);
      return;
    }
    ts.forEachChild(node, walk);
  }
  walk(source);
  assert.ok(matched, `Expected JSX expression starting with: ${prefix}`);
  return matched;
}

test("confirmation dialogs follow lightweight Scheme A styling, stack above timelines, omit blur, preserve light button ink, and scope settings backdrop", () => {
  assert.match(stylesCss, /\.dialog-backdrop \{[^}]*z-index:\s*300;/);
  assert.match(stylesCss, /\.task-completion-backdrop \{[^}]*z-index:\s*300;/);
  assert.match(stylesCss, /\.task-trash-backdrop \{[^}]*z-index:\s*300;/);
  assert.doesNotMatch(stylesCss, /\.task-completion-backdrop\s*\{[^}]*backdrop-filter:\s*blur/);
  assert.match(feedbackCss, /\.dialog-backdrop \{ background: rgb\(20 38 61 \/ 20%\); \}/);
  assert.match(feedbackCss, /\.dialog-backdrop \.feedback-confirm \{[^}]*width: min\(392px, 100%\);[^}]*padding: 22px 24px 20px;/);
  assert.match(feedbackCss, /\.dialog-backdrop \.feedback-confirm > h2,\s*html:root:not\(\[data-mode="dark"\]\) \.dialog-backdrop \.feedback-confirm \.task-completion-header \{[^}]*border: 0;[^}]*background: transparent;[^}]*font: 600 16px\/1\.45/);
  assert.match(feedbackCss, /\.dialog-backdrop \.feedback-confirm \.dialog-actions \{[^}]*padding: 0; border: 0; background: transparent;/);
  assert.match(feedbackCss, /\.dialog-backdrop \.feedback-confirm \.dialog-actions button \{[^}]*min-height: 34px;/);
  assert.match(feedbackCss, /\.feedback-confirm\.caution \.dialog-actions \.dialog-discard \{ border-color: #f3bcc6; color: var\(--color-red-ink\); background: #fff1f3; \}/);
  assert.match(feedbackCss, /\.dialog-actions button:not\(\.dialog-save\):not\(\.primary-action\):not\(\.dialog-discard\) \{ color: var\(--color-ink\); \}/);
  assert.match(feedbackCss, /\.task-completion-header h2 \{[^}]*overflow:\s*visible;[^}]*text-overflow:\s*clip;/);
  assert.match(settingsCss, /\.settings-dialog \.settings-discard-backdrop \{[^}]*position:\s*absolute;[^}]*z-index:\s*2;/);
  assert.match(settingsCss, /html:root:not\(\[data-mode="dark"\]\) \.settings-dialog \.settings-discard-backdrop \{\s*background: rgb\(20 38 61 \/ 20%\);/);
});

test("dead pendingDraftSelection code is removed, creating navigation does not flash confirmation, and Ctrl+S is guarded", () => {
  assert.doesNotMatch(appText, /pendingDraftSelection|saveAndSwitchPersistedTaskDraft/);
  assert.match(appText, /\(pendingTaskChange \|\| \(externalNavigationRequest && !creating\)\)/);
  assert.match(appText, /hasOpenConfirmation/);
  assert.match(appText, /hasOpenConfirmation \|\| busy\) return;\s*event\.preventDefault\(\);/s);
  assert.doesNotMatch(appText, /if \(!pendingTaskChange && !externalNavigationRequest\) return;\s*function closeDialog/s);
  assert.match(appText, /className="dialog-backdrop settings-discard-backdrop" role="presentation"/);
  assert.match(recurringConfirmText, /仅修改本次，不改变重复规则；修改本次及以后，将从本次起应用新安排。/);
});

test("all TaskWorkspace, TodayPage, and App confirmation backdrops portal to document.body except in-top-layer SettingsPage", () => {
  const prefixes = [
    "(pendingTaskChange || (externalNavigationRequest && !creating)) && createPortal(",
    "creating && pendingHistoricalCreation && createPortal(",
    "pendingTrashTask && createPortal(",
    "pendingDiscardTaskDraft && createPortal(",
    "pendingEndRecurringItem && createPortal(",
    "pendingTrashRecurringItem && createPortal(",
    "pendingRecurringSave && selectedTask && createPortal(",
    "pendingDiscardNew && createPortal(",
    "pendingCompletion && selectedTask && createPortal(",
    "pendingPermanentTask && createPortal(",
    "pendingPermanentRecurringItem && createPortal(",
    "pendingRecycledCompletion && createPortal(",
    "pendingPlanLeave && planPreview && createPortal("
  ];
  for (const prefix of prefixes) {
    assert.ok(findJsxExpression(prefix).endsWith("document.body)"));
  }
});

test("recycled block completion preserves note across confirmation, retries on inline failure, and clears after save", async () => {
  const functions = collectDeclarations();
  const block = { id: "block-1", task_id: "task-1", task_title: "回收站任务", task_status: "deleted", ends_at: "2026-11-20T10:00:00+08:00", result_date: "2026-11-20", execution_status: "planned", execution_note: null, review: null };
  const calls = [];
  let failSave = true;
  const state = {
    React, createPortal: (node) => node, document: {},
    ConfirmationDialog: ({ children, ...props }) => React.createElement("section", props, children),
    today: "2026-11-21", selectedDate: "2026-11-20",
    tasks: [], schedule: { task_blocks: [block] },
    quickCompletingBlockId: null, savingExecution: false, busy: false, loading: false, preview: null, savingDraggedBlock: false, timelineDrag: null,
    pendingRecycledCompletion: null, recycledCompletionNote: "完成时的补充备注", recycledCompletionError: null,
    timelineTaskCompletionAction: () => "complete-block", resultToday: () => "2026-11-21",
    uiErrorMessage: (reason) => reason.message ?? String(reason),
    onNotify: (...args) => calls.push(["notify", ...args]),
    async latestUndo() { return null; },
    async onFactsChanged() { calls.push(["refresh"]); },
    async saveExecutionCapture(date, input) {
      calls.push(["save", date, input]);
      if (failSave) throw new Error("数据库写入失败");
    },
    async clearExecutionCapture() {}
  };
  for (const key of ["timelineTooltip", "recycledCompletionError", "pendingRecycledCompletion", "quickCompletingBlockId", "recycledCompletionNote"]) {
    state[`set${key[0].toUpperCase()}${key.slice(1)}`] = (value) => { state[key] = typeof value === "function" ? value(state[key]) : value; };
  }
  const context = vm.createContext(state);
  vm.runInContext(compile(functions.get("quickCompleteTimelineBlock")), context);
  const dialogExpr = findJsxExpression("pendingRecycledCompletion && createPortal(");
  const renderDialog = () => vm.runInContext(compile(`(${dialogExpr})`), context);

  await state.quickCompleteTimelineBlock(block, false, state.recycledCompletionNote);
  assert.equal(state.recycledCompletionNote, "完成时的补充备注");
  assert.equal(state.pendingRecycledCompletion.note, "完成时的补充备注");
  const initialMarkup = renderToStaticMarkup(renderDialog());
  assert.match(initialMarkup, /历史完成记录不可取消。/);
  assert.match(initialMarkup, />完成这次安排<\/button>/);

  await state.quickCompleteTimelineBlock(state.pendingRecycledCompletion.block, true, state.pendingRecycledCompletion.note);
  assert.ok(state.pendingRecycledCompletion, "dialog remains open on failure");
  assert.equal(state.recycledCompletionError, "数据库写入失败");
  assert.equal(state.recycledCompletionNote, "完成时的补充备注");
  assert.equal(calls.some(([name]) => name === "notify"), false, "no background toast hides behind open modal");
  assert.match(renderToStaticMarkup(renderDialog()), /role="alert">数据库写入失败<\/p>/);

  failSave = false;
  await state.quickCompleteTimelineBlock(state.pendingRecycledCompletion.block, true, state.pendingRecycledCompletion.note);
  assert.equal(state.pendingRecycledCompletion, null);
  assert.equal(state.recycledCompletionError, null);
  assert.equal(state.recycledCompletionNote, "");
  assert.equal(calls.findLast(([name]) => name === "save")[2].note, "完成时的补充备注");
});

test("permanent delete, historical creation, draft discard, and plan leave retain modals and inline errors on failure", async () => {
  const functions = collectDeclarations();
  const taskTarget = { id: "t-del", title: "待清理任务", status: "deleted", deleted_at: "2026-11-01T10:00:00+08:00" };
  const recurringTarget = { id: "r-del", title: "待清理重复", deleted_at: "2026-11-01T10:00:00+08:00" };
  let failDelete = true;
  let selectedIdChanges = 0;
  const state = {
    React, createPortal: (node) => node, document: {},
    ConfirmationDialog: ({ children, ...props }) => React.createElement("section", props, children),
    selectedId: "other-task", selectedRecurringId: "other-recurring",
    busy: false, draftSaving: false, creating: true, createItemType: "task", newTaskIsDirty: true,
    newTaskForm: { title: "未命名输入" }, recurringForm: { title: "" },
    currentCreationInput: () => ({ title: "未命名输入" }),
    persistedNewTaskDraft: { id: "d-1", title: "已存在草稿", draft_kind: "create" },
    pendingPermanentTask: taskTarget, pendingPermanentRecurringItem: null, permanentDeleteError: null,
    pendingDiscardNew: true, discardNewError: null,
    pendingPlanLeave: { kind: "navigation", intent: { active: "任务" } },
    planPreview: { preview_id: "p-1", version: 1, plan_date: "2026-11-23" },
    planBusy: false, planLeaveError: null, message: "",
    uiErrorMessage: (reason) => reason.message ?? String(reason),
    async permanentlyDeleteManualTask() { if (failDelete) throw new Error("任务删除受阻"); },
    async permanentlyDeleteRecurringItem() { if (failDelete) throw new Error("重复项删除受阻"); },
    async discardTaskDraft() { throw new Error("草稿服务繁忙"); },
    async discardRulePlanDraft() { throw new Error("草案已过期"); },
    async refreshTasks() {}, async refreshTaskDrafts() {}, async onReload() {}, async onRecurringChanged() {},
    clearNewTaskForm() { state.creating = false; }, applyNavigation() {}
  };
  for (const key of ["busy", "pendingPermanentTask", "pendingPermanentRecurringItem", "permanentDeleteError", "feedback", "pendingDiscardNew", "discardNewError", "newTaskError", "successToast", "planBusy", "planLeaveError", "planPreview", "planToast", "message", "pendingPlanLeave"]) {
    state[`set${key[0].toUpperCase()}${key.slice(1)}`] = (value) => { state[key] = typeof value === "function" ? value(state[key]) : value; };
  }
  state.setSelectedId = (value) => { selectedIdChanges++; state.selectedId = value; };
  state.setSelectedRecurringId = (value) => { state.selectedRecurringId = value; };
  const context = vm.createContext(state);
  for (const name of ["permanentlyDelete", "permanentlyDeleteSelectedRecurringItem", "cancelNewTask", "discardPlanDraft", "resolvePendingPlanLeave"]) {
    vm.runInContext(compile(functions.get(name)), context);
  }

  await state.permanentlyDelete();
  assert.equal(state.pendingPermanentTask, taskTarget);
  assert.equal(selectedIdChanges, 0);
  assert.equal(state.permanentDeleteError, "未永久删除：任务删除受阻");
  const permTaskMarkup = renderToStaticMarkup(vm.runInContext(compile(`(${findJsxExpression("pendingPermanentTask && createPortal(")})`), context));
  assert.match(permTaskMarkup, /任务及其全部执行记录将永久删除，无法恢复。/);
  assert.match(permTaskMarkup, /role="alert">未永久删除：任务删除受阻<\/p>/);

  failDelete = false;
  await state.permanentlyDelete();
  assert.equal(state.pendingPermanentTask, null);
  assert.equal(selectedIdChanges, 0, "deleting non-selected task from list preserves selectedId");

  await state.cancelNewTask(false);
  assert.equal(state.pendingDiscardNew, true);
  assert.equal(state.discardNewError, "草稿未能放弃：草稿服务繁忙");
  const discardMarkup = renderToStaticMarkup(vm.runInContext(compile(`(${findJsxExpression("pendingDiscardNew && createPortal(")})`), context));
  assert.match(discardMarkup, /<strong class="confirmation-object">未命名输入<\/strong>/);
  assert.doesNotMatch(discardMarkup, /原任务保持不变/);
  assert.match(discardMarkup, /role="alert">草稿未能放弃：草稿服务繁忙<\/p>/);

  await state.resolvePendingPlanLeave(true);
  assert.ok(state.pendingPlanLeave);
  assert.equal(state.planLeaveError, "草案未能放弃：草案已过期");
  const planLeaveMarkup = renderToStaticMarkup(vm.runInContext(compile(`(${findJsxExpression("pendingPlanLeave && planPreview && createPortal(")})`), context));
  assert.match(planLeaveMarkup, /放弃未确认的日计划草案？/);
  assert.match(planLeaveMarkup, />继续编辑<\/button>/);
  assert.match(planLeaveMarkup, />放弃并离开<\/button>/);
  assert.match(planLeaveMarkup, /role="alert">草案未能放弃：草案已过期<\/p>/);
});
