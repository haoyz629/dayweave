import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { visibleTaskScheduleBlocks } from "./task-result.ts";
import { taskAppearsOnDate } from "./calendar-task-placement.ts";

const text = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlers = new Map();
const summaries = new Map();
function collect(node) {
  if (ts.isFunctionDeclaration(node) && ["moveToTrash", "taskCommitted", "restore"].includes(node.name?.text)) handlers.set(node.name.text, node.getText(source));
  if (ts.isVariableDeclaration(node) && ["summaryTaskBlocks", "plannedTaskCount", "completedPlannedTaskCount", "plannedMinutes"].includes(node.name.getText(source))) summaries.set(node.name.getText(source), node.initializer.getText(source));
  ts.forEachChild(node, collect);
}
collect(source);
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const date = "2026-10-22";
const task = { id: "task", title: "跨日任务", status: "scheduled", deleted_at: null, earliest_start_date: "2026-10-21", due_date: "2026-10-23" };
const block = { id: "block", task_id: task.id, task_status: "scheduled", execution_status: "planned", starts_at: `${date}T09:00:00+08:00`, ends_at: `${date}T09:30:00+08:00`, review: null };
const schedule = { plan_id: "plan", fixed_events: [{ id: "event" }], task_blocks: [block, { ...block, id: "completed", execution_status: "completed" }, { ...block, id: "other-block", task_id: "other" }] };

function harness({ fail = false, loaded = true } = {}) {
  const calls = [];
  let saved = { ...task };
  let serverSchedule = structuredClone(schedule);
  let releaseRefresh;
  const state = {
    selectedDate: date, today: date, selectedTask: task, selectedId: task.id, pendingTrashTask: task,
    busy: false, preferredSelection: { current: task.id }, tasks: [task], daySchedule: loaded ? structuredClone(schedule) : null,
    taskListStatus: task => task.status, visibleTaskScheduleBlocks, uiErrorMessage: String,
    setTasks(update) { state.tasks = update(state.tasks); },
    setDaySchedule(update) { state.daySchedule = update(state.daySchedule); },
    async softDeleteManualTask(id, confirmed) {
      calls.push(["delete", id, confirmed]);
      if (fail) throw new Error("删除失败");
      saved = { ...task, status: "deleted", deleted_at: `${date}T12:00:00+08:00` };
      serverSchedule.task_blocks = serverSchedule.task_blocks.map(item => item.task_id === id ? { ...item, task_status: "deleted" } : item);
    },
    async getTask(id) { calls.push(["get", id]); return saved; },
    async restoreManualTask(id) { calls.push(["restore", id]); saved = { ...task }; serverSchedule = structuredClone(schedule); },
    refreshSchedule(...args) {
      calls.push(["schedule", ...args]);
      return new Promise(resolve => { releaseRefresh = () => { state.daySchedule = structuredClone(serverSchedule); resolve(); }; });
    },
    onTaskCommitted(committed) { calls.push(["commit", committed.status]); state.taskCommitted(committed); },
    async onReload(showLoading) { calls.push(["reload", showLoading]); state.tasks = [saved]; }
  };
  for (const key of ["busy", "selectedId", "draft", "taskMetadata", "pendingTrashTask", "trashTaskError", "feedback", "successToast", "view", "taskMetadataRevision", "selectedRecurringId"]) {
    state[`set${key[0].toUpperCase()}${key.slice(1)}`] = value => { state[key] = typeof value === "function" ? value(state[key] ?? 0) : value; };
  }
  const context = vm.createContext(state);
  for (const name of ["moveToTrash", "taskCommitted", "restore"]) vm.runInContext(compile(handlers.get(name)), context);
  const summary = () => {
    for (const [name, expression] of summaries) vm.runInContext(compile(`this.${name} = ${expression};`), context);
    return { count: state.plannedTaskCount, completed: state.completedPlannedTaskCount, minutes: state.plannedMinutes };
  };
  return { state, calls, summary, refresh: () => releaseRefresh?.() };
}

