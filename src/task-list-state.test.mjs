import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { taskListStatus, taskResultEditable } from "./task-result.ts";
import { independentTaskDraft } from "./task-followup.ts";

const text = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map(), expressions = new Map();
let capsule;
function collect(node) {
  if (ts.isFunctionDeclaration(node) && ["taskMatchesView", "TaskCapsuleContent", "CompletedTaskDetails"].includes(node.name?.text)) functions.set(node.name.text, node.getText(source));
  if (ts.isVariableDeclaration(node) && ["statusCopy", "taskViewCopy", "taskViewGroups", "taskEmptyCopy", "counts"].includes(node.name.getText(source))) expressions.set(node.name.getText(source), node.initializer.getText(source));
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === "TaskCapsuleContent" && node.attributes.properties.some(attr => attr.name?.getText(source) === "statusTone" && attr.initializer?.getText(source) === "{taskListStatus(task)}")) capsule = node.getText(source);
  ts.forEachChild(node, collect);
}
collect(source);
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
function harness(tasks = []) {
  const state = {
    React, taskListStatus, taskResultEditable, tasks, taskDrafts: [], recurringItems: [],
    useMemo: fn => fn(), Icon: () => null, TaskTagList: () => null, TaskCapsuleFact: () => null,
    splitTaskNotes: value => ({ body: value }), priorityCopy: {}, taskTimingFact: () => null,
    today: "2026-10-20"
  };
  const context = vm.createContext(state);
  for (const code of functions.values()) vm.runInContext(compile(code), context);
  for (const [name, expression] of expressions) vm.runInContext(compile(`var ${name} = ${expression};`), context);
  return { state, context };
}
const original = { id: "original", title: "原任务", tags: [], notes: null, status: "scheduled", is_incomplete: true, execution_locked: true, result_date: null };

test("unfinished is a separate filter with exclusive counts, not open or scheduled", () => {
  const tasks = [original, { ...original, id: "pending", is_incomplete: false }, { ...original, id: "open", status: "open", is_incomplete: false }, { ...original, id: "done", status: "done" }, { ...original, id: "deleted", status: "deleted" }];
  const { state } = harness(tasks);
  assert.deepEqual(JSON.parse(JSON.stringify(state.counts)), { draft: 0, recurring: 0, open: 1, scheduled: 1, not_completed: 1, done: 1, deleted: 1 });
  for (const task of tasks) {
    const matches = ["open", "scheduled", "not_completed", "done", "deleted"].filter(view => state.taskMatchesView(task, view));
    assert.deepEqual(matches, [taskListStatus(task)]);
    assert.equal(state.taskMatchesView(task, "draft"), false);
    assert.equal(state.taskMatchesView(task, "recurring"), false);
  }
  assert.ok(state.taskViewGroups.some(group => group.items.includes("not_completed")));
  assert.equal(state.taskViewCopy.not_completed, "未完成");
  assert.equal(state.taskEmptyCopy.not_completed, "暂无未完成任务");
});

test("capsule and read-only details share derived labels and status tones", () => {
  for (const [status, is_incomplete, label, tone] of [["scheduled", true, "未完成", "not_completed"], ["scheduled", false, "已安排", "scheduled"], ["open", false, "待处理", "open"], ["done", true, "已完成", "done"]]) {
    const { state, context } = harness();
    state.task = { ...original, status, is_incomplete };
    const row = renderToStaticMarkup(vm.runInContext(compile(`(${capsule});`), context));
    const details = renderToStaticMarkup(state.CompletedTaskDetails({ task: state.task, busy: false, now: Date.parse("2026-10-20T12:00:00+08:00"), onReopen() {}, onTrash() {}, onComplete() {} }));
    assert.match(row, new RegExp(`task-capsule-status status-${tone}[^>]*>${label}`));
    assert.match(details, new RegExp(`terminal-task-status status-${tone}[^>]*>${label}`));
  }
});

test("new independent task keeps its own classification while original remains unfinished", () => {
  const input = independentTaskDraft(original, "2026-10-20");
  assert.equal("is_incomplete" in input, false);
  assert.equal("id" in input, false);
  const created = { ...input, id: "independent", status: "scheduled", is_incomplete: false };
  const { state } = harness([original, created]);
  assert.equal(state.counts.not_completed, 1);
  assert.equal(state.counts.scheduled, 1);
  assert.equal(taskListStatus(original), "not_completed");
  assert.equal(taskListStatus(created), "scheduled");
});

test("unfinished colors have light and dark tokens and cover row, capsule and details", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  assert.equal((css.match(/--task-state-incomplete:/g) ?? []).length, 2);
  for (const selector of [".task-capsule-status.status-not_completed", ".task-compact-status.status-not_completed", ".terminal-task-status.status-not_completed", ".status-row-not_completed .ledger-accent"]) assert.ok(css.includes(selector));
});
