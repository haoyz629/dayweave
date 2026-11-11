import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { CopySeparator } from "./copy-separator.test-helper.mjs";

const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const settings = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "SettingsPage");
assert.ok(settings, "the normal settings page remains available");

function renderSettings(availability, availabilityError = null) {
  // Render the real settings component, stubbing only unrelated visual children.
  const code = ts.transpileModule(settings.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React }
  }).outputText;
  const context = vm.createContext({
    React, CopySeparator,
    useState: React.useState,
    useEffect: React.useEffect,
    useRef: React.useRef,
    Logo: () => null,
    TimeRangeRail: () => null,
    HolidayCalendarSettings: () => null
  });
  vm.runInContext(code, context);
  return renderToStaticMarkup(React.createElement(context.SettingsPage, {
    availability,
    availabilityError,
    onSaved() {},
    onReload() {},
    onNotify() {},
    onDirtyChange() {}
  }));
}

test("application no longer imports or calls AI APIs or mounts the assistant", () => {
  const identifiers = [];
  function collect(node) {
    if (ts.isIdentifier(node) && /Ai[A-Z]|FloatingAssistant|assistantOpen|setAssistantOpen/.test(node.text)) {
      identifiers.push(node.text);
    }
    ts.forEachChild(node, collect);
  }
  collect(source);
  assert.deepEqual(identifiers, []);
  assert.doesNotMatch(app, /assistant-orb|assistant-popover|ui\.ai\.current_conversation/);
});

test("settings renders five non-AI categories and defaults to working time", () => {
  const html = renderSettings({ weekdays: [1, 2, 3, 4, 5], workday_start: "09:00", workday_end: "18:00" });
  const nav = html.match(/<nav aria-label="设置分类">(.*?)<\/nav>/)?.[1];
  assert.ok(nav);
  assert.equal((nav.match(/<button\b/g) || []).length, 5);
  assert.match(nav, /^<button[^>]*class="active"[^>]*aria-current="location"[^>]*>工作时间<\/button>/);
  for (const id of ["work", "reminder", "appearance", "desktop", "privacy"]) {
    assert.ok(html.includes(`id="${id}"`));
  }
  assert.doesNotMatch(html, /AI|访问密钥|API Key|测试连接|保存连接|id="ai"/);
  assert.match(html, /按设定时间发送通知，不会自动更改任务或计划。/);
  assert.match(html, /发送测试通知/);
});

test("settings keeps its working-time loading and retry states without AI configuration", () => {
  assert.match(renderSettings(null), /正在载入日计划偏好/);
  const failed = renderSettings(null, "无法读取本地数据");
  assert.match(failed, /日计划偏好暂时无法打开/);
  assert.match(failed, /重试/);
  assert.doesNotMatch(settings.getText(source), /aiSettings|aiDirty|aiBusy|aiForm|AiConnection|\bAI\b/);
  assert.match(settings.getText(source), /const dirty = availabilityDirty \|\| preferencesDirty/);
});

test("manual creation, drafts, scheduling and historical task provenance remain intact", () => {
  for (const api of ["createManualTaskDraft", "confirmCreationDraft", "listTaskDrafts", "saveTaskDraft", "confirmRuleBasedPlan", "saveExecutionCapture", "resolveTaskExecution"]) {
    assert.ok(app.includes(api), `${api} remains available`);
  }
  assert.match(app, /<TaskWorkspace\b/);
  assert.match(app, /<TodayPage\b/);
  assert.match(app, /sourceType === "ai_assistant" && <span[^>]*aria-label="AI 创建"/);
});
