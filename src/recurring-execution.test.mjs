import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { canCaptureRecurringResult } from "./review-workflow.ts";
import { recurringTimeRange } from "./recurring-schedule.ts";
import { weekEntries } from "./week-timeline-model.ts";

const text = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map();
const quickChecks = [];
function collect(node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(source));
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "button" && node.getText(source).includes("saveRecurringResult(item,")) quickChecks.push(node.getText(source));
  ts.forEachChild(node, collect);
}
collect(source);
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));
function elements(node, predicate) {
  if (!React.isValidElement(node)) return [];
  return [...(predicate(node) ? [node] : []), ...React.Children.toArray(node.props.children).flatMap(child => elements(child, predicate))];
}
const byClass = (tree, name) => elements(tree, node => node.props.className?.split(" ").includes(name));
const occurrence = { id: "occ-1", recurring_item_id: "series-1", occurrence_date: "2026-10-29", title: "运动", display_time: "09:00", display_duration_minutes: 30, notes: null, tags: [], outcome: null, review_notes: null };
function mount(name, initialProps, overrides = {}) {
  const slots = [], effects = [], cleanup = [];
  let cursor = 0, props = initialProps;
  const state = {
    React, Icon: () => null, recurringTimeRange, uiErrorMessage: String,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useEffect(fn, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index][i]))) {
        slots[index] = deps;
        effects.push(() => { cleanup[index]?.(); cleanup[index] = fn(); });
      }
    },
    ...overrides
  };
  vm.runInNewContext(compile(functions.get(name)), state);
  return {
    state,
    render(next = props) {
      props = next;
      let tree;
      for (let pass = 0; pass < 2; pass++) { cursor = 0; tree = state[name](props); effects.splice(0).forEach(fn => fn()); }
      return tree;
    },
    unmount() { cleanup.forEach(fn => fn?.()); }
  };
}
function savingHarness(overrides = {}) {
  const writes = [], notices = [], refreshes = [];
  const state = {
    recurringItems: [{ id: "series-1", deleted_at: null, status: "active" }], shanghaiDateValue: () => "2026-10-29", canCaptureRecurringResult,
    recurringResultSavingRef: { current: false }, quickCompletingBlockId: null, savingExecution: false, busy: false, loading: false,
    preview: null, savingDraggedBlock: false, timelineDrag: null, savingRecurringChange: false, pendingRecurringChange: null,
    setQuickCompletingBlockId(value) { state.quickCompletingBlockId = value; },
    async saveRecurringOccurrenceReview(...args) { writes.push(["save", ...args]); },
    async clearRecurringOccurrenceReview(...args) { writes.push(["clear", ...args]); },
    async latestUndo() { return null; },
    async onFactsChanged(date) { refreshes.push(date); }, onNotify(...args) { notices.push(args); }, uiErrorMessage: String,
    ...overrides
  };
  vm.runInNewContext(compile(["canRecordRecurringOccurrence", "saveRecurringResult"].map(name => functions.get(name)).join("\n")), state);
  return { state, writes, notices, refreshes };
}

test("recurring permission mirrors existing historical first-write, future and recycle rules", () => {
  const h = savingHarness();
  assert.equal(h.state.canRecordRecurringOccurrence(occurrence), true);
  assert.equal(h.state.canRecordRecurringOccurrence({ ...occurrence, occurrence_date: "2026-10-28" }), true);
  for (const changes of [{ occurrence_date: "2026-10-30" }, { occurrence_date: "2026-10-22" }, { occurrence_date: "2026-10-28", outcome: "completed" }, { occurrence_date: "2026-10-28", outcome: "partial" }, { recurring_item_id: "unknown" }]) assert.equal(h.state.canRecordRecurringOccurrence({ ...occurrence, ...changes }), false);
  h.state.recurringItems[0].status = "ended";
  assert.equal(h.state.canRecordRecurringOccurrence(occurrence), true, "today remains recordable after ending, as in the backend");
  h.state.recurringItems[0].deleted_at = "2026-10-29";
  assert.equal(h.state.canRecordRecurringOccurrence(occurrence), true, "recycled recurring items remain recordable");
});

