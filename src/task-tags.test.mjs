import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as rules from "./task-tags.ts";
const { addTaskTag, matchesTag, matchesTaggedSearch, uniqueTags, MAX_GLOBAL_TAGS, MAX_TASK_TAGS } = rules;

test("tags trim blanks and deduplicate case-insensitively without mutating input", () => {
  const original = [" 工作 ", "WORK"];
  assert.deepEqual(addTaskTag(original, "work"), ["工作", "WORK"]);
  assert.deepEqual(original, [" 工作 ", "WORK"]);
  assert.deepEqual(uniqueTags(["", " ", "工作", "工作", "Work", "work"]), ["工作", "Work"]);
  assert.deepEqual(addTaskTag(["工作"], " "), ["工作"]);
});

test("tag limits use 50 global / 10 per task and Unicode scalar length", () => {
  assert.equal(MAX_GLOBAL_TAGS, 50);
  assert.equal(MAX_TASK_TAGS, 10);
  assert.equal(addTaskTag([], "😀".repeat(30))[0], "😀".repeat(30));
  assert.throws(() => addTaskTag([], "中".repeat(31)), /30/);
  assert.throws(() => addTaskTag([], "😀".repeat(31)), /30/);
  const full = Array.from({ length: 10 }, (_, i) => `tag-${i}`);
  assert.deepEqual(addTaskTag(full, " TAG-0 "), full);
  assert.throws(() => addTaskTag(full, "another"), /10/);
  assert.equal(addTaskTag(full.slice(1), "another").length, 10);
});

test("legacy over-limit and overlong selections survive duplicate additions unchanged", () => {
  const legacy = ["中".repeat(31), ...Array.from({ length: 14 }, (_, i) => `tag-${i}`)];
  assert.deepEqual(addTaskTag(legacy, " TAG-0 "), legacy);
  assert.deepEqual(addTaskTag(legacy, legacy[0]), legacy);
  assert.deepEqual(addTaskTag(legacy, " "), legacy);
  assert.throws(() => addTaskTag(legacy, "new"), /10/);
  assert.equal(legacy.length, 15);
});

test("tag filters use exact case-insensitive matches, search includes tags", () => {
  assert.equal(matchesTag(["Work"], " work "), true);
  assert.equal(matchesTag(["Work"], "wor"), false);
  assert.equal(matchesTag([], ""), true);
  assert.equal(matchesTag([], "工作"), false);
  const task = { title: "做原型", notes: null, tags: ["Project Alpha", "设计"] };
  assert.equal(matchesTaggedSearch(task, "alpha"), true);
  assert.equal(matchesTaggedSearch(task, "设计"), true);
  assert.equal(matchesTaggedSearch(task, "原型"), true);
  assert.equal(matchesTaggedSearch(task, "财务"), false);
});

