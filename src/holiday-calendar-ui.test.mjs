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
    useHolidayCalendar: () => next, getHolidayCalendarSnapshot: () => next, holidayYearMessage, missingHolidayYears,
    requestHolidayUpdate: async (...args) => calls.push(args) };
  const context = vm.createContext(state);
  vm.runInContext(ts.transpileModule(definitions, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, context);
  return { context, calls };
}

test("holiday details retain scheduling rules without implementation copy", () => {
  const { context } = harness();
  const html = renderToStaticMarkup(React.createElement(context.HolidayCalendarSettings));
  assert.match(html, /已覆盖 2026 年/);
  assert.match(html, /尚未成功检查/);
  assert.match(html, /检查节假日更新/);
  assert.match(html, /离线使用/);
  assert.match(html, /缺失年份不显示法定休\/班标记，也不推测调休/);
  assert.match(html, /法定工作日重复事项待对应年份补齐后恢复推演/);
  assert.match(html, /以国务院公告为准/);
  assert.match(html, /更新不影响已有任务和执行记录/);
  assert.doesNotMatch(html, /jsDelivr|NateScarlet|至少 24 小时|个人设置/);
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

test("manual holiday results use the transient channel and report the latest failure", async () => {
  const component = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "HolidayCalendarSettings");
  const check = component.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "check");
  for (const error of [null, "节假日更新未完成：测试超时"]) {
    const results = [], inline = [];
    const state = {
      savingRef: { current: false }, snapshot: { checking: false, lastError: null },
      setManualBusy(value) { state.busy = value; }, setMessage(value) { inline.push(value); },
      async requestHolidayUpdate(years, force) { assert.equal(years.length, 0); assert.equal(force, true); },
      getHolidayCalendarSnapshot: () => ({ lastError: error }), onResult: (...args) => results.push(args)
    };
    vm.runInNewContext(ts.transpileModule(check.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, state);
    await state.check();
    assert.deepEqual(results, [[error || "检查完成，已有任务和执行记录不受节假日更新影响。", Boolean(error)]]);
    assert.deepEqual(inline, [""]);
    assert.equal(state.busy, false);
    assert.equal(state.savingRef.current, false);
  }
  const failed = harness({ ...snapshot, lastError: "测试超时" });
  const html = renderToStaticMarkup(React.createElement(failed.context.HolidayCalendarSettings, { compact: true, onResult() {} }));
  assert.doesNotMatch(html, /测试超时|role="status"/);
});