test("same-day distinct IDs and multiple dates save only that occurrence and refresh its own date", async () => {
  const h = savingHarness();
  await h.state.saveRecurringResult(occurrence, "completed", "慢跑");
  await h.state.saveRecurringResult({ ...occurrence, id: "moved-2" }, "completed", null);
  await h.state.saveRecurringResult({ ...occurrence, id: "yesterday", occurrence_date: "2026-10-28" }, "completed", null);
  assert.deepEqual(h.writes.map(write => [write[0], write[1], write[2].outcome, write[2].notes]), [["save", "occ-1", "completed", "慢跑"], ["save", "moved-2", "completed", null], ["save", "yesterday", "completed", null]]);
  assert.deepEqual(h.refreshes, ["2026-10-29", "2026-10-29", "2026-10-28"]);
  await h.state.saveRecurringResult({ ...occurrence, outcome: "completed" }, null, null);
  assert.deepEqual(h.writes.at(-1), ["clear", "occ-1", null]);
  await h.state.saveRecurringResult(occurrence, "completed", null);
  assert.equal(h.writes.at(-1)[0], "save");
});

test("rapid repeat requests share a synchronous lock, including a second click before React renders", async () => {
  let release;
  const writes = [];
  const h = savingHarness({ async saveRecurringOccurrenceReview(id) { writes.push(id); await new Promise(resolve => { release = resolve; }); } });
  const pending = h.state.saveRecurringResult(occurrence, "completed", null);
  h.state.quickCompletingBlockId = null;
  await h.state.saveRecurringResult(occurrence, "completed", null);
  await h.state.saveRecurringResult({ ...occurrence, id: "second" }, "completed", null);
  assert.deepEqual(writes, ["occ-1"]);
  release(); await pending;
  assert.equal(h.state.recurringResultSavingRef.current, false);
  assert.equal(h.state.quickCompletingBlockId, null);
});

test("busy, plan editing, dragging and immutable results never write; save failures release the lock", async () => {
  for (const changes of [{ busy: true }, { loading: true }, { preview: {} }, { savingExecution: true }, { savingDraggedBlock: true }, { timelineDrag: {} }, { savingRecurringChange: true }, { pendingRecurringChange: {} }]) {
    const h = savingHarness(changes);
    await h.state.saveRecurringResult(occurrence, "completed", null);
    assert.equal(h.writes.length, 0);
  }
  const failed = savingHarness({ async saveRecurringOccurrenceReview() { throw Error("数据库忙"); } });
  await failed.state.saveRecurringResult(occurrence, "completed", "保留输入");
  assert.match(failed.notices[0][0], /本次结果未保存/);
  assert.match(failed.notices[0][1], /数据库忙/);
  assert.equal(failed.state.recurringResultSavingRef.current, false);
  assert.equal(failed.refreshes.length, 0);

  let undoReads = 0;
  const completed = savingHarness({ async latestUndo() { return ++undoReads === 1 ? { id: "old", target_type: "recurring_review", target_id: "other" } : { id: "new", target_type: "recurring_review", target_id: occurrence.id }; } });
  await completed.state.saveRecurringResult(occurrence, "completed", null);
  assert.equal(completed.notices[0][0], "本次已完成");
  assert.equal(completed.notices[0][3], "new", "the success toast receives only this occurrence's newly-created undo");

  let unchangedReads = 0;
  const unchanged = savingHarness({ async latestUndo() { unchangedReads++; return { id: "existing", target_type: "recurring_review", target_id: occurrence.id }; } });
  await unchanged.state.saveRecurringResult(occurrence, "completed", null);
  assert.equal(unchanged.notices[0][3], undefined, "an existing undo is not mistaken for a new operation");
  const wrongTarget = savingHarness({ async latestUndo() { return { id: "new", target_type: "recurring_review", target_id: "another-occurrence" }; } });
  await wrongTarget.state.saveRecurringResult(occurrence, "completed", null);
  assert.equal(wrongTarget.notices[0][3], undefined, "same-day occurrences remain isolated by ID");

  let refreshUndoReads = 0;
  const refreshFailed = savingHarness({
    async latestUndo() { return ++refreshUndoReads === 1 ? null : { id: "new", target_type: "recurring_review", target_id: occurrence.id }; },
    async onFactsChanged() { throw Error("刷新失败"); }
  });
  await refreshFailed.state.saveRecurringResult(occurrence, "completed", null);
  assert.equal(refreshFailed.writes.length, 1);
  assert.match(refreshFailed.notices[0][0], /结果已保存/);
  assert.equal(refreshFailed.notices[0][3], undefined, "refresh errors do not attach an undo action to a different toast");
});