// Run the actual TSX handlers with a tiny hook/element host; no DOM dependency needed.
const componentCode = ts.transpileModule(readFileSync(new URL("./task-tag-editor.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
}).outputText;
const settle = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function createHost(initial = [], overrides = {}) {
  let current;
  const server = [...initial];
  const calls = { list: 0, create: [], notifications: 0, portals: [] };
  const listeners = new Map();
  const document = {
    body: {},
    addEventListener(name, listener) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(listener); },
    removeEventListener(name, listener) { listeners.get(name)?.delete(listener); }
  };
  const slot = (init) => {
    const index = current.index++;
    return current.slots[index] ??= init();
  };
  const react = {
    useState(value) { const state = slot(() => ({ value })); return [state.value, (next) => { state.value = typeof next === "function" ? next(state.value) : next; }]; },
    useRef(value) { return slot(() => ({ current: value })); },
    useEffect(effect, deps) {
      const state = slot(() => ({}));
      if (!state.deps || deps.some((value, index) => value !== state.deps[index])) {
        state.deps = deps;
        current.effects.push(() => { state.cleanup?.(); state.cleanup = effect(); });
      }
    },
    useLayoutEffect() {}, // Geometry requires a browser; handlers and subscriptions do not.
    useSyncExternalStore(subscribe, getSnapshot) {
      slot(() => ({ cleanup: subscribe(() => { calls.notifications++; }) }));
      return getSnapshot();
    }
  };
  const api = {
    async listTagCatalog() { calls.list++; return overrides.list ? overrides.list() : [...server]; },
    async createTag(name) {
      calls.create.push(name);
      if (overrides.create) return overrides.create(name);
      const existing = server.find((tag) => rules.tagKey(tag.name) === rules.tagKey(name));
      if (existing) return existing;
      if (server.length >= 50) throw new Error("全局最多创建 50 种标签");
      const definition = { name, color: 6 };
      server.push(definition);
      return definition;
    }
  };
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
  const exports = {};
  const modules = { react, "react-dom": { createPortal: (node, target) => { calls.portals.push(target); return node; } }, "react/jsx-runtime": { jsx, jsxs: jsx }, "./tauri": api, "./task-tags": rules, "./task-tags.css": {} };
  new Function("require", "exports", "document", componentCode)((name) => {
    if (!(name in modules)) throw new Error(`Unexpected import: ${name}`);
    return modules[name];
  }, exports, document);
  function mount(component, props) {
    const instance = { slots: [], index: 0, effects: [], props, tree: null, changes: [] };
    instance.render = () => {
      current = instance;
      instance.index = 0;
      instance.tree = component(instance.props);
      const effects = instance.effects.splice(0);
      effects.forEach((effect) => effect());
      return instance.tree;
    };
    instance.unmount = () => instance.slots.forEach((state) => state.cleanup?.());
    instance.render();
    return instance;
  }
  return {
    calls, server,
    editor(props = {}) {
      let editor;
      editor = mount(exports.TaskTagEditor, { tags: [], disabled: false, id: "tags", onChange(tags) { editor.changes.push(tags); editor.props.tags = tags; }, ...props });
      return editor;
    },
    list(tags, expanded = false, limit = 3) { return mount(exports.TaskTagList, { tags, expanded, limit }); },
    filter(props = {}) {
      let filter;
      filter = mount(exports.TaskTagFilter, { id: "filter", tags: [], value: "", onChange(value) { filter.changes.push(value); filter.props.value = value; }, ...props });
      return filter;
    },
    fire(name, event) { for (const listener of listeners.get(name) ?? []) listener(event); }
  };
}
function nodes(tree, predicate) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap((child) => nodes(child, predicate));
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
const byClass = (editor, className) => nodes(editor.tree, (node) => node.props.className?.split(" ").includes(className));
const input = (editor) => nodes(editor.tree, (node) => node.type === "input" && node.props.type !== "checkbox")[0];
const options = (editor) => nodes(editor.tree, (node) => node.type === "input" && node.props.type === "checkbox");
const addButton = (editor) => byClass(editor, "task-tag-create")[0];
const keyEvent = (key, nativeEvent = {}) => ({ key, nativeEvent, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } });
function search(editor, value) { input(editor).props.onChange({ target: { value } }); editor.render(); }
async function open(editor) {
  byClass(editor, "task-tag-dropdown-trigger")[0].props.onClick();
  editor.render();
  await settle();
  editor.render();
}

test("detail can show every tag while list defaults retain three tags and an overflow count", async () => {
  const tags = ["开发", "界面优化", "本周重点", "待讨论", "长标签".repeat(10)];
  const before = [...tags];
  const host = createHost(tags.map((name, color) => ({ name, color })));
  const list = host.list(tags), detail = host.list(tags, true);
  await settle();
  list.render(); detail.render();
  const chips = (instance) => nodes(instance.tree, node => node.type === "span" && "data-tag-color" in node.props);
  assert.deepEqual(chips(list).map(node => node.props.children), tags.slice(0, 3));
  const overflow = nodes(list.tree, node => node.type === "span" && node.props.title === tags.slice(3).join("、"));
  assert.equal(overflow.length, 1);
  assert.deepEqual(overflow[0].props.children, ["+", 2]);
  assert.equal(overflow[0].props.className, "task-tag-overflow");
  assert.equal(overflow[0].props["aria-label"], "还有 2 个标签");
  assert.deepEqual(chips(detail).map(node => node.props.children), tags);
  assert.deepEqual(chips(detail).map(node => node.props["data-tag-color"]), [0, 1, 2, 3, 4]);
  assert.equal(nodes(detail.tree, node => node.type === "span" && node.props.title === tags.slice(3).join("、")).length, 0);
  assert.equal(host.list([], true).tree, null);
  assert.deepEqual(tags, before);
});

