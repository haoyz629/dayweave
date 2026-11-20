import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { recurringClockRange } from "./recurring-schedule.ts";
import { recycleCleanupMessage } from "./recycle-retention.ts";

const text = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const functions = new Map();
let actions, endDialog, scheduleRows, feedbackToast;
function walk(node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node);
  if (ts.isJsxElement(node)) {
    const opening = node.openingElement.getText(source);
    const contents = node.getText(source);
    if (opening.includes('className="ledger-row-actions"') && contents.includes("setPendingEndRecurringItem(item)")) actions = contents;
    if (opening.includes('className="dialog-backdrop task-trash-backdrop"') && contents.includes('id="end-recurring-item-title"')) endDialog = contents;
  }
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === "Toast" && node.getText(source).includes("title={feedback}")) feedbackToast = node.parent.getText(source);
  ts.forEachChild(node, walk);
}
walk(source);
function findRows(node) {
  if (ts.isJsxElement(node) && node.openingElement.getText(source).includes('className="apple-schedule-rows"')) scheduleRows = node.getText(source);
  ts.forEachChild(node, findRows);
}
findRows(functions.get("RecurringItemEditor"));
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const evaluate = (code, state) => vm.runInNewContext(compile(code), state);
function nodes(node, predicate) {
  if (!React.isValidElement(node)) return [];
  return [...(predicate(node) ? [node] : []), ...React.Children.toArray(node.props.children).flatMap(child => nodes(child, predicate))];
}
const item = { id: "repeat-1", title: "晨间计划", status: "active", deleted_at: null };
function harness(overrides = {}) {
  const writes = [];
  const state = {
    React, Icon: () => null, ConfirmationDialog: ({ children }) => React.createElement("section", null, children), Toast: () => null,
    item, selectedRecurringId: item.id, view: "recurring", busy: false, hasUnsavedChanges: false, pendingEndRecurringItem: null, pendingTrashRecurringItem: null,
    writes, refreshed: 0, feedback: "", uiErrorMessage: String,
    async setRecurringItemStatus(...args) { writes.push(args); if (state.failure) throw Error("数据库忙"); },
    async onRecurringChanged() { state.refreshed++; },
    selectRecurringItem(value) { state.selected = value; }, restoreSelectedRecurringItem() {},
    changeRecurringItemStatus(status, target) { return state.setRecurringItemStatus(target.id, status); },
    ...overrides
  };
  for (const key of ["busy", "pendingEndRecurringItem", "pendingTrashRecurringItem", "feedback", "selectedId", "selectedRecurringId", "pendingPermanentRecurringItem"]) {
    state[`set${key[0].toUpperCase()}${key.slice(1)}`] = value => { state[key] = value; };
  }
  const context = vm.createContext(state);
  vm.runInContext(compile(functions.get("endRecurringItemFromList").getText(source)), context);
  const renderActions = () => vm.runInContext(compile(`(${actions})`), context);
  const renderDialog = () => vm.runInContext(compile(`(${endDialog})`), context);
  return { state, renderActions, renderDialog };
}

test("recurring shortcuts follow lifecycle state, independent of selection", async () => {
  for (const status of ["active", "paused"]) for (const selectedRecurringId of [item.id, null]) {
    const h = harness({ item: { ...item, status }, selectedRecurringId });
    const buttons = nodes(h.renderActions(), node => node.type === "button");
    assert.deepEqual(buttons.map(node => node.props["aria-label"]), status === "active" ? [`暂停${item.title}`] : [`恢复${item.title}`, `结束${item.title}`, `将${item.title}移入回收站`]);
    assert.ok(buttons.every(button => button.props.disabled === false));
    await buttons[0].props.onClick();
    assert.deepEqual(h.state.writes, [[item.id, status === "active" ? "paused" : "active"]]);
    if (status === "paused") {
      buttons[1].props.onClick();
      assert.equal(h.state.pendingEndRecurringItem.id, item.id);
      assert.equal(h.state.writes.length, 1, "ending still requires confirmation");
      buttons[2].props.onClick();
      assert.equal(h.state.pendingTrashRecurringItem.id, item.id);
      assert.equal(h.state.writes.length, 1, "trashing still requires confirmation");
    }
  }
  assert.match(css, /\.task-ledger-row:hover \.ledger-row-actions/);
  assert.match(css, /\.task-ledger-row:has\(:focus-visible\) \.ledger-row-actions/);
});