test("timed and untimed checks show every saved result and cancel it before completing again", () => {
  assert.equal(quickChecks.length, 2);
  for (const code of quickChecks) for (const outcome of [null, "completed", "not_completed", "partial"]) {
    const calls = [];
    const item = { ...occurrence, outcome, review_notes: "原备注" };
    const state = { React, item, quickCompletingBlockId: null, busy: false, loading: false, savingExecution: false, savingRecurringChange: false, preview: null, savingDraggedBlock: false, timelineDrag: null, pendingRecurringChange: null, canRecordRecurringOccurrence: () => true, Icon: () => null, saveRecurringResult: (...args) => calls.push(args) };
    const render = () => vm.runInNewContext(compile(`(${code})`), state);
    const tree = render();
    assert.equal(tree.props["aria-pressed"], Boolean(outcome));
    assert.equal(tree.props.className.includes(" done"), outcome === "completed");
    assert.equal(tree.props.className.includes(" recorded"), Boolean(outcome && outcome !== "completed"));
    const action = outcome === "completed" ? "取消本次完成" : outcome === "not_completed" ? "取消本次未完成" : outcome === "partial" ? "取消本次部分完成" : "标记本次完成";
    assert.equal(tree.props["aria-label"], `${action}：${item.title}`);
    assert.equal(tree.props.disabled, false);
    assert.equal(calls.length, 0);
    let stopped = false;
    tree.props.onClick({ stopPropagation() { stopped = true; } });
    assert.equal(stopped, true);
    assert.equal(calls[0][0].id, item.id);
    assert.equal(calls[0][1], outcome ? null : "completed");
    assert.equal(calls[0][2], "原备注");
    if (outcome) {
      item.outcome = null;
      render().props.onClick({ stopPropagation() {} });
      assert.equal(calls[1][1], "completed");
      assert.equal(calls[1][2], "原备注");
    }
    state.quickCompletingBlockId = item.id;
    assert.equal(render().props.disabled, true);
    assert.match(render().props.className, / saving/);
    state.quickCompletingBlockId = null;
    state.canRecordRecurringOccurrence = () => false;
    assert.equal(render().props.disabled, true);
  }
});