test("moving a task to trash hides its schedule blocks immediately while preserving cached blocks for restore", async () => {
  const current = harness();
  const before = structuredClone(current.state.daySchedule);
  assert.deepEqual(current.summary(), { count: 3, completed: 1, minutes: 90 });
  await current.state.moveToTrash();
  assert.equal(current.state.tasks[0].status, "deleted");
  assert.deepEqual(current.state.daySchedule.task_blocks.map(item => item.id), ["block", "completed", "other-block"]);
  assert.equal(current.state.daySchedule.task_blocks[0].task_status, "deleted");
  assert.deepEqual(current.summary(), { count: 1, completed: 0, minutes: 30 });
  assert.deepEqual(current.state.daySchedule.fixed_events, before.fixed_events);
  assert.equal(current.state.daySchedule.plan_id, before.plan_id);
  assert.ok(current.calls.some(([name, selectedDate, loading]) => name === "schedule" && selectedDate === date && loading === false));
  assert.equal(current.state.successToast.message, "已移入回收站");
  current.refresh();
  assert.deepEqual(current.summary(), { count: 1, completed: 0, minutes: 30 });
  assert.equal(before.task_blocks.length, 3, "UI cache changes do not mutate the original schedule");
});

test("restoring the task reloads its original planned and completed blocks", async () => {
  const current = harness();
  await current.state.moveToTrash();
  current.refresh();
  await current.state.restore(current.state.tasks[0]);
  current.refresh();
  assert.equal(current.state.tasks[0].status, "scheduled");
  assert.deepEqual(current.state.daySchedule.task_blocks, schedule.task_blocks);
  assert.deepEqual(current.summary(), { count: 3, completed: 1, minutes: 90 });
});

test("failed deletion and busy state leave the timeline unchanged", async () => {
  for (const busy of [false, true]) {
    const current = harness({ fail: true });
    current.state.busy = busy;
    const before = structuredClone(current.state.daySchedule);
    await current.state.moveToTrash();
    assert.deepEqual(current.state.daySchedule, before);
    assert.equal(current.state.tasks[0].status, "scheduled");
    assert.equal(current.calls.some(([name]) => ["commit", "schedule", "reload"].includes(name)), false);
    if (!busy) assert.match(current.state.trashTaskError, /删除失败/);
  }
});

test("deletion with no loaded schedule does not manufacture a schedule", async () => {
  const current = harness({ loaded: false });
  await current.state.moveToTrash();
  assert.equal(current.state.daySchedule, null);
  assert.equal(current.state.tasks[0].status, "deleted");
});

test("recycled task blocks stay hidden across past, today and future views until restored", () => {
  const recycled = { ...block, task_status: "deleted" };
  const completedDeleted = { ...recycled, id: "completed", execution_status: "completed" };
  const notedDeleted = { ...recycled, id: "noted", execution_note: "已完成前两项", execution_captured_at: `${date}T10:00:00+08:00` };
  for (const selectedDate of ["2026-10-21", date, "2026-10-23"]) {
    assert.deepEqual(visibleTaskScheduleBlocks([recycled, completedDeleted, notedDeleted, block], selectedDate, date), [block]);
  }
  const restoredCompleted = { ...completedDeleted, task_status: "scheduled" };
  assert.deepEqual(visibleTaskScheduleBlocks([restoredCompleted, block], date, date), [restoredCompleted, block]);
});

test("month grid hides recycled tasks across all dates and shows them again after restore", () => {
  const monthFilter = text.match(/const dayTasks = (tasks\.filter\([^\n]+\));/)?.[1];
  assert.ok(monthFilter, "month cell task filter expression exists in App.tsx");
  const activeTask = { id: "t1", status: "scheduled", deleted_at: null, scheduled_dates: [date], due_date: date, due_at: null };
  const deletedTask = { ...activeTask, status: "deleted", deleted_at: `${date}T12:00:00+08:00` };
  const evalMonth = (tasks) => vm.runInNewContext(compile(monthFilter), { tasks, cell: { key: date }, taskAppearsOnDate });
  assert.deepEqual(evalMonth([deletedTask]).length, 0);
  assert.deepEqual(evalMonth([activeTask]).length, 1);
});