test("ended capsules expose trash instead of end; recycled capsules keep restore/permanent delete", () => {
  for (const [status, deleted_at, view] of [["ended", null, "recurring"], ["ended", "2026-10-26", "deleted"], ["active", "2026-10-26", "deleted"]]) {
    const h = harness({ item: { ...item, status, deleted_at }, view });
    const buttons = nodes(h.renderActions(), node => node.type === "button");
    assert.equal(buttons.some(node => node.props["aria-label"] === `结束${item.title}`), false);
    const html = renderToStaticMarkup(h.renderActions());
    if (deleted_at) {
      assert.match(html, /恢复晨间计划/);
      assert.match(html, /永久删除晨间计划/);
      assert.doesNotMatch(html, /将晨间计划移入回收站/);
    } else {
      const trash = buttons.find(node => node.props["aria-label"] === `将${item.title}移入回收站`);
      trash.props.onClick();
      assert.equal(h.state.pendingTrashRecurringItem.id, item.id);
    }
  }
});

test("busy or unsaved editor disables all recurring shortcuts", async () => {
  for (const status of ["active", "paused", "ended"]) for (const block of [{ busy: true }, { hasUnsavedChanges: true }]) {
    const h = harness({ item: { ...item, status }, ...block });
    assert.ok(nodes(h.renderActions(), node => node.type === "button").every(button => button.props.disabled));
    if (block.busy) {
      await h.state.endRecurringItemFromList(h.state.item);
      assert.equal(h.state.writes.length, 0);
    }
  }
});

test("end confirmation can cancel without writing and persists only an ended status on confirmation", async () => {
  const h = harness();
  h.state.pendingEndRecurringItem = item;
  const cancel = nodes(h.renderDialog(), node => node.type === "button" && node.props.children === "取消")[0];
  cancel.props.onClick();
  assert.equal(h.state.pendingEndRecurringItem, null);
  assert.equal(h.state.writes.length, 0);
  h.state.pendingEndRecurringItem = item;
  const confirm = nodes(h.renderDialog(), node => node.type === "button" && node.props.children === "结束重复")[0];
  assert.equal(confirm.props.className, "dialog-save");
  confirm.props.onClick();
  // The JSX handler intentionally discards its Promise, so allow its two awaits to settle.
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.state.writes, [[item.id, "ended"]]);
  assert.equal(h.state.refreshed, 1);
  assert.equal(h.state.pendingEndRecurringItem, null);
  assert.equal(h.state.busy, false);
});

test("failed end keeps the confirmation available and preserves its failure message", async () => {
  const h = harness({ failure: true, pendingEndRecurringItem: item });
  await h.state.endRecurringItemFromList(item);
  assert.equal(h.state.pendingEndRecurringItem, item);
  assert.match(h.state.feedback, /重复事项未能结束.*数据库忙/);
  assert.equal(h.state.busy, false);
  assert.equal(h.state.refreshed, 0);
});

test("recurring schedule uses ordinary date/time row classes and all four picker entry points", () => {
  const fields = [];
  const form = { starts_on: "2026-10-01", ends_on: "2026-10-29", display_time: "09:00", display_duration_minutes: 30 };
  const state = { React, Icon: () => null, form, clockRange: recurringClockRange(form), validityPicker: null, disabled: false, pickerDateLabel: value => value, setValidityPicker: value => fields.push(value.activeField) };
  const tree = evaluate(`(${scheduleRows})`, state);
  assert.equal(tree.props.className, "apple-schedule-rows");
  const rows = nodes(tree, node => node.props.className === "apple-schedule-row");
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(nodes(row, node => node.props.className === "apple-schedule-label").length, 1);
    assert.equal(nodes(row, node => node.props.className === "apple-schedule-values").length, 1);
    assert.equal(nodes(row, node => node.type === "button").length, 2);
    for (const button of nodes(row, node => node.type === "button")) button.props.onClick();
  }
  assert.deepEqual(fields, ["start", "time", "end", "duration"]);
  const html = renderToStaticMarkup(tree);
  assert.match(html, /09:00/);
  assert.match(html, /09:30/);
  assert.doesNotMatch(html, /schedule-picker-rows|设置时长/);
  assert.doesNotMatch(css, /\.recurring-editor-surface :is\(\.recurring-inline-label, \.apple-schedule-label\) \{[^}]*width:/);
});

