import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const appText = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const bridgeText = readFileSync(new URL("./tauri.ts", import.meta.url), "utf8");
const nativeText = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const notificationText = readFileSync(new URL("../src-tauri/src/desktop_notifications.rs", import.meta.url), "utf8");
const source = ts.createSourceFile("App.tsx", appText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const app = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "App");
const statements = app.body.statements;
const requestNavigation = statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "requestNavigation");
const applyNavigation = statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "applyNavigation");
const reminderCallback = statements.find(node => node.getText(source).startsWith("reminderNavigationRef.current ="));
const reminderEffect = statements.find(node => ts.isExpressionStatement(node) && node.getText(source).startsWith("useEffect(") && node.getText(source).includes("onReminderActivated("));
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));

function navigationContext(overrides = {}) {
  const calls = [];
  const context = vm.createContext({
    active: "今日", selectedDate: "2026-11-11", planPreview: null, taskEditorDirty: false,
    mobileNavOpen: false, timelineReturnContext: null, reminderNavigationRef: { current: null },
    normalizeTodayNavigation: active => ({ active }),
    setMobileNavOpen(open) { context.mobileNavOpen = open; },
    setPlanLeaveError() {},
    setPendingPlanLeave: value => calls.push(["plan-guard", value]),
    setPendingNavigation: value => calls.push(["task-guard", value]),
    applyNavigation: value => calls.push(["navigate", value]),
    ...overrides
  });
  vm.runInContext(compile(requestNavigation.getText(source) + "\n" + reminderCallback.getText(source)), context);
  return { calls, context };
}
const target = { date: "2026-11-12", blockId: "exact-block" };
const plain = value => JSON.parse(JSON.stringify(value));

test("notification activation uses the exact date and block through guarded navigation", () => {
  const { calls, context } = navigationContext();
  context.reminderNavigationRef.current({ target, action: "open" });
  assert.deepEqual(plain(calls), [["navigate", { active: "今日", date: target.date, timelineReturnContext: target }]]);
});

test("notification clicks preserve unsaved task edits and plan drafts", () => {
  const task = navigationContext({ active: "任务", taskEditorDirty: true });
  task.context.reminderNavigationRef.current({ target, action: "open" });
  assert.equal(task.calls.length, 1);
  assert.equal(task.calls[0][0], "task-guard");
  const plan = navigationContext({ planPreview: { preview_id: "draft" } });
  plan.context.reminderNavigationRef.current({ target, action: "open" });
  assert.equal(plan.calls.length, 1);
  assert.equal(plan.calls[0][0], "plan-guard");
});

test("completion refreshes tasks and schedule without navigating", async () => {
  const { calls, context } = navigationContext({
    refreshTasks: loading => { calls.push(["tasks", loading]); return Promise.resolve(); },
    refreshSchedule: (date, loading) => { calls.push(["schedule", date, loading]); return Promise.resolve(); }
  });
  context.reminderNavigationRef.current({ target, action: "completed" });
  await flush();
  assert.deepEqual(plain(calls), [["tasks", false], ["schedule", "2026-11-11", false]]);
});

test("same-date block notification refreshes the real schedule before locating", () => {
  let refreshed = 0;
  const context = vm.createContext({
    selectedDate: target.date, refreshSchedule: date => { assert.equal(date, target.date); refreshed++; },
    setRequestedTaskView() {}, setTimelineReturnContext() {}, normalizeTodayNavigation: active => ({ active }),
    setActive() {}, setMobileNavOpen() {}, setScheduleLoading() {}, setSelectedDate() {}
  });
  vm.runInContext(compile(applyNavigation.getText(source)), context);
  context.applyNavigation({ active: "今日", date: target.date, timelineReturnContext: target });
  assert.equal(refreshed, 1);
});

test("event listener uses the latest navigation callback and unsubscribes on unmount", async () => {
  let activate, cleanup, stopped = 0, first = 0, latest = 0;
  const ref = { current: () => first++ };
  const context = vm.createContext({
    reminderNavigationRef: ref,
    onReminderActivated: callback => { activate = callback; return Promise.resolve(() => stopped++); },
    useEffect: effect => { cleanup = effect(); },
    setMessage: message => assert.fail(message), uiErrorMessage: String
  });
  vm.runInContext(compile(reminderEffect.getText(source)), context);
  await flush();
  ref.current = () => latest++;
  activate(target);
  assert.equal(first, 0);
  assert.equal(latest, 1);
  cleanup();
  activate(target);
  assert.equal(latest, 1, "late callbacks must be ignored after unmount");
  assert.equal(stopped, 1);
});

test("an event subscription resolving after unmount is immediately disposed", async () => {
  let resolve, activate, cleanup, stopped = 0;
  const context = vm.createContext({
    reminderNavigationRef: { current() { assert.fail("late event after unmount"); } },
    onReminderActivated: callback => { activate = callback; return new Promise(done => { resolve = done; }); },
    useEffect: effect => { cleanup = effect(); },
    setMessage: message => assert.fail(message), uiErrorMessage: String
  });
  vm.runInContext(compile(reminderEffect.getText(source)), context);
  cleanup();
  activate(target);
  resolve(() => stopped++);
  await flush();
  assert.equal(stopped, 1);
});

test("desktop bridge subscribes only in Tauri and forwards the unchanged target", async () => {
  const bridgeSource = ts.createSourceFile("tauri.ts", bridgeText, ts.ScriptTarget.Latest, true);
  const fn = bridgeSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "onReminderActivated");
  let listener, subscriptions = 0, received;
  const context = vm.createContext({ window: {}, listen: (name, callback) => {
    assert.equal(name, "reminder-activated"); listener = callback; subscriptions++;
    return Promise.resolve(() => {});
  } });
  vm.runInContext(compile(fn.getText(bridgeSource).replace(/^export /, "")), context);
  (await context.onReminderActivated(() => assert.fail("browser must not subscribe")))();
  assert.equal(subscriptions, 0);
  context.window.__TAURI_INTERNALS__ = {};
  await context.onReminderActivated(value => { received = value; });
  listener({ payload: target });
  assert.equal(subscriptions, 1);
  assert.equal(received, target);
});

test("single-instance protection is installed first and only restores the existing window", () => {
  assert.match(nativeText, /tauri::Builder::default\(\)\s*\.plugin\(single_instance_plugin\(\)\)/);
  assert.match(nativeText, /tauri_plugin_single_instance::init\(\|app, _args, _cwd\| show_main_window\(app\)\)/);
  assert.match(nativeText, /fn show_main_window[\s\S]*?window\.show\(\)[\s\S]*?window\.unminimize\(\)[\s\S]*?window\.set_focus\(\)/);
});

test("test and scheduled notifications share an explicit Windows brand identity", () => {
  assert.match(nativeText, /desktop_notifications::show\(&app, "提醒已准备好"/);
  assert.match(nativeText, /desktop_notifications::show\(app, &title, &body, Some\(block\), is_snoozed\)/);
  assert.match(notificationText, /Toast::new\(&app\.config\(\)\.identifier\)/);
  assert.match(notificationText, /set_value\("DisplayName"/);
  assert.match(notificationText, /set_value\("IconUri"/);
  assert.doesNotMatch(notificationText, /POWERSHELL_APP_ID|Command::new/);
  assert.match(notificationText, /crate::show_main_window\(&app\)/);
  assert.match(notificationText, /app\.emit\("reminder-activated", target\)/);
});
