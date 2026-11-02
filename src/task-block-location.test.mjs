import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const text = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const context = vm.createContext({
  React,
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

test("missing schedules, unscheduled, completed and recycled tasks have no location action", () => {
  assert.equal(locateDate(null), null);
  assert.equal(locateDate(scheduled([])), null);
  for (const status of ["open", "done", "deleted"]) {
    assert.equal(locateDate({ ...scheduled(["2026-10-29"]), status }), null);
  }
  assert.equal(locateDate({ ...scheduled(["2026-10-29"]), deleted_at: "2026-10-29T12:00:00+08:00" }), null);
});

function detail(onLocate, busy = false) {
  return context.CompletedTaskDetails({ task: scheduled(["2026-10-29"]), busy, now: 0, onLocate });
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

test("workspace connects the selected task and actual schedule date to the existing timeline locator", () => {
  assert.match(text, /const selectedTaskLocationDate = taskBlockLocationDate\(selectedTask, today\);/);
  assert.match(text, /onLocate=\{selectedTaskLocationDate \? \(\) => onOpenToday\(selectedTaskLocationDate, selectedTask\.id\) : undefined\}/);
  assert.match(text, /onOpenToday=\{\(date = today, taskId\) => requestNavigation\(\{ active: "今日", date, timelineReturnContext: taskId \? \{ date, taskId \} : undefined \}\)\}/);
});