test("recurring date/time rows keep long validity, 24:00 display and busy guards", () => {
  const form = { starts_on: "2026-10-01", ends_on: "", display_time: "23:30", display_duration_minutes: 30 };
  const state = { React, Icon: () => null, form, clockRange: recurringClockRange(form), validityPicker: null, disabled: true, pickerDateLabel: value => value, setValidityPicker() {} };
  const tree = evaluate(`(${scheduleRows})`, state);
  const html = renderToStaticMarkup(tree);
  assert.match(html, /长期有效/);
  assert.match(html, /24:00/);
  assert.equal(nodes(tree, node => node.type === "button" && node.props.disabled).length, 4);
});

test("task filter area has no feedback element or placeholder; feedback is dismissible outside the list", () => {
  const workspace = functions.get("TaskWorkspace").getText(source);
  assert.doesNotMatch(workspace, /workspace-feedback/);
  assert.ok(feedbackToast, "necessary operation feedback must still be available");
  const state = { React, Toast: () => null, feedback: "操作完成", setFeedback(value) { state.feedback = value; } };
  const tree = evaluate(`(${feedbackToast})`, state);
  assert.equal(tree.props.title, state.feedback);
  assert.equal(tree.props.duration, 5000);
  tree.props.onDismiss();
  assert.equal(state.feedback, null);
  assert.equal(evaluate(`(${feedbackToast})`, state), null);
});

function defaultFormHarness() {
  const names = ["shanghaiDateValue", "shanghaiDateTimeFields", "newTaskDefaultForm", "weekdayNumber", "recurringItemDefaultForm", "recurringItemFormForItem", "recurringFormForDraft"];
  const declarations = names.map(name => functions.get(name).getText(source));
  return evaluate(`${declarations.join("\n")}\n({ newTaskDefaultForm, recurringItemDefaultForm, recurringItemFormForItem, recurringFormForDraft });`, {});
}

test("new recurring tasks prefill the ordinary task's recommended one-hour time at every hour", () => {
  const defaults = defaultFormHarness();
  for (const date of ["2026-10-23", "2026-12-31", "2028-02-29"]) for (let hour = 0; hour < 24; hour++) {
    const now = new Date(`${date}T${String(hour).padStart(2, "0")}:37:00+08:00`);
    const ordinary = defaults.newTaskDefaultForm(now);
    const recurring = defaults.recurringItemDefaultForm(date, now);
    assert.equal(recurring.display_time, ordinary.earliest_start_time, `${date}/${hour}`);
    assert.equal(recurring.display_duration_minutes, 60);
    assert.equal(recurringClockRange(recurring).end, ordinary.due_time);
    assert.equal(recurring.starts_on, date, "recurrence start date must not change with the time recommendation");
    assert.equal(recurring.ends_on, "");
    assert.equal(recurring.frequency, "weekly");
    assert.equal(recurring.month_day, Number(date.slice(8, 10)));
    assert.deepEqual(Array.from(recurring.weekdays), [new Date(`${date}T00:00:00+08:00`).getDay() || 7]);
  }
});

test("recurring defaults do not overwrite saved item or draft times, including incomplete schedules", () => {
  const defaults = defaultFormHarness();
  for (const [display_time, display_duration_minutes] of [["14:35", 25], ["23:30", 30], [null, null], ["", null]]) {
    const saved = { ...defaults.recurringItemDefaultForm("2026-10-23"), title: "保留时间", notes: null, display_time, display_duration_minutes };
    const edited = defaults.recurringItemFormForItem(saved);
    const restored = defaults.recurringFormForDraft({ title: saved.title, notes: null, tags: [], recurring_settings: saved }, "2026-10-23");
    for (const form of [edited, restored]) {
      assert.equal(form.display_time, display_time ?? "");
      assert.equal(form.display_duration_minutes, display_duration_minutes);
    }
  }
  const incomplete = defaults.recurringFormForDraft({ title: "未填时间的草稿", tags: [], recurring_settings: null }, "2026-10-23");
  assert.equal(incomplete.display_time, "");
  assert.equal(incomplete.display_duration_minutes, null);
});

