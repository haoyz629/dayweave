import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import vm from "node:vm";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { CopySeparator } from "./copy-separator.test-helper.mjs";

const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const settings = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "SettingsPage");
assert.ok(settings);
const text = settings.getText(source);
const compile = (value) => ts.transpileModule(value, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const availability = { weekdays: [1, 2, 3, 4, 5], workday_start: "09:00", workday_end: "18:00", makeup_workdays_as_workdays: true };

function handler(name) {
  const declaration = settings.body.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, name);
  return declaration.getText(source);
}

function harness() {
  const state = {
    taskLead: 10, desktop: { autostart: true, closeToTray: false },
    savedPreferences: { current: { taskLead: 5, desktop: { autostart: false, closeToTray: true } } },
    draft: structuredClone(availability), availabilityDirty: false, dirty: true, ready: true,
    applyingRef: { current: false }, saving: false, saveMessage: "", confirmClose: false,
    writes: [], reads: [], notices: [], localFeedback: [], preferenceMessage: "", failure: null, closes: 0,
    async setUiSetting(key, value) {
      state.writes.push([key, value]);
      if (state.failure) throw state.failure;
    },
    async getUiSetting(key) {
      state.reads.push(key);
      return ({ "ui.reminder.task_lead": "0", "ui.desktop.close_to_tray": "false", "ui.appearance.mode": "dark" })[key] ?? null;
    },
    async getAutostartEnabled() { return true; },
    async setAutostartEnabled(value) { state.writes.push(["autostart", value]); return value; },
    async saveAvailabilitySettings(value) { state.writes.push(["availability", value]); return value; },
    setSaving(value) { state.saving = value; },
    setSaveMessage(value) { state.saveMessage = value; },
    setConfirmClose(value) { state.confirmClose = value; },
    setPreferenceMessage(value) { state.preferenceMessage = value; },
    setTaskLead(value) { state.taskLead = value; },
    setDesktop(value) { state.desktop = value; },
    setDraft(value) { state.draft = value; },
    onSaved(value) { state.savedAvailability = value; },
    onClose() { state.closes++; },
    onNotify(...args) { state.notices.push(args); },
    showFeedback(...args) { state.localFeedback.push(args); },
    uiErrorMessage: String
  };
  const context = vm.createContext(state);
  for (const name of ["submitAvailability", "savePreferences", "applySettings", "requestClose", "restoreDefaults"])
    vm.runInContext(compile(handler(name)), context);
  return { state, context };
}

const loadEffect = settings.body.statements.find((node) => ts.isExpressionStatement(node)
  && ts.isCallExpression(node.expression) && node.expression.expression.getText(source) === "useEffect"
  && node.expression.arguments[0].getText(source).includes("getAutostartEnabled"));
assert.ok(loadEffect);

test("settings modal retains core controls without bringing back retired settings", () => {
  const context = vm.createContext({
    React, CopySeparator, useState: React.useState, useEffect: React.useEffect, useRef: React.useRef,
    Logo: () => null, Icon: () => null, BlockEditorTimeRangeRail: () => null, HolidayCalendarSettings: () => React.createElement("p", null, "检查节假日更新")
  });
  vm.runInContext(compile(text), context);
  const html = renderToStaticMarkup(React.createElement(context.SettingsPage, {
    availability, availabilityError: null, onSaved() {}, onReload() {}, onClose() {}
  }));
  for (const removed of ["晨间计划", "晚间复盘", "GitHub", "Codex", "明暗模式", "应用 Logo", "界面字号", "全局快捷键", "本地数据", "未加密", "数据与隐私", "回收站", "可配置", "已接入"])
    assert.equal(html.includes(removed), false, removed);
  for (const retained of ["工作日", "调休补班日", "每日工作时段", "检查节假日更新", "任务块提前提醒", "测试通知", "开机启动", "关闭到托盘", "应用并关闭", "0–60 分钟，0 表示关闭"])
    assert.ok(html.includes(retained), retained);
  assert.match(html, /<dialog[^>]+aria-modal="true"/);
  assert.match(html, /role="switch" aria-label="开机启动"/);
  assert.match(html, /role="switch" aria-label="关闭到托盘"/);
  assert.match(html, /type="checkbox" aria-label="补班日计入工作日" checked=""/);
  assert.match(html, /inputMode="numeric" autoComplete="off" min="0" max="60" step="1" aria-describedby="settings-reminder-help"/);
  assert.doesNotMatch(html, /节假日涉及的补班日自动识别为工作日|任务开始前发送桌面通知/);
  assert.doesNotMatch(text, /settingsCategories|previewAppearance/);
  assert.doesNotMatch(app, /label: "设置"|active === "设置"|settingsEditorDirty/);
});

