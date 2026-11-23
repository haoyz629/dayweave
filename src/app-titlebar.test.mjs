import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CopySeparator } from "./copy-separator.test-helper.mjs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const source = read("./app-titlebar.tsx");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));
function mount({ desktop = true, fail = null, delayedListener = false } = {}) {
  const calls = [], errors = [], effects = [], values = [];
  let maximized = false, resize, resolveListener, stopped = 0;
  const appWindow = {
    async isMaximized() { return maximized; },
    onResized(callback) { resize = callback; const stop = () => stopped++; return delayedListener ? new Promise(resolve => resolveListener = () => resolve(stop)) : Promise.resolve(stop); }
  };
  for (const action of ["minimize", "toggleMaximize", "close", "startDragging"]) appWindow[action] = async () => {
    calls.push(action);
    if (fail === action) throw new Error("test rejection");
    if (action === "toggleMaximize") maximized = !maximized;
  };
  const exports = {};
  vm.runInNewContext(compiled, { exports, require(id) {
    if (id === "react") return { useState: value => [value, next => values.push(next)], useEffect: run => effects.push(run) };
    if (id === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (id === "@tauri-apps/api/core") return { isTauri: () => desktop };
    if (id === "@tauri-apps/api/window") return { getCurrentWindow: () => appWindow };
    if (id === "./logo") return { ProductBrand: () => null };
    throw new Error(id);
  }});
  const tree = exports.AppTitlebar({ viewSlotRef() {}, weekLabel: "2026 第44周", onError: error => errors.push(error) });
  const cleanups = effects.map(run => run());
  const nodes = [];
  function visit(node) { if (!node?.props) return; nodes.push(node); const children = node.props.children; (Array.isArray(children) ? children : [children]).forEach(visit); }
  visit(tree);
  return { calls, errors, values, tree, button: label => nodes.find(node => node.props["aria-label"] === label), resize: () => resize(), cleanup: () => cleanups.forEach(run => run?.()), finishListener: () => resolveListener(), stopped: () => stopped };
}

test("window buttons call native close request, never destroy, and refresh maximize state", async () => {
  const h = mount();
  for (const label of ["最小化", "最大化", "关闭窗口"]) { h.button(label).props.onClick(); await tick(); }
  assert.deepEqual(h.calls, ["minimize", "toggleMaximize", "close"]);
  assert(h.values.includes(true));
  h.resize(); await tick(); h.cleanup();
  assert.equal(h.stopped(), 1);
  assert.deepEqual(h.errors, []);
  assert.doesNotMatch(source, /\.destroy\(/);
});

test("title bar keeps only native window controls; settings moved to the sidebar footer", () => {
  const h = mount();
  assert.equal(h.button("设置"), undefined);
  assert.equal(h.button("偏好设置"), undefined);
  const list = value => (Array.isArray(value) ? value : [value]).filter(Boolean);
  const actions = list(h.tree.props.children).find(node => node.props?.className === "app-titlebar-actions");
  const controls = list(actions.props.children);
  assert.equal(controls.length, 1);
  assert.equal(controls[0].props.className, "app-window-controls");
  assert.deepEqual(Array.from(list(controls[0].props.children), node => node.props["aria-label"]), ["最小化", "最大化", "关闭窗口"]);
  h.cleanup();
});

test("only primary-button blank chrome drags or double-click maximizes", async () => {
  const h = mount();
  const mouse = (button, detail, control) => h.tree.props.onMouseDown({ button, detail, target: { closest: () => control }, preventDefault() {} });
  mouse(0, 1, true); mouse(2, 1, false); mouse(0, 1, false); mouse(0, 2, false);
  await tick();
  assert.deepEqual(h.calls, ["startDragging", "toggleMaximize"]);
  h.cleanup();
});

test("native errors are surfaced and browser-only rendering stays harmless", async () => {
  const h = mount({ fail: "close" });
  h.button("关闭窗口").props.onClick(); await tick();
  assert.match(h.errors[0], /窗口操作失败.*test rejection/);
  h.cleanup();
  const web = mount({ desktop: false });
  web.button("关闭窗口").props.onClick(); await tick();
  assert.deepEqual(web.calls, []); web.cleanup();
});

test("StrictMode cleanup unregisters a listener even if registration resolves late", async () => {
  const h = mount({ delayedListener: true });
  h.cleanup(); h.finishListener(); await tick();
  assert.equal(h.stopped(), 1);
  assert.deepEqual(h.values, []);
});

test("frameless configuration grants only required window mutation actions and retains native close guards", () => {
  const config = JSON.parse(read("../src-tauri/tauri.conf.json"));
  const capability = JSON.parse(read("../src-tauri/capabilities/default.json"));
  assert.equal(config.app.windows[0].decorations, false);
  for (const action of ["minimize", "toggle-maximize", "close", "start-dragging"]) assert(capability.permissions.includes(`core:window:allow-${action}`));
  assert(!capability.permissions.includes("core:window:allow-destroy"));
  const native = read("../src-tauri/src/lib.rs");
  assert.match(native, /WindowEvent::CloseRequested/);
  assert.match(native, /review-close-requested/);
  assert.match(native, /ui\.desktop\.close_to_tray/);
});

test("installer productName stays ASCII dayweave for install path and desktop shortcut", () => {
  const config = JSON.parse(read("../src-tauri/tauri.conf.json"));
  assert.equal(config.productName, "dayweave");
  assert.equal(config.app.windows[0].title, "今序 · Dayweave");
});

test("ISO week helper handles year boundaries while titlebar stays compact at 42px", () => {
  const app = read("./App.tsx");
  const css = read("./app-titlebar.css");
  const ast = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "isoWeekParts");
  const context = vm.createContext({});
  vm.runInContext(ts.transpileModule(fn.getText(ast), {}).outputText, context);
  for (const [date, year, week] of [["2026-10-29", 2026, 44], ["2021-01-01", 2020, 53], ["2018-12-31", 2019, 1], ["2026-12-31", 2026, 53], ["2027-01-04", 2027, 1]]) {
    const result = context.isoWeekParts(date);
    assert.equal(result.year, year, date);
    assert.equal(result.week, week, date);
  }
  assert.match(source, /<ProductBrand \/>/);
  assert.match(css, /\.desktop-app \{ --app-titlebar-height: 42px;/);
  assert.match(css, /\.app-window-controls button \{ display: grid; width: 46px; height: 100%;/);
  assert.match(css, /\.app-window-controls \.app-window-close:hover \{ color: #ffffff; background: #e81123; \}/);
});

test("brand renders single-line Chinese/English title without second-line slogan clutter", () => {
  const brand = read("./logo.tsx");
  const ast = ts.createSourceFile("logo.tsx", brand, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ProductBrand");
  const context = vm.createContext({ React, Logo: () => null, CopySeparator });
  vm.runInContext(ts.transpileModule(fn.getText(ast).replace("export ", ""), { compilerOptions: { jsx: ts.JsxEmit.React } }).outputText, context);
  const defaultHtml = renderToStaticMarkup(context.ProductBrand());
  assert.match(defaultHtml, /product-brand-name-row/);
  assert.match(defaultHtml, /今序[\s\S]*Dayweave/);
  assert.doesNotMatch(defaultHtml, /product-brand-copy|product-brand-week/);
  assert.match(renderToStaticMarkup(context.ProductBrand({ weekLabel: "2026 第44周" })), /<span class="product-brand-week">2026 第44周<\/span>/);
});

test("calendar view switch fills three equal columns with uniform frame insets", () => {
  const css = read("./app-titlebar.css");
  const frame = css.match(/^\.app-titlebar \.timeline-view-switch \{([^}]+)\}/m)?.[1];
  assert.ok(frame);
  assert.match(frame, /display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(frame, /gap: 3px;/);
  assert.match(frame, /box-sizing: border-box; width: 204px; height: 34px; padding: 3px; border: 1px/);
  assert.match(css, /\.app-titlebar \.timeline-view-switch button \{ width: 100%; min-width: 0; min-height: 26px; height: 26px;/);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*\.app-titlebar \.timeline-view-switch \{ width: 170px; \}/);
});

test("title bar exposes optional task creation without adding keyboard shortcut badges", () => {
  let created = 0;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require(id) {
    if (id === "react") return { useState: value => [value, () => {}], useEffect: () => {} };
    if (id === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (id === "@tauri-apps/api/core") return { isTauri: () => true };
    if (id === "@tauri-apps/api/window") return { getCurrentWindow: () => ({}) };
    if (id === "./logo") return { ProductBrand: () => null };
    throw new Error(id);
  }});
  const tree = exports.AppTitlebar({ viewSlotRef() {}, weekLabel: "2026 第44周", onError() {}, onCreateTask: () => { created++; } });
  const nodes = [];
  (function visit(node) { if (!node?.props) return; nodes.push(node); const c = node.props.children; (Array.isArray(c) ? c : [c]).forEach(visit); })(tree);
  const createBtn = nodes.find(node => node.props?.className === "app-create-button");
  assert.ok(createBtn);
  createBtn.props.onClick();
  assert.equal(created, 1);
  assert.doesNotMatch(source, /<kbd\b/);
});