test("recurring pages reuse the ordinary header with lifecycle status icons", () => {
  const state = {
    React, Icon: ({ name }) => React.createElement("svg", { "data-icon": name }),
    TaskTagList: () => null, TaskDetailResources: () => React.createElement("div", { className: "resources" }),
  };
  const names = ["recurringItemStatusLabel", "recurringScheduleLabel", "TaskPageHeader", "TaskDetailHero", "RecurringDetailFacts", "DeletedRecurringItemDetails", "EndedRecurringItemDetails"];
  Object.assign(state, evaluate(`${names.map(name => functions.get(name).getText(source)).join("\n")}\n({ ${names.join(",")} });`, state));
  for (const [status, label, icon] of [["active", "生效中", "clock"], ["paused", "已暂停", "pause"], ["ended", "已结束", "check"], ["deleted", "回收站", "trash"]]) {
    const task = { ...item, frequency: "weekly", status: status === "deleted" ? "ended" : status, deleted_at: status === "deleted" ? "2026-10-27" : null };
    const html = renderToStaticMarkup(state.TaskPageHeader({ task, editing: !["ended", "deleted"].includes(status) }));
    assert.match(html, /task-compact-header task-page-header/);
    assert.match(html, new RegExp(`data-icon="${icon}"`));
    assert.match(html, new RegExp(`${label}</span>`));
    assert.match(html, status === "deleted" ? /回收站<\/span>/ : /任务<\/span>/);
    assert.doesNotMatch(html, /task-compact-source|·重复事项/);
  }
  for (const name of ["DeletedRecurringItemDetails", "EndedRecurringItemDetails"]) {
    const component = functions.get(name).getText(source);
    assert.match(component, /<TaskDetailHero/);
    assert.match(component, /<TaskDetailResources key=\{item.id\} notes=\{item.notes\}/);
    assert.match(component, /ordinary-task-detail/);
  }
  assert.match(functions.get("RecurringItemEditor").getText(source), /TaskNotesInputs[^\n]*icons/);
});