test("result editor keeps saved state separate, accepts optional notes, and clears only after explicit save", () => {
  const writes = [];
  const props = { occurrence, writable: true, disabled: false, onCancel() {}, async onSave(...args) { writes.push(args); } };
  const h = mount("RecurringOccurrenceResult", props);
  assert.deepEqual(React.Children.toArray(h.render().props.children).map(node => node.type), ["section", "footer"], "footer stays a direct panel child so the existing capture-footer styling applies");
  const save = () => elements(h.render(), node => node.props.className === "primary-action")[0];
  assert.equal(save().props.disabled, true);
  save().props.onClick();
  assert.deepEqual(writes, []);
  const initialToggle = () => elements(h.render(), node => node.props["data-outcome"] === "completed")[0];
  initialToggle().props.onClick();
  assert.equal(save().props.disabled, false);
  initialToggle().props.onClick();
  assert.equal(save().props.disabled, true);
  assert.doesNotMatch(renderToStaticMarkup(h.render()), /<svg/);
  const toggle = () => elements(h.render(), node => node.props["data-outcome"] === "completed")[0];
  toggle().props.onClick();
  assert.equal(toggle().props["aria-pressed"], true);
  assert.equal(occurrence.outcome, null);
  elements(h.render(), node => node.type === "textarea")[0].props.onChange({ target: { value: "  慢跑 30 分钟  " } });
  assert.doesNotMatch(renderToStaticMarkup(h.render()), /<svg/);
  assert.equal(writes.length, 0);
  const timePage = h.render({ ...props, hidden: true });
  assert.equal(elements(timePage, node => node.type === "section")[0].props.hidden, true);
  assert.equal(elements(timePage, node => node.type === "footer")[0].props.hidden, true);
  assert.equal(elements(h.render(props), node => node.type === "textarea")[0].props.value, "  慢跑 30 分钟  ", "switching to time and back keeps unsaved result input");
  save().props.onClick();
  assert.deepEqual(writes, [["completed", "慢跑 30 分钟"]]);
  h.render({ ...props, occurrence: { ...occurrence, outcome: "completed", review_notes: "慢跑 30 分钟" } });
  assert.equal(save().props.disabled, true);
  toggle().props.onClick(); save().props.onClick();
  assert.deepEqual(writes.at(-1), [null, "慢跑 30 分钟"], "note-only save keeps the note without an outcome");
  const readonly = h.render({ ...props, writable: false });
  assert.equal(elements(readonly, node => node.type === "textarea" || node.props.className === "primary-action").length, 0);
  assert.equal(elements(readonly, node => node.props.className === "quiet-button").length, 1);
  assert.doesNotMatch(renderToStaticMarkup(readonly), /整体完成|整个任务/);
});

test("recurring result saves require a meaningful change and respect busy state", () => {
  for (const outcome of [null, "completed", "partial", "not_completed"]) {
    const writes = [];
    const props = { occurrence: { ...occurrence, outcome, review_notes: " 原备注 " }, writable: true, disabled: false, onCancel() {}, async onSave(...args) { writes.push(args); } };
    const h = mount("RecurringOccurrenceResult", props);
    const save = () => elements(h.render(), node => node.props.className === "primary-action")[0];
    const note = () => elements(h.render(), node => node.type === "textarea")[0];
    assert.equal(save().props.disabled, true);
    note().props.onChange({ target: { value: "原备注" } });
    assert.equal(save().props.disabled, true);
    save().props.onClick();
    assert.deepEqual(writes, []);
    note().props.onChange({ target: { value: "新备注" } });
    assert.equal(save().props.disabled, false);
    h.render({ ...props, disabled: true });
    assert.equal(save().props.disabled, true);
    save().props.onClick();
    assert.deepEqual(writes, []);
    h.render(props);
    note().props.onChange({ target: { value: "  原备注  " } });
    assert.equal(save().props.disabled, true);
    save().props.onClick();
    assert.deepEqual(writes, []);
  }
});