test("dropdown tag filter shares catalog colors, deduplicates and selects without writes", async () => {
  const host = createHost([{ name: "Work", color: 3 }, { name: "设计", color: 1 }]);
  const tags = ["Work", " work ", "设计", ""];
  const filter = host.filter({ tags });
  const list = host.list(["Work"]);
  await settle();
  filter.render(); list.render();
  const trigger = () => byClass(filter, "task-filter-trigger")[0];
  assert.equal(trigger().props["aria-label"], "标签筛选");
  assert.deepEqual(byClass(filter, "task-filter-trigger-label")[0].props.children, "全部标签");
  trigger().props.onClick();
  filter.render();
  const opts = () => byClass(filter, "task-filter-option");
  assert.deepEqual(opts().map(node => node.props.title ?? "全部标签"), ["全部标签", "Work", "设计"]);
  assert.deepEqual(opts().map(node => node.props["data-tag-color"]), [undefined, 3, 1]);
  assert.deepEqual(opts().map(node => node.props["aria-selected"]), [true, false, false]);
  opts()[2].props.onClick(); filter.render();
  assert.deepEqual(filter.changes, ["设计"]);
  assert.equal(trigger().props["aria-label"], "标签筛选：设计");
  byClass(filter, "task-filter-clear")[0].props.onClick(); filter.render();
  assert.equal(filter.props.value, "");
  assert.equal(host.calls.list, 1);
  assert.deepEqual(host.calls.create, []);
  assert.deepEqual(tags, ["Work", " work ", "设计", ""]);
});

test("dropdown filter hides empty catalogs but preserves a selected legacy tag", () => {
  const host = createHost();
  assert.equal(host.filter().tree, null);
  const filter = host.filter({ value: "旧标签", tags: ["其他"] });
  assert.equal(byClass(filter, "task-filter-trigger")[0].props["aria-label"], "标签筛选：旧标签");
  byClass(filter, "task-filter-trigger")[0].props.onClick();
  filter.render();
  assert.deepEqual(byClass(filter, "task-filter-option").map(node => node.props.title ?? "全部标签"), ["全部标签", "其他", "旧标签"]);
  assert.equal(byClass(filter, "task-filter-option")[2].props["aria-selected"], true);
});