test("ordinary notes consume spare height without changing planning controls", () => {
  assert.match(css, /:is\(#new-task-form, #task-editor-form\) \.task-notes-region \{ flex: 1 0 150px; height: auto; \}/);
  assert.match(css, /#recurring-editor-form \.recurring-editor-surface \{ gap: 24px; \}/);
});

test("recycled recurring details share ordinary bottom actions without a pinned banner", () => {
  const state = {
    React, recycleCleanupMessage,
    Icon: ({ name }) => React.createElement("svg", { "data-icon": name }),
    TaskPageHeader: () => React.createElement("nav", { className: "task-page-header" }),
    TaskTagList: ({ tags }) => React.createElement("span", { className: "task-list-tags" }, tags.join("、")),
    TaskDetailResources: ({ notes }) => React.createElement("section", { className: "task-detail-resources" }, notes),
    RecurringExecutionHistory: () => React.createElement("section", { "aria-label": "执行记录" }),
    SeparatedCopy: ({ text }) => text
  };
  const names = ["recurringScheduleLabel", "TaskDetailHero", "RecurringDetailFacts", "RecycleBinActions", "DeletedRecurringItemDetails"];
  Object.assign(state, evaluate(`${names.map(name => functions.get(name).getText(source)).join("\n")}\n({ ${names.join(",")} });`, state));
  const deleted = { ...item, status: "ended", deleted_at: "2026-10-26T18:00:00+08:00", frequency: "weekly", interval_value: 1, weekdays: [2, 4], starts_on: "2026-10-01", ends_on: null, display_time: "14:00", display_duration_minutes: 60, tags: ["开发", "产品"], notes: "保留的备注" };
  const calls = [];
  for (const busy of [false, true]) {
    const actions = state.RecycleBinActions({ deletedAt: deleted.deleted_at, nowMs: Date.parse("2026-10-27T10:00:00+08:00"), itemLabel: "重复事项", busy, onRestore: () => calls.push("restore"), onPermanentDelete: () => calls.push("delete") });
    const buttons = nodes(actions, node => node.type === "button");
    assert.equal(buttons.length, 2);
    assert.ok(buttons.every(node => node.props.disabled === busy));
    if (!busy) buttons.forEach(button => button.props.onClick());
    const html = renderToStaticMarkup(state.DeletedRecurringItemDetails({ item: deleted, busy, children: actions }));
    assert.match(html, /ordinary-task-detail recycled-task-detail/);
    assert.match(html, /aria-label="回收站重复事项详情"><div class="detail-fused-header">/);
    assert.match(html, /<footer class="task-detail-actions">[\s\S]*<section class="task-detail-resources">保留的备注<\/section>/);
    assert.doesNotMatch(html, /该重复事项已结束并移入回收站/);
    for (const label of ["重复规则", "有效日期", "今日页显示", "显示时长"]) assert.ok(html.includes(label));
    assert.equal((html.match(/<dt><svg/g) ?? []).length, 4);
    assert.match(html, /60<span class="task-detail-unit">分钟<\/span>/);
    assert.match(html, /开发、产品/);
    assert.match(html, /保留的备注/);
    assert.match(html, /恢复重复事项/);
    assert.match(html, /永久删除/);
    assert.ok(html.includes(recycleCleanupMessage(deleted.deleted_at, Date.parse("2026-10-27T10:00:00+08:00"))));
    assert.doesNotMatch(html, /recycle-bin-banner|最早开始|预计工作量/);
    assert.match(html, /aria-label="执行记录"/);
  }
  assert.deepEqual(calls, ["restore", "delete"]);
  assert.doesNotMatch(css, /\.recycled-task-detail > \.recycle-bin-banner|:has\(\.recycled-task-detail\)/);
  assert.match(functions.get("DeletedTaskDetails").getText(source), /<RecycleBinActions deletedAt=\{task.deleted_at\}/);
});

test("recurring selection and back navigation protect edits, and discard returns to saved details", async () => {
  const baseline = { title: "已保存" };
  const state = { busy: false, draftSaving: false, creating: false, hasUnsavedChanges: true,
    selectedTask: null, selectedRecurringItem: item, selectedRecurringId: item.id, recurringDetailEditing: true,
    recurringForm: { title: "未保存" }, recurringEditBaseline: baseline, pendingTaskChange: null };
  for (const key of ["feedback", "selectedId", "selectedRecurringId", "recurringForm", "recurringDetailEditing", "pendingTaskChange"]) {
    state[`set${key[0].toUpperCase()}${key.slice(1)}`] = value => { state[key] = value; };
  }
  evaluate(["cancelRecurringEditing", "applyTaskChange", "requestTaskChange", "resolvePendingChange", "selectRecurringItem", "discardAndContinue"].map(name => functions.get(name).getText(source)).join("\n"), state);
  await state.selectRecurringItem({ id: "other" });
  assert.equal(state.selectedRecurringId, item.id);
  assert.equal(state.pendingTaskChange.kind, "select-recurring");
  state.resolvePendingChange(false);
  assert.equal(state.recurringForm.title, "未保存");
  assert.equal(state.recurringDetailEditing, true);
  await state.requestTaskChange({ kind: "recurring-detail" });
  assert.equal(state.recurringDetailEditing, true);
  await state.discardAndContinue();
  assert.equal(state.recurringForm, baseline);
  assert.equal(state.recurringDetailEditing, false);
  assert.equal(state.pendingTaskChange, null);
  state.hasUnsavedChanges = false;
  await state.selectRecurringItem({ id: "other" });
  assert.equal(state.selectedRecurringId, "other");
  assert.equal(state.selectedId, null);
});

test("recurring status shortcuts change the clicked series, guard unsaved edits and preserve failures", async () => {
  const writes = [];
  const state = { busy: false, hasUnsavedChanges: false, selectedRecurringItem: item, uiErrorMessage: String,
    async setRecurringItemStatus(...args) { writes.push(args); if (state.fail) throw Error("数据库忙"); },
    async onRecurringChanged() {} };
  for (const key of ["busy", "feedback"]) state[`set${key[0].toUpperCase()}${key.slice(1)}`] = value => { state[key] = value; };
  evaluate(functions.get("changeRecurringItemStatus").getText(source), state);
  await state.changeRecurringItemStatus("paused", { id: "other" });
  assert.deepEqual(writes, [["other", "paused"]]);
  state.hasUnsavedChanges = true;
  await state.changeRecurringItemStatus("active");
  assert.equal(writes.length, 1);
  state.hasUnsavedChanges = false; state.fail = true;
  await state.changeRecurringItemStatus("active");
  assert.match(state.feedback, /状态未改变.*数据库忙/);
  assert.equal(state.busy, false);
});

test("active and paused details show saved facts and history with an explicit edit entry", () => {
  const calls = [];
  const state = { React, Icon: () => null, SeparatedCopy: ({ text }) => text,
    TaskPageHeader: () => null, TaskTagList: () => null, TaskDetailResources: ({ notes }) => notes,
    RecurringExecutionHistory: () => React.createElement("section", { "aria-label": "执行记录" }) };
  evaluate(["recurringScheduleLabel", "TaskDetailHero", "RecurringDetailFacts", "RecurringItemDetails"].map(name => functions.get(name).getText(source)).join("\n"), state);
  for (const status of ["active", "paused"]) {
    const detail = state.RecurringItemDetails({ item: { ...item, status, frequency: "daily", interval_value: 1, starts_on: "2026-10-01", tags: [], notes: "已保存备注" }, busy: false,
      onEdit: () => calls.push("edit"), onPause() {}, onResume() {}, onEnd() {} });
    const html = renderToStaticMarkup(detail);
    for (const label of ["重复事项只读详情", "重复规则", "有效日期", "今日页显示", "显示时长", "已保存备注", "执行记录"]) assert.ok(html.includes(label));
    assert.doesNotMatch(html, /<input|<textarea|recurring-editor-form/);
    const buttons = nodes(nodes(detail, node => node.type === state.TaskDetailHero)[0].props.actions, node => node.type === "button");
    assert.deepEqual(buttons.map(button => renderToStaticMarkup(button).replace(/<[^>]*>/g, "")), status === "active" ? ["暂停事项", "编辑任务"] : ["恢复事项", "编辑任务", "结束事项"]);
    buttons[1].props.onClick();
    assert.equal(buttons.length, status === "active" ? 2 : 3);
  }
  assert.deepEqual(calls, ["edit", "edit"]);
});

test("recurring frequency selector uses custom button dropdown without native double arrows", () => {
  const calls = [];
  const state = { React, Icon: ({ name }) => React.createElement("svg", { "data-icon": name }), recurringFrequencyOptions: [{ value: "daily", label: "每天" }, { value: "weekly", label: "每周" }, { value: "monthly", label: "每月" }], useState: () => [true, () => {}], useRef: (v) => ({ current: v }), useEffect: () => {} };
  evaluate(functions.get("RecurringFrequencyDropdown").getText(source), state);
  const tree = state.RecurringFrequencyDropdown({ id: "new-recurring-frequency", value: "monthly", onChange: (val) => calls.push(val) });
  const html = renderToStaticMarkup(tree);
  assert.doesNotMatch(html, /<select/);
  assert.match(html, /aria-label="频率：每月"/);
  assert.equal((html.match(/data-icon="chevron-down"/g) || []).length, 1);
  const options = nodes(tree, (node) => node.type === "button" && node.props.role === "option");
  assert.deepEqual(options.map((node) => String(node.key).replace(/^\.\$/, "")), ["daily", "weekly", "monthly"]);
  assert.equal(options[2].props["aria-selected"], true);
  options[0].props.onClick();
  assert.deepEqual(calls, ["daily"]);
});