test("execution history groups occurrence dates, preserves repeated events and distinguishes same-day blocks", async () => {
  const events = [
    { ...occurrence, id: "e1", occurrence_id: "occ-1", occurrence_date: "2026-10-28", outcome: "completed", notes: "<script>safe</script>", occurred_at: "2026-10-29T10:00:00+08:00" },
    { ...occurrence, id: "e2", occurrence_id: "occ-1", outcome: "completed", notes: null, occurred_at: "2026-10-29T10:01:00+08:00" },
    { ...occurrence, id: "e3", occurrence_id: "occ-1", outcome: null, notes: null, occurred_at: "2026-10-29T10:01:00+08:00" },
    { ...occurrence, id: "e4", occurrence_id: "occ-1", outcome: "completed", notes: null, occurred_at: "2026-10-29T10:01:00+08:00" },
    { ...occurrence, id: "e5", occurrence_id: "moved-2", display_time: "11:00", outcome: "completed", notes: null, occurred_at: "2026-10-29T11:01:00+08:00" }
  ];
  const calls = [];
  const h = mount("RecurringExecutionHistory", { itemId: "series-1", createdAt: "2026-10-01T00:00:00+08:00" }, { async listRecurringExecutionHistory(id) { calls.push(id); return events; } });
  assert.match(renderToStaticMarkup(h.render()), /正在加载/);
  await tick();
  const tree = h.render();
  const disclosure = byClass(tree, "task-detail-history-group")[0];
  assert.equal(disclosure.type, "details");
  assert.equal(disclosure.key, ".$series-1");
  assert.equal(disclosure.props.open, true);
  assert.match(renderToStaticMarkup(disclosure.props.children[0]), /执行记录.*6 条动态/);
  const groups = byClass(tree, "task-detail-history");
  assert.equal(groups.length, 3);
  assert.deepEqual(groups.map(group => group.props.open), [true, false, false]);
  assert.equal(React.Children.toArray(disclosure.props.children).filter(child => child.type === "details").length, 3);
  assert.equal(groups[0].props.children[0].props.children[1].props.children, "2026-10-29");
  assert.equal(groups[1].props.children[0].props.children[1].props.children, "2026-10-28");
  assert.equal(groups[2].props.children[0].props.children[1].props.children, "2026-10-01");
  const rows = byClass(tree, "task-detail-event");
  assert.deepEqual(rows.slice(0, 4).map(row => row.props["data-status"]), ["done", "cleared", "done", "done"]);
  assert.deepEqual(rows.slice(0, 4).map(row => row.props["data-occurrence-id"]), ["occ-1", "occ-1", "occ-1", "moved-2"]);
  assert.equal(rows.at(-1).props["data-status"], "created");
  const html = renderToStaticMarkup(tree);
  assert.doesNotMatch(html, /11:00–11:30|09:00–09:30/);
  assert.match(html, /本次已完成/);
  assert.match(html, /6 条动态/);
  assert.match(html, /2026\/10\/29 10:00:00/);
  assert.match(html, /&lt;script&gt;safe&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.deepEqual(calls, ["series-1"]);
});

test("history loading ignores stale series responses and exposes retry without discarding saved facts", async () => {
  let release;
  const h = mount("RecurringExecutionHistory", { itemId: "old", createdAt: "2026-10-01T00:00:00+08:00" }, { listRecurringExecutionHistory: id => id === "old" ? new Promise(resolve => { release = resolve; }) : Promise.resolve([]) });
  h.render(); h.render({ itemId: "new", createdAt: "2026-10-01T00:00:00+08:00" });
  await tick(); release([{ ...occurrence, id: "stale" }]); await tick();
  assert.equal(byClass(h.render(), "task-detail-event").length, 1, "only the persistent creation record remains after switching items");
  assert.doesNotMatch(renderToStaticMarkup(h.render()), /stale/);
  let failed = true;
  const retry = mount("RecurringExecutionHistory", { itemId: "series-1", createdAt: "2026-10-01T00:00:00+08:00" }, { async listRecurringExecutionHistory() { if (failed) throw Error("离线"); return []; } });
  retry.render(); await tick();
  assert.match(renderToStaticMarkup(retry.render()), /执行记录未载入.*离线/);
  failed = false;
  elements(retry.render(), node => node.type === "button")[0].props.onClick(); retry.render(); await tick();
  const emptyHtml = renderToStaticMarkup(retry.render());
  assert.match(emptyHtml, /执行记录已建立/);
  assert.match(emptyHtml, /2026\/10\/01 00:00:00/);
  assert.doesNotMatch(emptyHtml, /本次已完成/);
  assert.doesNotMatch(emptyHtml, /未勾选的日期不会自动记为未完成/);
  const completed = mount("RecurringExecutionHistory", { itemId: "series-1", createdAt: "2026-10-01T00:00:00+08:00" }, { async listRecurringExecutionHistory() { return [{ ...occurrence, id: "completed", kind: "execution", occurrence_id: occurrence.id, outcome: "completed", occurred_at: "2026-10-02T10:00:00+08:00" }]; } });
  completed.render(); await tick();
  const completedHtml = renderToStaticMarkup(completed.render());
  assert.match(completedHtml, /本次已完成/);
  assert.match(completedHtml, /执行记录已建立/);
  assert.match(completedHtml, /2 条动态/);
});

test("weekly read-only view reports each recurring occurrence result without treating untouched blocks as failures", () => {
  const entries = weekEntries("2026-10-29", { task_blocks: [], fixed_events: [] }, [
    { ...occurrence, outcome: "completed", review_notes: "已完成运动" },
    { ...occurrence, id: "moved-2", display_time: "11:00" },
    { ...occurrence, id: "yesterday", occurrence_date: "2026-10-28", outcome: "completed" }
  ], [], "2026-10-29");
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map(entry => entry.status), ["本次已完成", "已安排"]);
  assert.deepEqual(entries.map(entry => entry.layoutKey), ["recurring:occ-1", "recurring:moved-2"]);
  assert.equal(entries[0].notes, "已完成运动");
  assert.deepEqual(entries.map(entry => entry.tone), ["completed", "plan"]);
});

