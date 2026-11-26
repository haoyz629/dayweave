import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const text = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const effects = new Map();
function collect(node) {
  if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect") {
    const code = node.arguments[0]?.getText(source) ?? "";
    if (code.includes("getUiSetting(TASK_QUEUE_VIEW_SETTING)")) effects.set("restore", code);
    if (code.includes("setUiSetting(TASK_QUEUE_VIEW_SETTING")) effects.set("save", code);
  }
  ts.forEachChild(node, collect);
}
collect(source);
const views = ["all", "draft", "recurring", "scheduled", "not_completed", "done", "deleted"];
const tick = () => new Promise(resolve => setImmediate(resolve));
function mount(storage, overrides = {}) {
  const state = {
    loading: false, requestedView: null, taskViewInitialized: { current: false }, handledRequestedView: { current: null },
    TASK_QUEUE_VIEW_SETTING: "ui.task_queue_view", taskViewCopy: Object.fromEntries(views.map(view => [view, view])),
    counts: { scheduled: 2, not_completed: 0 }, view: "scheduled", taskViewReady: false,
    async getUiSetting(key) { return storage.get(key) ?? null; },
    async setUiSetting(key, value) { storage.set(key, value); },
    setView(view) { state.view = view; }, setTaskViewReady(value) { state.taskViewReady = value; },
    ...overrides
  };
  const context = vm.createContext(state);
  return { state, run(name) {
    assert.ok(effects.has(name), `production ${name} effect found`);
    const js = ts.transpileModule(`(${effects.get(name)})();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInContext(js, context);
  } };
}

test("leaving and remounting tasks restores every last list, including empty lists", async () => {
  const storage = new Map();
  for (const view of views) {
    const before = mount(storage);
    before.run("save");
    assert.equal(storage.get("ui.task_queue_view"), views[views.indexOf(view) - 1], "uninitialized state cannot overwrite memory");
    before.state.view = view;
    before.state.taskViewReady = true;
    before.run("save");
    const after = mount(storage);
    after.run("restore");
    await tick();
    assert.equal(after.state.view, view);
    assert.equal(after.state.taskViewReady, true);
  }
});

test("missing, legacy open, or invalid memory falls back to the first populated operational list", async () => {
  for (const stored of [null, "open", "old-unknown-view", "__proto__", "toString"]) {
    const h = mount(new Map([["ui.task_queue_view", stored]]));
    h.run("restore"); await tick();
    assert.equal(h.state.view, "scheduled");
  }
  const empty = mount(new Map(), { counts: {} });
  empty.run("restore"); await tick();
  assert.equal(empty.state.view, "scheduled");
});

test("loading and explicit navigation keep priority over remembered lists", async () => {
  for (const changes of [{ loading: true }, { requestedView: { view: "recurring" } }, { taskViewInitialized: { current: true } }]) {
    let reads = 0;
    const h = mount(new Map(), { ...changes, async getUiSetting() { reads++; return "done"; } });
    h.run("restore"); await tick();
    assert.equal(reads, 0);
  }
  for (const fail of [false, true]) {
    let release;
    const h = mount(new Map(), { getUiSetting: () => new Promise((resolve, reject) => { release = () => fail ? reject(Error("offline")) : resolve("recurring"); }) });
    h.run("restore");
    h.state.handledRequestedView.current = { taskId: "target" };
    h.state.view = "done";
    h.state.taskViewReady = true;
    release(); await tick();
    assert.equal(h.state.view, "done", "late restore cannot override a handled task navigation");
  }
});

test("settings read or write failures preserve a usable task view", async () => {
  const h = mount(new Map(), {
    async getUiSetting() { throw Error("offline"); },
    async setUiSetting() { throw Error("offline"); }
  });
  h.run("restore"); await tick();
  assert.equal(h.state.view, "scheduled");
  assert.equal(h.state.taskViewReady, true);
  h.run("save"); await tick();
});
