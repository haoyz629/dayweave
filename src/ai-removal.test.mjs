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

function renderSettings() {
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
    Icon: () => null,
    HolidayCalendarSettings: () => null
  });
  vm.runInContext(code, context);
  return renderToStaticMarkup(React.createElement(context.SettingsPage, {
    onClose() {}
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

test("settings renders split non-AI sections in one preferences modal", () => {
  const html = renderSettings();
  assert.match(html, /<dialog[^>]*class="settings-dialog"/);
  assert.match(html, /aria-label="设置分类"/);
  for (const id of ["settings-holiday-title", "settings-reminder-title", "settings-system-title", "settings-about-title"]) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  assert.doesNotMatch(html, /AI|访问密钥|API Key|测试连接|保存连接|id="ai"|常规工作日|调休补班日/);
  assert.match(html, /0–60 分钟，0 表示关闭/);
  assert.match(html, /测试通知/);
});

test("settings omits workday settings and keeps preference loading without AI configuration", () => {
  assert.match(renderSettings(), /正在加载设置/);
  assert.doesNotMatch(settings.getText(source), /aiSettings|aiDirty|aiBusy|aiForm|AiConnection|\bAI\b|availability/);
  assert.match(settings.getText(source), /const dirty = preferencesDirty/);
});

test("manual creation, drafts, scheduling and historical task provenance remain intact", () => {
  for (const api of ["createManualTaskDraft", "confirmCreationDraft", "listTaskDrafts", "saveTaskDraft", "confirmRuleBasedPlan", "saveExecutionCapture", "resolveTaskExecution"]) {
    assert.ok(app.includes(api), `${api} remains available`);
  }
  assert.match(app, /<TaskWorkspace\b/);
  assert.match(app, /<TodayPage\b/);
  assert.match(app, /sourceType === "ai_assistant" && <span[^>]*aria-label="AI 创建"/);
});