test("loading reads only retained settings and preserves zero as disabled", async () => {
  const { state, context } = harness();
  state.savedPreferences.current = null;
  vm.runInContext(compile(`var loadSettings = ${loadEffect.expression.arguments[0].getText(source)};`), context);
  const cancel = state.loadSettings();
  await setImmediate();
  assert.deepEqual(state.reads, ["ui.reminder.task_lead", "ui.desktop.close_to_tray"]);
  assert.equal(state.taskLead, 0);
  assert.equal(state.desktop.autostart, true);
  assert.equal(state.desktop.closeToTray, false);
  assert.equal(state.savedPreferences.current.taskLead, 0);
  cancel();
});

test("failed or unmounted loads cannot enable or replace preferences", async () => {
  const { state, context } = harness();
  state.savedPreferences.current = null;
  state.getAutostartEnabled = async () => { throw "读取失败"; };
  vm.runInContext(compile(`var loadSettings = ${loadEffect.expression.arguments[0].getText(source)};`), context);
  state.loadSettings();
  await setImmediate();
  assert.equal(state.savedPreferences.current, null);
  assert.equal(state.preferenceMessage, "读取失败");
  await state.savePreferences();
  assert.deepEqual(state.writes, []);
  state.getAutostartEnabled = async () => true;
  const cancel = state.loadSettings(); cancel(); await setImmediate();
  assert.equal(state.savedPreferences.current, null);
});

test("apply saves only changed settings and closes only after success", async () => {
  const { state } = harness();
  await state.applySettings(true);
  assert.deepEqual(state.writes, [["ui.reminder.task_lead", "10"], ["ui.desktop.close_to_tray", "false"], ["autostart", true]]);
  assert.equal(state.savedPreferences.current.taskLead, 10);
  assert.equal(state.savedPreferences.current.desktop.closeToTray, false);
  assert.deepEqual(state.localFeedback, [["设置已应用"]]);
  assert.deepEqual(state.notices, [], "settings never notify the main page");
  assert.equal(state.closes, 1);
  assert.equal(state.saving, false);
  state.writes.length = 0;
  await state.savePreferences();
  assert.deepEqual(state.writes, []);
});

test("invalid reminder or empty weekdays cannot write any settings", async () => {
  for (const value of [-1, 61, 1.5, NaN]) {
    const { state } = harness(); state.taskLead = value;
    await state.applySettings(true);
    assert.deepEqual(state.writes, []);
    assert.match(state.saveMessage, /0 到 60 分钟的整数/);
    assert.equal(state.closes, 0);
  }
  const { state } = harness(); state.draft.weekdays = [];
  await state.applySettings(true);
  assert.deepEqual(state.writes, []);
  assert.match(state.saveMessage, /至少选择一个工作日/);
});

test("partial failure waits for all writes, retains successful snapshots, and retries failures only", async () => {
  const { state } = harness();
  state.failure = "保存失败";
  let finishAutostart;
  state.setAutostartEnabled = () => new Promise((resolve) => { finishAutostart = resolve; });
  const pending = state.applySettings(true);
  await setImmediate();
  assert.equal(state.saving, true);
  state.requestClose();
  await state.applySettings(true);
  assert.equal(state.closes, 0);
  assert.equal(state.confirmClose, false);
  finishAutostart(true); await pending;
  assert.equal(state.savedPreferences.current.desktop.autostart, true);
  assert.equal(state.savedPreferences.current.taskLead, 5);
  assert.equal(state.taskLead, 10);
  assert.equal(state.saving, false);
  assert.match(state.saveMessage, /部分设置未应用/);
  assert.equal(state.closes, 0);
  state.failure = null; state.writes.length = 0;
  await state.applySettings(false);
  assert.deepEqual(state.writes, [["ui.reminder.task_lead", "10"], ["ui.desktop.close_to_tray", "false"]]);
});

test("availability failure cannot close the modal or discard successful preferences", async () => {
  const { state } = harness(); state.availabilityDirty = true;
  state.saveAvailabilitySettings = async () => { throw "工作时间失败"; };
  await state.applySettings(true);
  assert.equal(state.closes, 0);
  assert.equal(state.savedPreferences.current.taskLead, 10);
  assert.equal(state.savedAvailability, undefined);
  assert.match(state.saveMessage, /工作时间失败/);
});

test("defaults and discard protection never write until Apply", () => {
  const { state } = harness();
  state.restoreDefaults();
  assert.equal(state.taskLead, 5);
  assert.equal(state.desktop.autostart, false);
  assert.equal(state.desktop.closeToTray, true);
  assert.deepEqual(JSON.parse(JSON.stringify(state.draft)), availability);
  assert.deepEqual(state.writes, []);
  state.requestClose();
  assert.equal(state.confirmClose, true);
  assert.equal(state.closes, 0);
  state.dirty = false; state.requestClose();
  assert.equal(state.closes, 1);
});

test("unchanged apply-and-close has zero writes", async () => {
  const { state } = harness(); state.dirty = false;
  await state.applySettings(true);
  assert.deepEqual(state.writes, []);
  assert.equal(state.closes, 1);
});

