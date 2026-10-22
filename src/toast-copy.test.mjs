import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Exercise the actual UI handlers without connecting to the desktop database.
const text = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(["submitAvailability", "savePreferences", "saveTimelineChange", "saveBlockTime", "discardPlanDraft", "confirmRulePlan", "undoConfirmedPlan", "includeUnscheduledTask"]);
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
    draft: { weekdays: [1], workday_start: "09:00", workday_end: "18:00" }, saving: false,
    preferenceBusy: false, reminders: {}, appearance: {}, desktop: {}, savedPreferences: { current: null },
    planBusy: false, today: "2026-10-19", selectedDate: "2026-10-19", selectedDateRef: { current: "2026-10-19" },
    planPreview: { preview_id: "draft", version: 1, plan_date: "2026-10-19", base_plan_id: null, blocks: [], unscheduled: [] },
    undo: { id: "undo-1", target_type: "task", target_id: "task-1" }, saved: { task_blocks: [] },
    discardResult: { restored_task_count: 0, conflicted_task_titles: [] },
    notifications: [], toasts: [], failure: null, tasks: [], MIN_TASK_BLOCK_MINUTES: 15,
    suggestion: { allocations: [], remainingMinutes: 0 },
    onNotify(...args) { state.notifications.push(args); },
    setPlanToast(value) { if (value) state.toasts.push(value); },
    async saveAvailabilitySettings(input) { if (state.failure) throw state.failure; return input; },
    async setUiSetting() { if (state.failure) throw state.failure; },
    async setGlobalShortcut() {}, async setAutostartEnabled() {}, onSaved() {},
    async refreshTasks() {}, async refreshSchedule() {}, async applyUndo() {},
    async latestUndo() { return state.undo; },
    async updatePlanBlockTime() { return state.saved; },
    async discardRulePlanDraft() { return state.discardResult; },
    async confirmRuleBasedPlan() { return state.saved; },
    uiErrorMessage: String, planDraftErrorMessage: String, shanghaiDateValue: () => "2026-10-19",
    taskSchedulingBoundaryIssue: () => null,
    availability: { weekdays: [1], workday_start: "09:00", workday_end: "18:00" },
    preferredDailyAllocationMinutes: (_task, minutes) => minutes,
    suggestedDraftAllocations: () => state.suggestion,
    taskUnreservedMinutes: () => 0,
    async onUpdatePlan(input) { return input; }
  };
  state.preview = state.planPreview;
  for (const key of ["saving", "draft", "saveMessage", "preferenceBusy", "preferenceMessage", "planBusy", "message", "daySchedule", "planPreview"]) {
    state[`set${key[0].toUpperCase()}${key.slice(1)}`] = (value) => { state[key] = value; };
  }
  vm.runInContext(code, vm.createContext(state));
  return state;
}

const submitEvent = { preventDefault() {} };
const settingCases = [
  ["submitAvailability", "工作时间已保存", "工作时间未保存"],
  ["savePreferences", "设置已保存", "设置未保存"]
];

for (const [handler, success, failure] of settingCases) {
  test(`${handler} shows one success sentence and retains the failure reason`, async () => {
    const state = harness();
    await state[handler](submitEvent);
    assert.deepEqual(state.notifications.at(-1), [success, "", "check"]);
    state.failure = "网络不可用，请重试";
    await state[handler](submitEvent);
    assert.deepEqual(state.notifications.at(-1), [failure, state.failure, "review"]);
  });
}