test("active, ended and recycled recurring details retain history, while editing excludes it", () => {
  for (const name of ["RecurringItemDetails", "DeletedRecurringItemDetails", "EndedRecurringItemDetails"]) {
    assert.match(functions.get(name), /<RecurringExecutionHistory key=\{`history:\$\{item.id\}`\} itemId=\{item.id\}/);
    assert.match(functions.get(name), /<TaskDetailResources key=\{item.id\}/, "resource and history siblings use distinct keys");
  }
  const editorStart = text.indexOf('<form id="recurring-editor-form"');
  const editor = text.slice(editorStart, text.indexOf("</form>", editorStart));
  assert.doesNotMatch(editor, /RecurringExecutionHistory|结束事项|暂停事项|恢复事项/);
  assert.match(editor, /requestTaskChange\(\{ kind: "recurring-detail" \}\)/);
  assert.match(editor, /onClick=\{cancelRecurringEditing\}/);
});

test("pause, resume and end are distinct lifecycle events, including date-only legacy records", async () => {
  for (const [kind, label] of [["paused", "重复事项已暂停"], ["resumed", "重复事项已恢复"], ["ended", "重复事项已结束"], ["soft_deleted", "已移入回收站"], ["restored", "已从回收站恢复（保持已结束）"]]) {
    for (const occurred_at of ["2026-10-29T18:30:00+08:00", "2026-10-29"]) {
      const h = mount("RecurringExecutionHistory", { itemId: "series-1", createdAt: "2026-10-01" }, {
        async listRecurringExecutionHistory() { return [{ id: "status:9", kind, occurrence_id: null, occurrence_date: "2026-10-29", outcome: null, occurred_at }]; }
      });
      h.render(); await tick();
      const tree = h.render();
      const row = byClass(tree, "task-detail-event")[0];
      assert.equal(row.props["data-status"], kind);
      assert.equal(row.props["data-occurrence-id"], undefined);
      const html = renderToStaticMarkup(tree);
      assert.ok(html.includes(label));
      assert.match(html, /执行记录已建立/);
      assert.doesNotMatch(html, /取消本次结果|不指定时间|本次已完成/);
      assert.equal(elements(tree, node => node.type === "time")[0].props.children, occurred_at.length === 10 ? occurred_at : "2026/10/29 18:30:00");
    }
  }
});

test("history reloads after pausing and resuming the selected series without navigating away", async () => {
  const props = { itemId: "series-1", createdAt: "2026-10-01", status: "active" };
  const events = [], calls = [];
  const h = mount("RecurringExecutionHistory", props, {
    async listRecurringExecutionHistory(id) { calls.push(id); return [...events]; }
  });
  h.render(); await tick();
  assert.equal(byClass(h.render(), "task-detail-event").length, 1);
  for (const [status, kind] of [["paused", "paused"], ["active", "resumed"], ["ended", "ended"]]) {
    events.push({ id: `status:${events.length}`, kind, occurrence_id: null, occurrence_date: "2026-10-29", outcome: null, occurred_at: "2026-10-29T18:30:00+08:00" });
    h.render({ ...props, status }); await tick();
    const rows = byClass(h.render(), "task-detail-event");
    assert.equal(rows.length, events.length + 1);
    assert.equal(rows[events.length - 1].props["data-status"], kind);
    assert.equal(rows.at(-1).props["data-status"], "created");
  }
  assert.deepEqual(calls, Array(4).fill("series-1"));
});

