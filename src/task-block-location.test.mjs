import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { taskListStatus } from "./task-result.ts";

const text = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const context = vm.createContext({
  React,
  taskListStatus,
  Icon: () => null,
  TaskDetailContent: ({ children }) => React.createElement("footer", null, children),
  taskResultEditable: () => true,
  taskIsEditable: () => true
});
function collect(node) {
  if (ts.isFunctionDeclaration(node) && ["taskBlockLocationDate", "CompletedTaskDetails"].includes(node.name?.text)) {
    vm.runInContext(ts.transpileModule(node.getText(source), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React }
    }).outputText, context);
  }
  ts.forEachChild(node, collect);
}
collect(source);
const scheduled = dates => ({ id: "task", status: "scheduled", deleted_at: null, scheduled_dates: dates });
const locateDate = task => context.taskBlockLocationDate(task, "2026-10-29");

test("location prefers today, then the nearest future arrangement, without mutating task data", () => {
  const task = scheduled(Object.freeze(["2026-11-02", "2026-10-28", "2026-10-29", "2026-10-30"]));
  assert.equal(locateDate(task), "2026-10-29");
  assert.equal(locateDate(scheduled(["2026-11-02", "2026-10-28", "2026-10-30"])), "2026-10-30");
  assert.equal(task.scheduled_dates[0], "2026-11-02");
});

test("past-only arrangements locate the latest date, including month and year boundaries", () => {
  assert.equal(locateDate(scheduled(["2026-10-01", "2026-10-28", "2026-10-15"])), "2026-10-28");
  assert.equal(locateDate(scheduled(["2027-01-01", "2026-12-31"])), "2026-12-31");
});

test("missing schedules, unscheduled and recycled tasks have no location action", () => {
  assert.equal(locateDate(null), null);
  assert.equal(locateDate(scheduled([])), null);
  for (const status of ["open", "deleted"]) {
    assert.equal(locateDate({ ...scheduled(["2026-10-29"]), status }), null);
  }
  assert.equal(locateDate({ ...scheduled(["2026-10-29"]), deleted_at: "2026-10-29T12:00:00+08:00" }), null);
});

test("completed tasks locate real arrangements, including locked history, but never infer a date", () => {
  assert.equal(locateDate({ ...scheduled(["2026-10-20", "2026-10-28"]), status: "done", execution_locked: true }), "2026-10-28");
  assert.equal(locateDate({ ...scheduled([]), status: "done", due_date: "2026-10-28" }), null);
  assert.equal(locateDate({ ...scheduled(["2026-10-28"]), status: "done", deleted_at: "2026-10-29" }), null);
});

test("only scheduled, completed and incomplete display states locate actual task blocks", () => {
  for (const [status, is_incomplete] of [["scheduled", false], ["done", false], ["open", true], ["scheduled", true]]) {
    const task = { ...scheduled(["2026-10-28"]), status, is_incomplete };
    assert.equal(locateDate(task), "2026-10-28", `${status}, incomplete=${is_incomplete}`);
    assert.equal(locateDate({ ...task, scheduled_dates: [], due_date: "2026-10-29" }), null);
    assert.equal(locateDate({ ...task, deleted_at: "2026-10-29" }), null);
  }
  assert.equal(locateDate({ ...scheduled(["2026-10-28"]), status: "deleted", is_incomplete: true }), null);
});

function detail(onLocate, busy = false, status = "scheduled", is_incomplete = false) {
  return context.CompletedTaskDetails({ task: { ...scheduled(["2026-10-29"]), status, is_incomplete }, busy, now: 0, onLocate });
}
function buttons(element) {
  return React.Children.toArray(element.props.children).flatMap(child => {
    if (!React.isValidElement(child)) return [];
    return child.type === "button" ? [child] : buttons(child);
  });
}

test("detail renders an accessible secondary locate button, invokes its callback, and respects busy", () => {
  let calls = 0;
  const tree = detail(() => calls++);
  const button = buttons(tree).find(item => item.props.children.includes("定位任务块"));
  assert.ok(button);
  assert.equal(button.props.type, "button");
  assert.equal(button.props.className, "secondary-action");
  assert.equal(button.props.disabled, false);
  assert.match(button.props.title, /高亮任务块/);
  button.props.onClick();
  assert.equal(calls, 1);
  assert.match(renderToStaticMarkup(detail(() => {}, true)), /<button[^>]*disabled=""[^>]*>定位任务块<\/button>/);
  assert.doesNotMatch(renderToStaticMarkup(detail(undefined)), /定位任务块/);
});

test("completed detail keeps locate independent of completion and edit actions", () => {
  let calls = 0;
  const button = buttons(detail(() => calls++, false, "done")).find(item => item.props.children.includes("定位任务块"));
  assert.ok(button);
  button.props.onClick();
  assert.equal(calls, 1);
  assert.match(renderToStaticMarkup(detail(() => {}, true, "done")), /<button[^>]*disabled=""[^>]*>定位任务块<\/button>/);
});

test("incomplete detail renders locate for both underlying statuses without changing task state", () => {
  for (const status of ["open", "scheduled"]) {
    let calls = 0;
    const tree = detail(() => calls++, false, status, true);
    const button = buttons(tree).find(item => item.props.children.includes("定位任务块"));
    assert.ok(button);
    button.props.onClick();
    assert.equal(calls, 1);
    assert.equal(tree.props.task.status, status);
    assert.equal(tree.props.task.is_incomplete, true);
    assert.match(renderToStaticMarkup(detail(() => {}, true, status, true)), /<button[^>]*disabled=""[^>]*>定位任务块<\/button>/);
    assert.doesNotMatch(renderToStaticMarkup(detail(undefined, false, status, true)), /定位任务块/);
  }
});

test("workspace connects the selected task and actual schedule date to the existing timeline locator", () => {
  assert.match(text, /const selectedTaskLocationDate = taskBlockLocationDate\(selectedTask, today\);/);
  assert.match(text, /onLocate=\{selectedTaskLocationDate \? \(\) => onOpenToday\(selectedTaskLocationDate, selectedTask\.id\) : undefined\}/);
  assert.match(text, /onOpenToday=\{\(date = today, taskId\) => requestNavigation\(\{ active: "今日", date, timelineReturnContext: taskId \? \{ date, taskId \} : undefined \}\)\}/);
});