test("timeline success messages omit explanations but retain undo identity", async () => {
  const state = harness();
  await state.saveTimelineChange("task-1", "已加入时间线", async () => state.saved);
  assert.equal(state.toasts.at(-1).label, "已加入时间线");
  assert.equal(state.toasts.at(-1).message, "");
  assert.equal(state.toasts.at(-1).undoId, "undo-1");
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

test("draft allocation keeps partial quantities and does not claim the draft is confirmed", async () => {
  for (const remaining of [0, 30]) {
    const state = harness();
    state.suggestion.remainingMinutes = remaining;
    await state.includeUnscheduledTask({ task_id: "task-1", task_title: "不重复显示的任务名", estimated_minutes: 90 });
    assert.deepEqual(state.notifications.at(-1), ["已加入计划草案", remaining ? "已安排 60 分钟，剩余 30 分钟" : "", "check"]);
  }
});

test("allocation failures retain duration limits and a next step", async () => {
  const cases = [
    ["duration_too_short", 7, "剩余 7 分钟，不足 15 分钟，请调整工作量"],
    ["available_window_too_short", 90, "当天可用时间不足 15 分钟，请调整时间或更换日期"],
    ["outside_range", 90, "请调整任务时间或更换日期"]
  ];
  for (const [issue, minutes, message] of cases) {
    const state = harness();
    state.suggestion.issue = issue;
    await state.includeUnscheduledTask({ task_id: "task-1", task_title: "任务", estimated_minutes: minutes });
    assert.deepEqual(state.notifications.at(-1), ["无法安排", message, "clock"]);
  }
});

test("short success copy retains existing toast actions and hides empty descriptions", () => {
  assert.match(text, /persisted.draft_kind === "update" \? "任务已更新" : result.item.status === "scheduled" \? "任务已创建并安排" : "任务已创建"/);
  assert.match(text, /setSuccessToast\(\{ id: Date.now\(\), message: "已移入回收站" \}\)/);
  assert.match(text, /undo\?\.target_type === "execution_capture"/);
  assert.match(text, /onNotify\(incomplete \? "未完成结果已保存" : "当天结果已保存", "", "check", undoId, seed\)/);
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

test("manual draft save and discard emit one toast and clear duplicate page feedback", async () => {
  const state = {
    busy: false, draftSaving: false, persistedNewTaskDraft: null, taskDrafts: [{ id: "draft" }],
    savedWithFeedback: null, feedback: "旧提示", toasts: [],
    async persistCurrentTaskDraft(showFeedback) { state.savedWithFeedback = showFeedback; state.feedback = null; return { id: "draft" }; },
    async discardTaskDraft() {},
    setBusy(value) { state.busy = value; },
    setTaskDrafts(update) { state.taskDrafts = update(state.taskDrafts); },
    setPendingDiscardTaskDraft() {},
    setFeedback(value) { state.feedback = value; },
    setSuccessToast(value) { state.toasts.push(value); },
    uiErrorMessage: String
  };
  executeHandler("./App.tsx", "handleManualSaveDraft", state);
  executeHandler("./App.tsx", "discardTaskDraftFromList", state);
  await state.handleManualSaveDraft();
  assert.equal(state.toasts.length, 1);
  assert.equal(state.toasts[0].message, "草稿已保存");
  assert.equal(state.feedback, null);
  assert.match(text, /if \(showFeedback\) setFeedback\(null\)/);
  state.feedback = "旧提示";
  await state.discardTaskDraftFromList({ id: "draft" });
  assert.equal(state.toasts.length, 2);
  assert.equal(state.toasts[1].message, "草稿已放弃");
  assert.equal(state.feedback, null);
  assert.deepEqual(state.taskDrafts, []);
});

test("recurring review uses either an undo toast or inline success, never both", async () => {
  for (const undo of [{ id: "undo" }, null]) {
    const state = {
      recurringRef: { current: { item: { notes: "备注" } } }, occurrences: [], messages: {}, toast: null,
      queue: { current: { forget() {} } }, identity: (...args) => args.join(":"),
      run(_id, action) { state.pending = action(); },
      async saveRecurringOccurrenceReview() { return { id: "item", outcome: "completed" }; },
      async latestUndo() { return undo; }, async loadReviewSchedule() {}, async onFactsChanged() {}, reviewDate: "2026-10-20",
      setToast(value) { state.toast = value; },
      setOccurrences(update) { state.occurrences = update(state.occurrences); },
      setMessages(update) { state.messages = update(state.messages); }
    };
    executeHandler("./review-page.tsx", "saveRecurring", state);
    state.saveRecurring({ id: "item" }, "completed");
    await state.pending;
    assert.equal(state.toast?.message ?? null, undo ? "本次结果已保存" : null);
    assert.equal(state.toast?.id ?? null, undo?.id ?? null);
    assert.equal(state.messages.item, undo ? "" : "本次结果已保存。");
  }
});

test("date-boundary warnings retain the reason without repeating long task titles", async () => {
  const state = harness();
  state.taskSchedulingBoundaryIssue = () => "已于 10月19日 截止，请调整任务时间范围后再安排";
  await state.includeUnscheduledTask({ task_id: "task-1", task_title: "很长的任务名".repeat(100), estimated_minutes: 90 });
  assert.deepEqual(state.notifications, [["当前日期不能安排", state.taskSchedulingBoundaryIssue(), "clock"]]);
});
