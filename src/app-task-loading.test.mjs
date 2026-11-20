import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const text = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const app = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "App");
const functions = app.body.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === "refreshTasks");
const effects = app.body.statements.filter(ts.isExpressionStatement)
  .map(node => node.expression)
  .filter(node => ts.isCallExpression(node) && node.expression.getText(source) === "useEffect")
  .map(node => node.arguments[0].getText(source))
  .filter(code => code.includes("refreshAvailability()") || code.includes("setPlanPreview(null)"));
const requested = app.body.statements.filter(ts.isVariableStatement)
  .flatMap(node => [...node.declarationList.declarations])
  .find(node => node.name.getText(source) === "tasksRequested");
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));

function mount(overrides = {}) {
  const calls = { tasks: 0, recurring: 0, availability: 0, dates: [], loading: [] };
  const state = {
    selectedDate: "2026-11-12", document: { documentElement: { dataset: {} } },
    useRef: current => ({ current }),
    listTasks: async () => { calls.tasks++; return [{ id: "task" }]; },
    listRecurringItems: async () => { calls.recurring++; return [{ id: "recurring" }]; },
    listTaskDrafts: async () => [{ id: "draft-one" }, { id: "draft-two" }],
    setSidebarDraftCount(value) { state.draftCount = value; },
    refreshAvailability() { calls.availability++; },
    refreshSchedule(date) { calls.dates.push(date); },
    setTasks(value) { state.tasks = value; }, setRecurringItems(value) { state.recurring = value; },
    setTasksLoading(value) { calls.loading.push(value); }, setTasksError(value) { state.error = value; },
    setPlanPreview() {}, setPlanToast() {}, setMessage() {}, uiErrorMessage: error => error.message,
    ...overrides
  };
  const context = vm.createContext(state);
  assert.equal(functions.length, 1);
  assert.equal(effects.length, 2);
  assert.ok(requested);
  vm.runInContext(compile(`var tasksRequested = ${requested.initializer.getText(source)};\n${functions[0].getText(source)}`), context);
  const run = code => vm.runInContext(compile(`(${code})();`), context);
  return { state, calls, start() { effects.forEach(run); }, changeDate(date) {
    state.selectedDate = date;
    run(effects.find(code => code.includes("setPlanPreview(null)")));
  } };
}

test("mount reads each task collection once; later date changes still refresh without loading flicker", async () => {
  const h = mount();
  h.start();
  assert.equal(h.calls.tasks, 1);
  assert.equal(h.calls.recurring, 1);
  assert.deepEqual(h.calls.loading, [true]);
  await tick();
  assert.deepEqual(h.calls.loading, [true, false]);
  assert.equal(h.calls.availability, 1);
  assert.equal(h.state.tasks[0].id, "task");
  assert.equal(h.state.recurring[0].id, "recurring");
  assert.equal(h.state.draftCount, 2, "sidebar draft count is loaded before opening tasks");
  for (const date of ["2026-11-13", "2026-11-12"]) {
    h.changeDate(date);
    await tick();
  }
  assert.equal(h.calls.tasks, 3);
  assert.equal(h.calls.recurring, 3);
  assert.deepEqual(h.calls.dates, ["2026-11-12", "2026-11-13", "2026-11-12"]);
  assert.deepEqual(h.calls.loading, [true, false]);
});

test("failed initial read clears loading and a later date change can recover", async () => {
  let fail = true;
  const h = mount({ listTasks: async () => {
    if (fail) throw Error("读取失败");
    return [{ id: "recovered" }];
  } });
  h.start();
  await tick();
  assert.equal(h.state.error, "读取失败");
  assert.deepEqual(h.calls.loading, [true, false]);
  fail = false;
  h.changeDate("2026-11-13");
  await tick();
  assert.equal(h.state.error, null);
  assert.equal(h.state.tasks[0].id, "recovered");
  assert.deepEqual(h.calls.loading, [true, false]);
});