test("short recurring blocks share ordinary check sizing and keep their type icon on the trailing edge", () => {
  const blocks = text.slice(text.indexOf("{recurringTimelineBlocks.map"), text.indexOf("{draftBlocks.map"));
  assert.match(blocks, /recurring-event execution-\$\{display.outcome\}\$\{shortTaskBlockClass\(starts_at, ends_at\)\}/);
  assert.match(blocks, /<span className="timeline-recurring-marker" aria-hidden="true"><img src=\{recurringIcon\} alt="" \/><\/span>/);
  assert.doesNotMatch(blocks, /timeline-task-leading recurring/);
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const shared = String.raw`\.timeline-event:is\(\.execution-block, \.recurring-event\)\.is-short`;
  assert.match(css, new RegExp(shared + String.raw` \.timeline-event-check \{[^}]*width: 16px; height: 16px; min-height: 16px;`));
  assert.match(css, new RegExp(shared + String.raw` \.timeline-event-check::before \{ width: 12px; height: 12px;`));
  assert.match(css, new RegExp(shared + String.raw` \.timeline-event-check svg \{ width: 8px; height: 8px;`));
  assert.match(css, /\.timeline-recurring-marker \{[^}]*right: 10px;[^}]*pointer-events: none;/);
});

test("trash and restore reload selected recurring history while ended status stays unchanged", async () => {
  const props = { itemId: "series-1", createdAt: "2026-10-01", status: "ended", deletedAt: null };
  const events = [], calls = [];
  const h = mount("RecurringExecutionHistory", props, {
    async listRecurringExecutionHistory(id) { calls.push(id); return [...events]; }
  });
  h.render(); await tick(); h.render();
  for (const [kind, deletedAt] of [["soft_deleted", "2026-10-29T18:30:00+08:00"], ["restored", null]]) {
    events.push({ id: `recycle:${events.length}`, kind, occurrence_id: null, occurrence_date: "2026-10-29", outcome: null, occurred_at: "2026-10-29T18:30:00+08:00" });
    h.render({ ...props, deletedAt }); await tick();
    const tree = h.render();
    assert.equal(byClass(tree, "task-detail-event").length, events.length + 1);
    assert.match(renderToStaticMarkup(tree), kind === "soft_deleted" ? /已移入回收站/ : /已从回收站恢复（保持已结束）/);
  }
  assert.equal(calls.length, 3);
});

test("note-only recurring history names the note action, not cancellation", async () => {
  const h = mount("RecurringExecutionHistory", { itemId: "series-1", createdAt: "2026-10-01T00:00:00+08:00" }, { async listRecurringExecutionHistory() { return [{ ...occurrence, kind: "execution", id: "note-event", outcome: null, notes: "一条随手记", occurred_at: "2026-10-29T11:00:00+08:00" }]; } });
  h.render(); await tick();
  const html = renderToStaticMarkup(h.render());
  assert.match(html, /<strong>随手记<\/strong>/);
  assert.match(html, /一条随手记/);
  assert.doesNotMatch(html, /已取消本次结果|本次未完成/);
});