test("dropdown filter search narrows options, closes on Escape/clear and TaskTagList respects custom limit", () => {
  const host = createHost([{ name: "开发", color: 0 }, { name: "设计", color: 1 }, { name: "阅读", color: 2 }]);
  const filter = host.filter({ tags: ["开发", "设计", "阅读"] });
  const trigger = () => byClass(filter, "task-filter-trigger")[0];
  assert.equal(trigger().props["aria-haspopup"], "dialog");
  assert.equal(byClass(filter, "task-filter-popover").length, 0);
  trigger().props.onClick();
  filter.render();
  assert.equal(byClass(filter, "task-filter-popover").length, 1);
  const searchInput = nodes(byClass(filter, "task-filter-popover-search")[0], node => node.type === "input")[0];
  searchInput.props.onChange({ target: { value: "设" } });
  filter.render();
  assert.deepEqual(byClass(filter, "task-filter-option").map(node => node.props.title), ["设计"]);
  host.fire("keydown", keyEvent("Escape"));
  filter.render();
  assert.equal(byClass(filter, "task-filter-popover").length, 0);
  const compactList = host.list(["开发", "设计", "阅读"], false, 1);
  assert.equal(nodes(compactList.tree, node => node.type === "span" && "data-tag-color" in node.props).length, 1);
  assert.deepEqual(byClass(compactList, "task-tag-overflow")[0].props.children, ["+", 2]);
  const css = readFileSync(new URL("./task-tags.css", import.meta.url), "utf8");
  assert.match(css, /\.task-filter-dropdown \{[^}]*position: relative/);
  assert.match(css, /\.task-filter-trigger-group\.is-active \{/);
  assert.match(css, /\.task-filter-popover \{[^}]*position: absolute/);
  assert.match(css, /\.task-filter-option\.is-selected \{ background: transparent;/);
});

test("task search weakens only its light-mode placeholder and icon", () => {
  const css = readFileSync(new URL("./task-comfort.css", import.meta.url), "utf8");
  assert.match(css, /:not\(\[data-mode="dark"\]\) \.tasks-workspace \.task-queue-search > svg \{ color: #64748b; \}/);
  assert.match(css, /input\[type="search"\]::placeholder \{\s*color: #64748b;\s*font-weight: 400;\s*opacity: 1;\s*\}/);
});

test("picker footer retains counts and limit messages without the save hint", async () => {
  const host = createHost([{ name: "开发", color: 0 }]);
  const editor = host.editor({ tags: ["开发"] });
  await open(editor);
  const footer = () => nodes(editor.tree, node => node.type === "footer")[0];
  assert.doesNotMatch(JSON.stringify(footer()), /勾选后随任务保存/);
  assert.equal(byClass(editor, "task-tag-count").length, 1);
  assert.equal(byClass(editor, "task-tag-global-count").length, 1);
  assert.equal(nodes(footer(), node => node.props.role === "status").length, 0);
  editor.props.tags = Array.from({ length: 10 }, (_, i) => `标签${i}`);
  editor.render();
  assert.equal(nodes(footer(), node => node.props.role === "status")[0].props.children, "已达每项上限，仅可取消已选标签。");
  const globalHost = createHost(Array.from({ length: 50 }, (_, i) => ({ name: `标签${i}`, color: i % 8 })));
  const globalEditor = globalHost.editor();
  await open(globalEditor);
  assert.equal(nodes(globalEditor.tree, node => node.props.role === "status")[0].props.children, "已达全局上限，可选择已有标签。");
});

test("tag selection intersects with text search instead of replacing it", () => {
  const tasks = [
    { title: "整理项目", tags: ["开发"] },
    { title: "整理资料", tags: ["阅读"] },
    { title: "修复问题", tags: ["开发"] }
  ];
  assert.deepEqual(tasks.filter(task => matchesTag(task.tags, "开发") && matchesTaggedSearch(task, "整理")), [tasks[0]]);
});

test("all editors use a dropdown, rows share one initial request and persisted colors", async () => {
  const host = createHost([{ name: "Work", color: 3 }]);
  const rows = Array.from({ length: 30 }, () => host.list([" work "]));
  const editor = host.editor({ tags: ["WORK"], dropdown: false });
  assert.equal(byClass(editor, "task-tag-dropdown-trigger").length, 1);
  assert.equal(input(editor), undefined);
  await settle();
  assert.equal(host.calls.list, 1);
  rows.forEach((row) => { row.render(); assert.equal(nodes(row.tree, (node) => node.props.title === " work ")[0].props["data-tag-color"], 3); });
  await open(editor);
  assert.equal(host.calls.list, 2);
  assert.equal(byClass(editor, "task-tag-option")[0].props["data-tag-color"], 3);
  assert.equal(byClass(editor, "task-tag-option-name")[0].props["data-tag-color"], 3);
});

test("fuzzy matches still show Add; exact trimmed case-insensitive matches do not", async () => {
  const host = createHost([{ name: "Project Alpha", color: 2 }]);
  const editor = host.editor({ tags: ["已选"] });
  await open(editor);
  search(editor, "alpha");
  assert.equal(options(editor).length, 1);
  assert.equal(addButton(editor).props.disabled, false);
  const panel = byClass(editor, "task-tag-dropdown-panel")[0];
  const children = panel.props.children.filter(Boolean);
  assert.equal(children[0].props.className, "task-tag-search-header");
  assert.equal(children[1].props.className, "task-tag-scroll-area");
  search(editor, " PROJECT ALPHA ");
  assert.equal(addButton(editor), undefined);
  input(editor).props.onKeyDown(keyEvent("Enter"));
  editor.render();
  assert.deepEqual(editor.props.tags, ["已选", "Project Alpha"]);
  assert.deepEqual(host.calls.create, []);
  options(editor)[0].props.onChange({ target: { checked: false } });
  editor.render();
  assert.deepEqual(editor.props.tags, ["已选"]);
});

test("creating persists immediately, auto-selects canonical name/color and notifies other lists", async () => {
  const host = createHost([], { create: async () => ({ name: "New", color: 5 }) });
  const row = host.list(["new"]);
  const editor = host.editor();
  await open(editor);
  search(editor, " new ");
  const before = host.calls.notifications;
  addButton(editor).props.onClick();
  await settle();
  editor.render();
  row.render();
  assert.deepEqual(host.calls.create, ["new"]);
  assert.deepEqual(editor.props.tags, ["New"]);
  assert.equal(input(editor).props.value, "");
  assert.equal(byClass(editor, "task-tag-option")[0].props["data-tag-color"], 5);
  assert.equal(nodes(row.tree, (node) => node.props.title === "new")[0].props["data-tag-color"], 5);
  assert.ok(host.calls.notifications > before);
});

test("pending creates block repeated clicks/Enter and use latest task state on completion", async () => {
  const request = deferred();
  const host = createHost([], { create: () => request.promise });
  const editor = host.editor();
  await open(editor);
  search(editor, "new");
  const button = addButton(editor);
  button.props.onClick();
  button.props.onClick();
  input(editor).props.onKeyDown(keyEvent("Enter"));
  await settle();
  editor.render();
  assert.deepEqual(host.calls.create, ["new"]);
  assert.equal(addButton(editor).props.disabled, true);
  assert.equal(input(editor).props.disabled, true);
  editor.props.tags = ["external"];
  editor.render();
  request.resolve({ name: "new", color: 7 });
  await settle();
  editor.render();
  assert.deepEqual(editor.props.tags, ["external", "new"]);
});

test("IME Enter, composition tracking and keyCode 229 never create tags", async () => {
  const host = createHost();
  const editor = host.editor();
  await open(editor);
  search(editor, "中文");
  input(editor).props.onKeyDown(keyEvent("Enter", { isComposing: true }));
  input(editor).props.onKeyDown(keyEvent("Enter", { keyCode: 229 }));
  input(editor).props.onCompositionStart();
  input(editor).props.onKeyDown(keyEvent("Enter"));
  await settle();
  assert.deepEqual(host.calls.create, []);
  input(editor).props.onCompositionEnd();
  input(editor).props.onKeyDown(keyEvent("Enter"));
  await settle();
  assert.deepEqual(host.calls.create, ["中文"]);
});

test("legacy over-limit task selections remain visible/removable but cannot grow", async () => {
  const legacy = Array.from({ length: 12 }, (_, i) => `tag-${i}`);
  const host = createHost([...legacy, "other"].map((name) => ({ name, color: 1 })));
  const editor = host.editor({ tags: legacy });
  await open(editor);
  assert.equal(options(editor).filter((option) => option.props.checked).length, 12);
  assert.equal(options(editor).filter((option) => !option.props.disabled).length, 12);
  const extra = options(editor).find((option) => !option.props.checked);
  assert.equal(extra.props.disabled, true);
  search(editor, "new");
  assert.equal(addButton(editor).props.disabled, true);
  input(editor).props.onKeyDown(keyEvent("Enter"));
  editor.render();
  assert.equal(nodes(editor.tree, (node) => node.props.role === "alert").length, 1);
  assert.deepEqual(host.calls.create, []);
  search(editor, "tag-0");
  options(editor)[0].props.onChange({ target: { checked: false } });
  editor.render();
  assert.equal(editor.props.tags.length, 11);
  search(editor, "tag-1");
  input(editor).props.onKeyDown(keyEvent("Enter"));
  editor.render();
  assert.equal(editor.props.tags.length, 11);
  assert.equal(nodes(editor.tree, (node) => node.props.role === "alert").length, 0);
});

test("global legacy over-limit catalogs block new names but allow selecting existing ones", async () => {
  const host = createHost(Array.from({ length: 52 }, (_, i) => ({ name: `tag-${i}`, color: i % 8 })));
  const editor = host.editor();
  await open(editor);
  search(editor, "new");
  assert.equal(addButton(editor).props.disabled, true);
  input(editor).props.onKeyDown(keyEvent("Enter"));
  await settle();
  editor.render();
  assert.deepEqual(host.calls.create, []);
  assert.match(nodes(editor.tree, (node) => node.props.role === "alert")[0].props.children, /50/);
  search(editor, "TAG-51");
  assert.equal(addButton(editor), undefined);
  assert.equal(options(editor)[0].props.disabled, false);
  options(editor)[0].props.onChange({ target: { checked: true } });
  editor.render();
  assert.deepEqual(editor.props.tags, ["tag-51"]);
});

test("backend errors and Unicode-length errors are visible, failures permit retry", async () => {
  let fail = true;
  const host = createHost([], { create: async (name) => { if (fail) throw new Error("保存失败"); return { name, color: 0 }; } });
  const editor = host.editor();
  await open(editor);
  search(editor, "😀".repeat(31));
  addButton(editor).props.onClick();
  editor.render();
  assert.deepEqual(host.calls.create, []);
  assert.match(nodes(editor.tree, (node) => node.props.role === "alert")[0].props.children, /30/);
  search(editor, "retry");
  addButton(editor).props.onClick();
  await settle();
  editor.render();
  assert.match(nodes(editor.tree, (node) => node.props.role === "alert")[0].props.children, /保存失败/);
  assert.equal(addButton(editor).props.disabled, false);
  fail = false;
  addButton(editor).props.onClick();
  await settle();
  editor.render();
  assert.deepEqual(editor.props.tags, ["retry"]);
});

test("catalog failures are shared, visible and retried on opening, not once per task row", async () => {
  let fail = true;
  const host = createHost([], { list: async () => { if (fail) throw new Error("读取失败"); return [{ name: "loaded", color: 4 }]; } });
  for (let i = 0; i < 25; i++) host.list(["loaded"]);
  const editor = host.editor();
  await settle();
  assert.equal(host.calls.list, 1);
  await open(editor);
  assert.equal(host.calls.list, 2);
  assert.match(nodes(editor.tree, (node) => node.props.role === "alert")[0].props.children, /读取失败/);
  byClass(editor, "task-tag-dropdown-trigger")[0].props.onClick();
  editor.render();
  fail = false;
  await open(editor);
  assert.equal(options(editor).length, 1);
  assert.equal(nodes(editor.tree, (node) => node.props.role === "alert").length, 0);
});

test("Escape / outside pointer or focus close the picker, and keyboard can focus options", async () => {
  const host = createHost([{ name: "known", color: 1 }]);
  const editor = host.editor();
  await open(editor);
  let focused = false;
  const option = { focus() { focused = true; } };
  byClass(editor, "task-tag-dropdown-panel")[0].props.ref.current = { contains: () => false, querySelectorAll: () => [option] };
  const down = keyEvent("ArrowDown");
  input(editor).props.onKeyDown(down);
  assert.equal(focused, true);
  assert.equal(down.prevented, true);
  host.fire("keydown", keyEvent("Escape"));
  editor.render();
  assert.equal(input(editor), undefined);
  await open(editor);
  host.fire("pointerdown", { target: {} });
  editor.render();
  assert.equal(input(editor), undefined);
  await open(editor);
  host.fire("focusin", { target: {} });
  editor.render();
  assert.equal(input(editor), undefined);
});

test("disabled/unmounted editors do not submit late selections; created colors still reach lists", async () => {
  const request = deferred();
  const host = createHost([], { create: () => request.promise });
  const editor = host.editor();
  const row = host.list(["new"]);
  await open(editor);
  search(editor, "new");
  addButton(editor).props.onClick();
  await settle();
  editor.props.disabled = true;
  editor.render();
  editor.render();
  assert.equal(input(editor), undefined);
  editor.unmount();
  request.resolve({ name: "new", color: 2 });
  await settle();
  row.render();
  assert.deepEqual(editor.changes, []);
  assert.equal(nodes(row.tree, (node) => node.props.title === "new")[0].props["data-tag-color"], 2);
});

test("only the eight preset color indices are rendered; light and dark palettes are defined", async () => {
  const host = createHost([{ name: "unsafe", color: 99 }, { name: "safe", color: 0 }]);
  const row = host.list(["unsafe", "safe"]);
  await settle();
  row.render();
  assert.equal(nodes(row.tree, (node) => node.props.title === "unsafe")[0].props["data-tag-color"], undefined);
  assert.equal(nodes(row.tree, (node) => node.props.title === "safe")[0].props["data-tag-color"], 0);
  const css = readFileSync(new URL("./task-tags.css", import.meta.url), "utf8");
  const palette = readFileSync(new URL("./color-system.css", import.meta.url), "utf8");
  const families = ["blue", "purple", "pink", "orange", "yellow", "green", "cyan", "gray"];
  for (let color = 0; color < 8; color++) {
    assert.ok(css.includes(`[data-tag-color="${color}"] { --task-tag-ink:`));
    assert.ok(css.includes(`--task-tag-ink: var(--color-${families[color]}-ink)`));
    assert.equal((palette.match(new RegExp(`--color-${families[color]}-ink:`, "g")) ?? []).length, 2);
  }
  assert.match(css, /\.task-tag-search-header \{[^}]*flex: none/);
  assert.match(css, /\.task-tag-scroll-area \{[^}]*overflow-y: auto/);
});

test("the 50th global tag is allowed and the 51st is blocked without blocking existing choices", async () => {
  const host = createHost(Array.from({ length: 49 }, (_, i) => ({ name: `tag-${i}`, color: i % 8 })));
  const editor = host.editor();
  await open(editor);
  search(editor, "fiftieth");
  assert.equal(addButton(editor).props.disabled, false);
  addButton(editor).props.onClick();
  await settle();
  editor.render();
  assert.equal(host.server.length, 50);
  search(editor, "fifty-first");
  assert.equal(addButton(editor).props.disabled, true);
  input(editor).props.onKeyDown(keyEvent("Enter"));
  await settle();
  editor.render();
  assert.deepEqual(host.calls.create, ["fiftieth"]);
  search(editor, "tag-0");
  options(editor)[0].props.onChange({ target: { checked: true } });
  editor.render();
  assert.deepEqual(editor.props.tags, ["fiftieth", "tag-0"]);
});

test("stale list responses cannot erase a newly persisted tag or its color", async () => {
  const creation = deferred();
  let refresh;
  const host = createHost([], { list: () => refresh ? refresh.promise : [], create: () => creation.promise });
  const editor = host.editor();
  const row = host.list(["new"]);
  await open(editor);
  search(editor, "new");
  addButton(editor).props.onClick();
  await settle();
  refresh = deferred();
  const other = host.editor({ id: "other-tags" });
  await open(other);
  creation.resolve({ name: "new", color: 4 });
  await settle();
  row.render();
  assert.equal(nodes(row.tree, (node) => node.props.title === "new")[0].props["data-tag-color"], 4);
  refresh.resolve([]);
  await settle();
  row.render();
  other.render();
  assert.equal(nodes(row.tree, (node) => node.props.title === "new")[0].props["data-tag-color"], 4);
  assert.equal(byClass(other, "task-tag-option-name")[0].props["data-tag-color"], 4);
});

test("removing below the task limit enables additions again, including after a legacy overflow", async () => {
  const tags = Array.from({ length: 11 }, (_, i) => `tag-${i}`);
  const host = createHost([...tags, "other"].map((name) => ({ name, color: 2 })));
  const editor = host.editor({ tags });
  await open(editor);
  for (const name of ["tag-0", "tag-1"]) {
    options(editor).find((node) => node.props["aria-label"] === name).props.onChange({ target: { checked: false } });
    editor.render();
  }
  search(editor, "other");
  assert.equal(options(editor)[0].props.disabled, false);
  options(editor)[0].props.onChange({ target: { checked: true } });
  editor.render();
  assert.equal(editor.props.tags.length, 10);
  assert.equal(editor.props.tags.at(-1), "other");
  assert.deepEqual(host.calls.create, []);
});

test("approved A renders one color-dot/name/check row per tag without duplicate selected chips", async () => {
  const host = createHost([{ name: "开发", color: 0 }, { name: "设计", color: 1 }]);
  const editor = host.editor({ tags: ["开发"] });
  await open(editor);
  assert.equal(byClass(editor, "task-tag-chips").length, 0);
  assert.equal(byClass(editor, "task-tag-option").length, 2);
  assert.equal(byClass(editor, "task-tag-swatch").length, 2);
  assert.deepEqual(byClass(editor, "task-tag-check").map(node => node.props.children), ["✓", ""]);
  assert.deepEqual(options(editor).map(node => node.props["aria-label"]), ["开发", "设计"]);
  options(editor)[1].props.onChange({ target: { checked: true } });
  editor.render();
  assert.deepEqual(editor.changes, [["开发", "设计"]]);
  assert.deepEqual(byClass(editor, "task-tag-check").map(node => node.props.children), ["✓", "✓"]);
  assert.deepEqual(host.calls.create, []);
});

test("A keeps a 44px semantic selection surface and a scoped 8px trigger without changing list chips", () => {
  const css = readFileSync(new URL("./task-tags.css", import.meta.url), "utf8");
  assert.match(css, /\.task-tag-dropdown-trigger \{[^}]*border-radius: 8px/);
  assert.match(css, /\.task-tag-option \{[^}]*min-height: 44px[^}]*font-size: 14px/);
  assert.match(css, /\.task-tag-option:has\(input:checked\) \{[^}]*var\(--task-tag-ink[^}]*var\(--task-tag-bg/);
  assert.match(css, /\.task-tag-option input \{[^}]*opacity: 0/);
  assert.match(css, /\.task-tag-option:has\(input:focus-visible\)/);
  assert.match(css, /\.task-tag-editor\.task-tag-dropdown-panel \.task-tag-entry > input \{[^}]*border: 0[^}]*background: transparent/);
  assert.match(css, /\.task-list-tags > span \{[^}]*font-size: 10\.5px/);
  assert.match(css, /\.task-list-tags > \.task-tag-overflow \{[^}]*flex: none/);
});

test("disabled A cannot open from stale trigger handlers or arrow keys", async () => {
  const host = createHost([{ name: "开发", color: 0 }]);
  const editor = host.editor({ disabled: true });
  const trigger = byClass(editor, "task-tag-dropdown-trigger")[0];
  trigger.props.onClick();
  trigger.props.onKeyDown(keyEvent("ArrowDown"));
  editor.render();
  assert.equal(input(editor), undefined);
  assert.deepEqual(editor.changes, []);
});

test("tag panels stay inside a native modal instead of becoming inert behind it", async () => {
  const host = createHost([{ name: "开发", color: 0 }]);
  const editor = host.editor();
  const trigger = byClass(editor, "task-tag-dropdown-trigger")[0];
  const dialog = {};
  let selector;
  trigger.props.ref.current = { closest(value) { selector = value; return dialog; } };
  await open(editor);
  assert.equal(host.calls.portals.at(-1), dialog);
  assert.equal(selector, "dialog");
  assert.equal(byClass(editor, "task-tag-dropdown-panel").length, 1);
});

test("filter labels show counts when provided and preserve tag selection without writes", () => {
  const host = createHost();
  const filter = host.filter({ tags: ["Work", "开发", "零任务"], counts: { work: 2, 开发: 1, 零任务: 0 } });
  const trigger = () => byClass(filter, "task-filter-trigger")[0];
  assert.equal(byClass(filter, "task-tag-filter-count").length, 0);
  trigger().props.onClick();
  filter.render();
  const options = byClass(filter, "task-filter-option");
  assert.deepEqual(options.map(node => [].concat(byClass({ tree: node }, "task-filter-option-name")[0].props.children).join("")), ["全部标签", "#Work", "#开发", "#零任务"]);
  assert.deepEqual(byClass(filter, "task-filter-option-count").map(node => node.props.children), [2, 1, 0]);
  options[1].props.onClick();
  filter.render();
  assert.deepEqual(filter.changes, ["Work"]);
  assert.equal(trigger().props["aria-label"], "标签筛选：Work");
  assert.deepEqual(host.calls.create, []);
  const css = readFileSync(new URL("./task-tags.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /task-tag-filter-count|\.has-count/);
  assert.match(css, /\.task-filter-option-count \{[^}]*font-variant-numeric: tabular-nums/);
});
