import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getHolidayCalendarSnapshot, holidayYearMessage, missingHolidayYears } from "./official-holiday-calendar.ts";

const text = readFileSync(new URL("./holiday-calendar-status.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("status.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const definitions = source.statements.filter(ts.isFunctionDeclaration).map(node => node.getText(source).replace(/^export /, "")).join("\n");
const snapshot = structuredClone(getHolidayCalendarSnapshot());
function harness(next = snapshot) {
  const calls = [];
  const state = { React, useState: React.useState, useRef: React.useRef, useEffect: React.useEffect,
    useHolidayCalendar: () => next, holidayYearMessage, missingHolidayYears,
    requestHolidayUpdate: async (...args) => calls.push(args) };
  const context = vm.createContext(state);
  vm.runInContext(ts.transpileModule(definitions, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, context);
  return { context, calls };
}

test("actual holiday settings show coverage and offline/privacy boundaries without a task-save button", () => {
  const { context } = harness();
  const html = renderToStaticMarkup(React.createElement(context.HolidayCalendarSettings));
  assert.match(html, /已覆盖 2026 年/);
  assert.match(html, /尚未成功检查/);
  assert.match(html, /检查节假日更新/);
  assert.match(html, /离线使用/);
  assert.match(html, /不上传任务/);
  assert.match(html, /NateScarlet\/holiday-cn/);
  assert.match(html, /jsDelivr/);
  assert.match(html, /第三方整理数据/);
  assert.doesNotMatch(html, /type="submit"|自动重排/);
});

test("failure and busy states retain known-year coverage", () => {
  const failed = harness({ ...snapshot, lastError: "测试超时" });
  assert.match(renderToStaticMarkup(React.createElement(failed.context.HolidayCalendarSettings)), /测试超时/);
  const busy = harness({ ...snapshot, checking: true });
  const html = renderToStaticMarkup(React.createElement(busy.context.HolidayCalendarSettings));
  assert.match(html, /disabled=""/);
  assert.match(html, /正在检查/);
  assert.match(html, /已覆盖 2026 年/);
});

test("actual missing-year component distinguishes unavailable and uncollected data", () => {
  const missing = harness();
  const props = { from: "2027-01-01" };
  assert.match(renderToStaticMarkup(React.createElement(missing.context.HolidayCoverageNotice, props)), /暂未取得 2027 年/);
  const uncollected = harness({ ...snapshot, lastSuccessAt: "2026-11-10T00:00:00Z" });
  assert.match(renderToStaticMarkup(React.createElement(uncollected.context.HolidayCoverageNotice, props)), /尚未收录/);
  assert.equal(renderToStaticMarkup(React.createElement(missing.context.HolidayCoverageNotice, { from: "2026-10-01" })), "");
});

test("application hooks refresh projections without clearing plan previews or moving tasks", () => {
  const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  const effect = app.slice(app.indexOf("if (previousHolidayRevision.current === holidayRevision)"), app.indexOf("}, [holidayRevision])"));
  assert.match(effect, /listRecurringOccurrences\(date\)/);
  assert.doesNotMatch(effect, /setPlanPreview|setMessage|updatePlanBlockTime|confirmRuleBasedPlan|includePlanTask/);
  assert.doesNotMatch(app, /节气仍可显示|OFFICIAL_HOLIDAY_COVERAGE/);
});