test("recurring incomplete result switches exclusively, saves explicitly and can cancel while retaining notes", async () => {
  const writes = [];
  const props = { occurrence, writable: true, disabled: false, onCancel() {}, async onSave(...args) { writes.push(args); } };
  const h = mount("RecurringOccurrenceResult", props);
  const buttons = () => elements(h.render(), node => node.props["data-outcome"]);
  const save = () => elements(h.render(), node => node.props.className === "primary-action")[0];
  assert.deepEqual(buttons().map(node => node.props["data-outcome"]), ["completed", "not_completed"]);
  assert.deepEqual(buttons().map(node => node.props["aria-pressed"]), [false, false]);
  buttons()[1].props.onClick();
  assert.deepEqual(buttons().map(node => node.props["aria-pressed"]), [false, true]);
  assert.deepEqual(writes, []);
  buttons()[0].props.onClick();
  assert.deepEqual(buttons().map(node => node.props["aria-pressed"]), [true, false]);
  buttons()[1].props.onClick();
  elements(h.render(), node => node.type === "textarea")[0].props.onChange({ target: { value: "  今天没做  " } });
  save().props.onClick();
  assert.deepEqual(writes, [["not_completed", "今天没做"]]);
  h.render({ ...props, occurrence: { ...occurrence, outcome: "not_completed", review_notes: "今天没做" } });
  assert.equal(save().props.disabled, true);
  buttons()[1].props.onClick();
  save().props.onClick();
  assert.deepEqual(writes.at(-1), [null, "今天没做"]);
  const saving = savingHarness();
  await saving.state.saveRecurringResult({ ...occurrence, outcome: "not_completed" }, null, "今天没做");
  assert.deepEqual(saving.writes, [["clear", "occ-1", "今天没做"]]);
  assert.equal(saving.notices[0][0], "已取消本次未完成");
  h.render({ ...props, writable: false, occurrence: { ...occurrence, outcome: "not_completed", review_notes: "今天没做" } });
  assert.equal(elements(h.render(), node => node.props["data-outcome"]).length, 0);
});

test("recurring cancellation history names the original result, including cancellation with a note", async () => {
  const events = ["completed", "not_completed", "partial", null].map((cancelled_outcome, index) => ({
    ...occurrence, id: `clear-${index}`, kind: "execution", occurrence_id: `occ-${index}`, outcome: null,
    cancelled_outcome, notes: index === 1 ? "保留的备注" : null, occurred_at: "2026-10-29T10:00:00+08:00"
  }));
  events.push({ ...events[0], id: "note", cancelled_outcome: null, notes: "仅随手记" });
  events.push({ ...events[0], id: "note-clear", cancelled_outcome: null, note_cleared: true });
  const h = mount("RecurringExecutionHistory", { itemId: "series-1", createdAt: "2026-10-01" }, { async listRecurringExecutionHistory() { return events; } });
  h.render(); await tick();
  const rows = byClass(h.render(), "task-detail-event");
  assert.deepEqual(rows.slice(0, 6).map(row => elements(row, node => node.type === "strong")[0].props.children),
    ["已取消本次完成", "已取消本次未完成", "已取消本次部分完成", "已取消本次结果", "随手记", "随手记"]);
  assert.ok(rows.slice(0, 4).every(row => row.props["data-status"] === "cleared"));
  assert.ok(rows.slice(4, 6).every(row => row.props["data-status"] === "open"));
  assert.match(renderToStaticMarkup(rows[5]), /已清空随手记/);
  assert.match(renderToStaticMarkup(h.render()), /保留的备注/);
});

test("focusing a timeline quick check dismisses task hover content before pointerup, while task content still shows it", () => {
  let shown = 0, hidden = 0;
  const state = { isTaskTimelineTooltip: () => true, timelineTooltipFocusRef: { current: null }, showTimelineTooltipForTarget() { shown++; }, hideTimelineTooltip() { hidden++; } };
  vm.runInNewContext(compile(functions.get("timelineTooltipProps")), state);
  const handlers = state.timelineTooltipProps({ kind: "重复事项" });
  const check = { closest: selector => selector === ".timeline-event-check" ? {} : null };
  handlers.onFocus({ target: check, currentTarget: {} });
  assert.equal(hidden, 1);
  assert.equal(shown, 0, "the hover card must not move over the pending click");
  assert.equal(state.timelineTooltipFocusRef.current, null);
  const body = { closest: () => null };
  handlers.onFocus({ target: body, currentTarget: {} });
  assert.equal(shown, 1);
  assert.equal(state.timelineTooltipFocusRef.current, body);
});