test("startup ignores retired settings while retaining persistence and task notifications", () => {
  const native = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const database = readFileSync(new URL("../src-tauri/src/database.rs", import.meta.url), "utf8");
  const cargo = readFileSync(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8");
  const ipc = readFileSync(new URL("./tauri.ts", import.meta.url), "utf8");
  for (const code of [app, native])
    assert.doesNotMatch(code, /ui\.appearance\.|ui\.reminder\.(morning|evening)|ui\.desktop\.shortcut/);
  assert.doesNotMatch(native + ipc + cargo, /global.shortcut|setAppLogoMode|set_app_logo_mode/);
  assert.doesNotMatch(database, /fn claim_daily_notification/);
  assert.match(native, /Database::open\(data_dir.join\(legacy::DATABASE_NAME\)\)/);
  assert.match(native, /legacy::migrate_database/);
  assert.match(native, /purge_expired_deleted_items/);
  assert.match(native, /claim_due_task_block_notifications\(task_lead\)/);
  assert.match(database, /if lead_minutes == 0 \{ return Ok\(Vec::new\(\)\); \}/);
  assert.match(app, /dataset\.theme = "default"/);
  assert.match(app, /dataset\.mode = "light"/);
  assert.doesNotMatch(app, /--app-font-size/);
});

test("settings use shared task time fields and transient feedback without replacing save errors", () => {
  assert.match(text, /<BlockEditorTimeRangeRail[^>]+inputsOnly showPresets=\{false\}[^>]+onChange=\{updateWorkdayRange\}/);
  assert.match(text, /<HolidayCalendarSettings compact onResult=\{showFeedback\}/);
  assert.match(text, /sendTestNotification\(\)\.then\(\(\) => showFeedback\("测试通知已发送"\)\)/);
  assert.match(text, /<Toast key=\{feedback.id\} container=\{feedbackHost\}[^>]+duration=\{4000\}/);
  assert.doesNotMatch(text, /setPreferenceMessage\("测试通知已发送"\)/);
  assert.doesNotMatch(text, /onNotify/);
  assert.match(handler("applySettings"), /showFeedback\(`设置未全部应用：\$\{errors.join\("；"\)\}`, true\)/);
  assert.match(text, /className="settings-dialog-content" tabIndex=\{0\} role="region"/);
  assert.match(text, /<fieldset className="settings-dialog-fields" disabled=\{saving\}/);
  const state = { feedbackId: { current: 0 }, setFeedback(value) { state.feedback = value; } };
  vm.runInNewContext(compile(handler("showFeedback")), state);
  state.showFeedback("测试通知已发送");
  const first = state.feedback.id;
  state.showFeedback("测试通知已发送");
  assert.ok(state.feedback.id > first, "same message restarts the Toast lifetime");
  state.showFeedback("发送失败", true);
  assert.equal(state.feedback.error, true);
});

test("settings typography follows the shared UI stack and readable role scale", () => {
  const css = readFileSync(new URL("./settings-dialog.css", import.meta.url), "utf8");
  assert.match(css, /\.settings-dialog \{[^}]*font: 400 14px\/1\.5 var\(--jx-font-sans\)/);
  assert.match(css, /\.settings-dialog-header h1 \{[^}]*font: 600 16px\/24px var\(--jx-font-sans\)/);
  assert.match(css, /\.settings-dialog-section h2 \{[^}]*font: 500 13px\/20px var\(--jx-font-sans\); letter-spacing: 0/);
  assert.match(css, /\.settings-field-copy strong \{[^}]*font-size: 14px; font-weight: 500/);
  assert.match(css, /\.settings-field-copy small \{[^}]*font-size: 12px; line-height: 18px/);
  assert.match(css, /\.settings-dialog-actions > button \{[^}]*font-size: 13px/);
  assert.doesNotMatch(css, /font: 700|text-transform: uppercase|letter-spacing: \.12em/);
});

test("settings top toast uses dedicated smooth entrance without scrollbar flicker or jitter", () => {
  const dialogCss = readFileSync(new URL("./settings-dialog.css", import.meta.url), "utf8");
  const colorSystemCss = readFileSync(new URL("./color-system.css", import.meta.url), "utf8");
  assert.match(dialogCss, /\.settings-dialog \.settings-feedback-viewport \{[^}]*overflow:\s*visible;/);
  assert.match(dialogCss, /\.settings-dialog \.settings-feedback-viewport \.feedback-toast \{[^}]*animation:\s*settings-toast-enter/);
  assert.match(dialogCss, /@keyframes settings-toast-enter \{[\s\S]*from \{ opacity: 0; transform: translateY\(-8px\); \}/);
  assert.match(colorSystemCss, /html:root:not\(\[data-mode="dark"\]\) \.settings-dialog \.settings-feedback-viewport \{[^}]*overflow:\s*visible;/);
  assert.match(colorSystemCss, /html:root:not\(\[data-mode="dark"\]\) \.settings-dialog \.settings-feedback-viewport \.feedback-toast \{[^}]*animation:\s*settings-toast-enter/);
});
