import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Exercise the actual UI handlers without connecting to the desktop database.
const text = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(["savePreferences", "applySettings", "saveBlockTime", "discardPlanDraft", "confirmRulePlan", "undoConfirmedPlan"]);
const snippets = [];
function collect(node) {
  if (ts.isFunctionDeclaration(node) && names.has(node.name?.text)) snippets.push(node.getText(source));
  ts.forEachChild(node, collect);
}
collect(source);
assert.equal(snippets.length, names.size);
const code = ts.transpileModule(snippets.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function harness() {
  const state = {
    saving: false,
    taskLead: 10, desktop: { autostart: false, closeToTray: true }, savedPreferences: { current: { taskLead: 5, desktop: { autostart: false, closeToTray: true } } },
    applyingRef: { current: false }, ready: true, dirty: true, onClose() {},
    planBusy: false, today: "2026-10-19", selectedDate: "2026-10-19", selectedDateRef: { current: "2026-10-19" },
    planPreview: { preview_id: "draft", version: 1, plan_date: "2026-10-19", base_plan_id: null, blocks: [], unscheduled: [] },
    undo: { id: "undo-1", target_type: "task", target_id: "task-1" }, saved: { task_blocks: [] },
    discardResult: { restored_task_count: 0, conflicted_task_titles: [] },
    notifications: [], settingsFeedback: [], toasts: [], failure: null,
    onNotify(...args) { state.notifications.push(args); },
    showFeedback(...args) { state.settingsFeedback.push(args); },
    setPlanToast(value) { if (value) state.toasts.push(value); },
    async setUiSetting() { if (state.failure) throw state.failure; },
    async setAutostartEnabled() {},
    async refreshTasks() {}, async refreshSchedule() {}, async applyUndo() {},
    async latestUndo() { return state.undo; },
    async updatePlanBlockTime() { return state.saved; },
    async discardRulePlanDraft() { return state.discardResult; },
    async confirmRuleBasedPlan() { return state.saved; },
    uiErrorMessage: String, planDraftErrorMessage: String, shanghaiDateValue: () => "2026-10-19",
  };
  for (const key of ["saving", "saveMessage", "preferenceBusy", "preferenceMessage", "planBusy", "message", "daySchedule", "planPreview", "planLeaveError"]) {
    state[`set${key[0].toUpperCase()}${key.slice(1)}`] = (value) => { state[key] = value; };
  }
  vm.runInContext(code, vm.createContext(state));
  return state;
}

test("unified settings apply shows one success sentence and retains each failure reason", async () => {
  const state = harness();
  await state.applySettings(false);
  assert.deepEqual(state.settingsFeedback.at(-1), ["设置已应用"]);
  state.failure = "网络不可用，请重试";
  state.taskLead = 15;
  await state.applySettings(false);
  assert.ok(state.settingsFeedback.at(-1)[0].startsWith("设置未全部应用："));
  assert.ok(state.settingsFeedback.at(-1)[0].includes(state.failure));
  assert.equal(state.settingsFeedback.at(-1)[1], true);
  assert.deepEqual(state.notifications, [], "settings feedback must not reach main-page notifications");
});

test("timeline success messages omit explanations but retain undo identity", async () => {
  const state = harness();
  await state.saveBlockTime({ task_id: "task-1" }, "09:00", "10:00");
  assert.equal(state.toasts.at(-1).label, "时间调整已保存");
  assert.equal(state.toasts.at(-1).message, "");
  assert.equal(state.toasts.at(-1).undoId, "undo-1");
});

test("plan confirmation and undo keep their result titles and action data", async () => {
  for (const adjustment of [false, true]) {
    const state = harness();
    state.planPreview.base_plan_id = adjustment ? "existing-plan" : null;
    state.undo.target_type = "daily_plan";
    await state.confirmRulePlan();
    assert.equal(state.toasts.at(-1).label, adjustment ? "计划调整已确认" : "日计划已确认");
    assert.equal(state.toasts.at(-1).message, "");
    assert.equal(state.toasts.at(-1).undoId, "undo-1");
    await state.undoConfirmedPlan("undo-1");
    assert.equal(state.toasts.at(-1).label, "操作已撤销");
    assert.equal(state.toasts.at(-1).message, "");
  }
});

test("discard summary distinguishes no changes, restored tasks, conflicts and mixed outcomes", async () => {
  const cases = [
    [0, 0, ""],
    [2, 0, "已恢复 2 项任务时间"],
    [0, 3, "3 项另有修改，保持不变"],
    [2, 3, "已恢复 2 项任务时间；3 项另有修改，保持不变"]
  ];
  for (const [restored, conflicts, message] of cases) {
    for (const adjustment of [false, true]) {
      const state = harness();
      state.planPreview.base_plan_id = adjustment ? "existing-plan" : null;
      state.discardResult = { restored_task_count: restored, conflicted_task_titles: Array.from({ length: conflicts }, (_, i) => `很长的任务标题-${i}`) };
      assert.equal(await state.discardPlanDraft(), true);
      assert.equal(state.toasts.at(-1).label, "计划草案已放弃");
      assert.equal(state.toasts.at(-1).message, message);
      assert.equal(state.toasts.at(-1).icon, conflicts ? "review" : "check");
      assert.doesNotMatch(state.toasts.at(-1).message, /很长的任务标题/);
    }
  }
});

test("short success copy retains existing toast actions and hides empty descriptions", () => {
  assert.match(text, /persisted.draft_kind === "update" \? "任务已更新" : historicalTaskCompletionLocked\(result.item\) \? "历史任务已创建并自动完成" : result.item.scheduled_dates\.length > 0 \? "任务已创建并安排" : "任务已创建"/);
  assert.match(text, /setSuccessToast\(\{ id: Date.now\(\), message: "已移入回收站" \}\)/);
  assert.match(text, /undo\?\.target_type === "execution_capture"/);
  assert.match(text, /onNotify\(clearingCompletion \? "已取消当天完成" : clearingIncomplete \? \(resultDate < resultToday\(Date\.now\(\)\) \? "已取消本次未完成" : "已取消未完成"\) : executionDraft\.wholeTask \? "整个任务已完成" : noteOnly \? "随手记已保存" : incomplete \? "未完成结果已保存" : "当天结果已保存", "", "check", undoId, seed\)/);
  assert.match(text, /onNotify\("任务已创建", "", "check"\)/);
  assert.match(text, /duration=\{planToast.undoId \|\| planToast.taskSeed \? 10_000/);
  assert.match(text, /label: "撤销"/);
  assert.match(text, /label: "新建任务"/);
  const feedback = readFileSync(new URL("./feedback.tsx", import.meta.url), "utf8");
  assert.match(feedback, /\{description && <p>\{description\}<\/p>\}/);
  for (const verbose of ["工作日和工作时间已更新，只用于安排建议和时间线显示。", "接口类型、连接地址和访问密钥已保存在这台电脑上。", "最小连接测试已通过。", "已生效，10 秒内可以撤销", "已保存，10 秒内可以撤销", "AI 整理的修改已确认并保存", "可在后续日期继续安排。"])
    assert.equal(text.includes(verbose), false, verbose);
});

function executeHandler(file, name, state) {
  const sourceText = readFileSync(new URL(file, import.meta.url), "utf8");
  const ast = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  function find(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) handler = node.getText(ast);
    ts.forEachChild(node, find);
  }
  find(ast);
  assert.ok(handler, name);
  vm.runInContext(ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, vm.createContext(state));
  return state;
}

test("draft creation removes redundant manual save button, places discard on the left, and keeps discard toast", async () => {
  const state = {
    busy: false, draftSaving: false, persistedNewTaskDraft: null, taskDrafts: [{ id: "draft" }],
    feedback: "旧提示", toasts: [],
    async discardTaskDraft() {},
    setBusy(value) { state.busy = value; },
    setTaskDrafts(update) { state.taskDrafts = update(state.taskDrafts); },
    setPendingDiscardTaskDraft() {},
    setDiscardDraftError(value) { state.discardDraftError = value; },
    setFeedback(value) { state.feedback = value; },
    setSuccessToast(value) { state.toasts.push(value); },
    uiErrorMessage: String
  };
  executeHandler("./App.tsx", "discardTaskDraftFromList", state);
  await state.discardTaskDraftFromList({ id: "draft" });
  assert.equal(state.toasts.length, 1);
  assert.equal(state.toasts[0].message, "草稿已放弃");
  assert.equal(state.feedback, null);
  assert.deepEqual(state.taskDrafts, []);
  assert.doesNotMatch(text, /task-action-save-draft|handleManualSaveDraft/);
  assert.match(text, /className="task-compact-lifecycle">[\s\S]*task-action-discard[\s\S]*放弃草稿[\s\S]*task-draft-save-state/);
});

test("recurring occurrence completion notifies cleanly with undo only when completed", async () => {
  for (const undo of [{ id: "undo", target_type: "recurring_review", target_id: "item" }, null]) {
    let undoCalls = 0;
    const state = {
      recurringResultSavingRef: { current: false }, quickCompletingBlockId: null, savingExecution: false, busy: false, loading: false, preview: null, savingDraggedBlock: false, timelineDrag: null, savingRecurringChange: false, pendingRecurringChange: null,
      notifications: [],
      canRecordRecurringOccurrence: () => true,
      setQuickCompletingBlockId(value) { state.quickCompletingBlockId = value; },
      async saveRecurringOccurrenceReview() { return { id: "item", outcome: "completed" }; },
      async clearRecurringOccurrenceReview() {},
      async latestUndo() { return ++undoCalls === 1 ? null : undo; },
      async onFactsChanged() {},
      onNotify(...args) { state.notifications.push(args); },
      uiErrorMessage: String
    };
    executeHandler("./App.tsx", "saveRecurringResult", state);
    await state.saveRecurringResult({ id: "item", occurrence_date: "2026-10-20", outcome: null, review_notes: null }, "completed", "备注");
    assert.deepEqual(state.notifications, [["本次已完成", "", "check", undo?.id]]);
  }
});
