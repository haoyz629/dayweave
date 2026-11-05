import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SeparatedCopy } from "./copy-separator.test-helper.mjs";

const appText = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("App.tsx", appText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const cardText = readFileSync(new URL("./timeline-hover-card.tsx", import.meta.url), "utf8");
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
const today = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "TodayPage");
const names = ["showTimelineTooltipForTarget", "cancelTimelineTooltipHide", "hideTimelineTooltip", "scheduleTimelineTooltipHide", "timelineTooltipProps"];
const handlers = today.body.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => node.getText(source));
let dismissEffect, cardExpression, saveHandler, blockTooltipDetail;
function collect(node) {
  if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" && node.getText(source).includes("if (!timelineTooltip) return;")) dismissEffect = node.arguments[0].getText(source);
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === "TaskTimelineHoverCard") cardExpression = node.getText(source);
  if (ts.isFunctionDeclaration(node) && node.name?.text === "saveRecurringItem") saveHandler = node.getText(source);
  if (ts.isPropertyAssignment(node) && node.name.getText(source) === "detail" && node.initializer.getText(source).includes("block.review")) blockTooltipDetail = node.initializer.getText(source);
  ts.forEachChild(node, collect);
}
collect(source);

test("task tooltip separates only nonempty priority and status details", () => {
  assert.ok(blockTooltipDetail);
  const priorityCopy = { high: "高优先级", medium: "中优先级", low: "低优先级" };
  const reviewOutcomeCopy = { completed: "完成", incomplete: "未完成" };
  const hint = "上下拖动调整时间·点击精确编辑";
  const cases = [
    { task: { priority: "medium" }, expected: "中优先级" },
    { task: { priority: "high" }, expected: "高优先级" },
    { task: { priority: "low" }, expected: "低优先级" },
    { task: { priority: null }, expected: "" },
    { task: undefined, expected: "" },
    { task: { priority: "medium" }, draggable: true, expected: `中优先级 · ${hint}` },
    { task: undefined, draggable: true, expected: hint },
    { task: { priority: "medium" }, effectiveOutcome: "incomplete", expected: "中优先级 · 本次未完成 · 已记录" },
    { task: undefined, effectiveOutcome: "completed", expected: "本次完成 · 已记录" },
    { task: { priority: "medium" }, block: { review: { outcome: "incomplete", followup_action: "continue" } }, expected: "中优先级 · 未完成 · 继续" },
    { task: undefined, block: { review: { outcome: "completed", followup_action: null } }, expected: "完成 · 已记录" }
  ];
  for (const { task, draggable = false, block = {}, effectiveOutcome = null, expected } of cases) {
    const state = { task, block, effectiveOutcome, priorityCopy, reviewOutcomeCopy, taskNextActionLabels: { continue: "继续" }, canDragTimelineBlock: () => draggable };
    const detail = vm.runInNewContext(compile(`(${blockTooltipDetail});`), state);
    assert.equal(detail, expected);
    assert.doesNotMatch(detail, /^\s*·|·\s*$/);
  }
});

function loadCard(hooks = React, extra = {}) {
  const state = { React, exports: {}, require: name => { if (name === "./copy-separator") return { SeparatedCopy }; if (name === "./task-tag-editor") return { TaskTagList: ({ tags }) => tags.length ? React.createElement("div", { className: "task-list-tags" }, tags.join("、")) : null }; assert.equal(name, "react"); return hooks; }, ...extra };
  vm.runInNewContext(compile(cardText), state);
  return state.exports;
}
const cardModule = loadCard();
const content = { kind: "单日任务", title: "任务资料", time: "09:00 - 10:00 (1h)", detail: "点击查看", tone: "task", url: "https://example.com/a?long=" + "x".repeat(500), note: "第一行\n第二行\n".repeat(30), left: 0, top: 0, placement: "below", pointer: { x: 200, y: 150 } };

function tooltipHarness() {
  const timers = new Map(), listeners = new Map();
  let nextTimer = 0;
  const document = { activeElement: null, documentElement: { clientWidth: 1000, clientHeight: 800 } };
  class FakeNode {
    constructor(parent = null) { this.parent = parent; this.rect = { left: 100, right: 500, top: 80, bottom: 600, width: 400, height: 520 }; }
    contains(node) { for (let current = node; current; current = current.parent) if (current === this) return true; return false; }
    getBoundingClientRect() { return this.rect; }
    closest() { return null; }
    querySelector() { return null; }
    focus() { document.activeElement = this; }
  }
  document.body = new FakeNode();
  document.activeElement = document.body;
  const trigger = new FakeNode(), card = new FakeNode(), button = new FakeNode(card);
  const state = {
    React, TaskTimelineHoverCard: cardModule.TaskTimelineHoverCard, isTaskTimelineTooltip: cardModule.isTaskTimelineTooltip,
    Node: FakeNode, document, timelineTooltip: null, timelineDragRef: { current: null }, timelineDragSavingRef: { current: false },
    timelineTooltipHideTimerRef: { current: null }, timelineTooltipTriggerRef: { current: null }, timelineTooltipFocusRef: { current: null },
    timelineTooltipPointerRef: { current: null }, timelineTooltipCardRef: { current: card }, timelineScrollRef: { current: null },
    setTimelineTooltip(value) { state.timelineTooltip = value; },
    window: {
      setTimeout(fn, delay) { assert.equal(delay, 200); timers.set(++nextTimer, fn); return nextTimer; },
      clearTimeout(id) { timers.delete(id); },
      addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name); }
    }
  };
  const context = vm.createContext(state);
  vm.runInContext(compile(handlers.join("\n")), context);
  return {
    state, document, trigger, card, button, timers, listeners,
    props: (data = content) => state.timelineTooltipProps(data),
    enter(data = content, point = { clientX: 300, clientY: 250 }) { state.timelineTooltipProps(data).onPointerEnter({ currentTarget: trigger, pointerType: "mouse", ...point }); },
    cardProps() { return vm.runInContext(compile(`(${cardExpression});`), context).props; },
    effects() { return vm.runInContext(compile(`(${dismissEffect});`), context)(); },
    flush() { const pending = [...timers.values()]; timers.clear(); for (const fn of pending) fn(); }
  };
}

function nodes(tree, predicate) {
  const result = [];
  function visit(node) {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!React.isValidElement(node)) return;
    if (predicate(node)) result.push(node);
    visit(node.props.children);
  }
  visit(tree);
  return result;
}

function componentHarness(name, initialProps, clipboard = async () => {}, platform = "Win32") {
  const slots = [], effects = [], observers = [], timers = new Map();
  let cursor = 0, props = initialProps, rect = { width: 330, height: 250 }, nextTimer = 0, mounted = true, lateUpdates = 0;
  const selection = { text: "", removeAllRanges() { this.text = ""; }, addRange(range) { this.text = range.text; } };
  const hooks = {
    useState(initialValue) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initialValue === "function" ? initialValue() : initialValue;
      return [slots[index], value => {
        if (!mounted) lateUpdates++;
        slots[index] = typeof value === "function" ? value(slots[index]) : value;
      }];
    },
    useRef(initialValue) { const index = cursor++; return slots[index] ??= { current: initialValue }; },
    useEffect(fn, deps) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) effects.push(() => {
        previous?.cleanup?.(); slots[index] = { deps, cleanup: fn() };
      });
    }
  };
  hooks.useLayoutEffect = hooks.useEffect;
  const navigator = { platform, clipboard: { writeText: clipboard } };
  const module = loadCard(hooks, {
    navigator,
    window: {
      setTimeout(fn, delay) { timers.set(++nextTimer, { fn, delay }); return nextTimer; },
      clearTimeout(id) { timers.delete(id); }, getSelection: () => selection
    },
    document: {
      activeElement: {}, documentElement: { clientWidth: 1000, clientHeight: 800 },
      createRange: () => ({ text: "", selectNodeContents(target) { this.text = target.textContent; } })
    },
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() {} disconnect() { this.disconnected = true; }
    }
  });
  return {
    module, timers, selection, navigator,
    render(next = props) {
      props = next; cursor = 0;
      const tree = module[name](props);
      effects.splice(0).forEach(fn => fn());
      return tree;
    },
    flush(delay) {
      for (const [id, timer] of [...timers]) if (timer.delay <= delay) { timers.delete(id); timer.fn(); }
    },
    resize(next) { rect = next; observers.at(-1).callback(); },
    cardRef: { current: { getBoundingClientRect: () => rect } },
    unmount() { for (const slot of slots) slot?.cleanup?.(); mounted = false; },
    get lateUpdates() { return lateUpdates; },
    observers
  };
}
function cardHarness(initial = content) {
  const h = componentHarness("TaskTimelineHoverCard", null);
  let data = initial;
  const render = h.render;
  h.render = (next = data) => {
    data = next;
    return render({ content: data, cardRef: h.cardRef, onPointerEnter() {}, onPointerLeave() {}, onFocus() {}, onBlur() {} });
  };
  return h;
}
function buttonHarness(text = content.note, clipboard, platform = "Win32", field = "note") {
  const targetRef = { current: { textContent: text } };
  const h = componentHarness("TimelineHoverCopyButton", { field, text, targetRef }, clipboard, platform);
  const render = h.render;
  h.render = (next = text) => { text = next; targetRef.current.textContent = text; return render({ field, text, targetRef }); };
  h.button = () => nodes(h.render(), node => node.type === "button")[0];
  return h;
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test("task and recurring cards anchor at the initial pointer and do not override task dragging", () => {
  for (const kind of ["普通任务", "单日任务", "多日任务", "重复事项"]) {
    const h = tooltipHarness();
    h.enter({ ...content, kind });
    assert.deepEqual({ ...h.state.timelineTooltip.pointer }, { x: 300, y: 250 });
    assert.equal(h.props().onPointerMove, undefined);
    h.enter({ ...content, kind }, { clientX: 450, clientY: 400 });
    assert.deepEqual({ ...h.state.timelineTooltip.pointer }, { x: 300, y: 250 }, "an open card does not chase the pointer");
  }
  const h = tooltipHarness();
  h.props().onPointerEnter({ currentTarget: h.trigger, pointerType: "touch" });
  assert.equal(h.state.timelineTooltip, null);
  h.state.timelineDragRef.current = { active: true };
  h.enter();
  assert.equal(h.state.timelineTooltip, null);
});

test("leaving allows a 200ms crossing and entering the card cancels dismissal", () => {
  const h = tooltipHarness();
  h.enter();
  h.props().onPointerLeave();
  assert.equal(h.timers.size, 1);
  assert.ok(h.state.timelineTooltip);
  h.cardProps().onPointerEnter();
  assert.equal(h.timers.size, 0);
  h.flush();
  assert.ok(h.state.timelineTooltip);
  h.cardProps().onPointerLeave();
  h.flush();
  assert.equal(h.state.timelineTooltip, null);
});

test("focus inside either source or card keeps it open and keyboard can enter and escape", () => {
  const h = tooltipHarness();
  h.trigger.focus();
  h.props().onFocus({ currentTarget: h.trigger, target: h.trigger });
  assert.equal(h.state.timelineTooltip.pointer.x, h.trigger.rect.right);
  const cleanup = h.effects();
  let prevented = false, stopped = false;
  h.props().onKeyDown({ key: "ArrowDown", preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.ok(prevented && stopped);
  assert.equal(h.document.activeElement, h.card);
  h.props().onBlur({ currentTarget: h.trigger, relatedTarget: h.card });
  h.flush();
  assert.ok(h.state.timelineTooltip);
  h.button.focus();
  h.cardProps().onPointerLeave();
  h.flush();
  assert.ok(h.state.timelineTooltip, "copy-button focus survives pointer departure");
  h.listeners.get("keydown")({ key: "Escape", preventDefault() {} });
  assert.equal(h.document.activeElement, h.trigger);
  assert.equal(h.state.timelineTooltip, null);
  cleanup();
  assert.equal(h.listeners.size, 0);
  h.state.timelineTooltipCardRef.current = null;
  h.state.window.requestAnimationFrame = callback => {
    h.state.timelineTooltipCardRef.current = h.card;
    callback();
  };
  h.props().onKeyDown({ key: "ArrowDown", currentTarget: h.trigger, preventDefault() {}, stopPropagation() {} });
  assert.ok(h.state.timelineTooltip, "ArrowDown reopens after Escape without leaving the source");
  assert.equal(h.document.activeElement, h.card);
});

test("internal scrolling stays open, external scrolling and outside clicks close, cleanup clears timers", () => {
  for (const action of ["scroll", "pointerdown", "resize"]) {
    const h = tooltipHarness();
    h.enter();
    const cleanup = h.effects();
    h.listeners.get("scroll")({ target: h.button });
    assert.ok(h.state.timelineTooltip);
    h.listeners.get("pointerdown")({ target: h.button });
    assert.ok(h.state.timelineTooltip);
    h.listeners.get(action)({ target: h.document.body });
    assert.equal(h.state.timelineTooltip, null);
    h.state.scheduleTimelineTooltipHide();
    cleanup();
    assert.equal(h.timers.size, 0);
  }
});

test("cards fit viewport edges, narrow screens and actual measured sizes", () => {
  const position = cardModule.timelineHoverPosition;
  for (const viewport of [{ width: 1000, height: 800 }, { width: 360, height: 400 }]) {
    const size = { width: Math.min(330, viewport.width - 24), height: Math.min(320, viewport.height - 24) };
    for (const point of [{ x: 0, y: 0 }, { x: 350, y: 200 }, { x: viewport.width - 1, y: viewport.height - 1 }]) {
      const result = position(point, size, viewport);
      assert.ok(result.left >= 12 && result.top >= 12);
      assert.ok(result.left + size.width <= viewport.width - 12);
      assert.ok(result.top + size.height <= viewport.height - 12);
    }
  }
  assert.deepEqual({ ...position({ x: 100, y: 100 }, { width: 330, height: 250 }, { width: 1000, height: 800 }) }, { left: 112, top: 112 });
  const h = cardHarness();
  h.render();
  assert.equal(h.render().props.style.left, 212);
  h.resize({ width: 330, height: 700 });
  assert.equal(h.render().props.style.top, 12);
  h.unmount();
  assert.ok(h.observers.every(observer => observer.disconnected));
});

test("compact cards pass the full original URL and note to their independent copy controls", () => {
  const h = cardHarness();
  const tree = h.render();
  const controls = nodes(tree, node => node.type === h.module.TimelineHoverCopyButton);
  assert.equal(controls.length, 2);
  assert.equal(controls[0].props.text, content.url);
  assert.equal(controls[1].props.text, content.note);
  assert.equal(controls[0].props.field, "url");
  assert.equal(controls[1].props.field, "note");
  assert.equal(tree.props.role, "dialog");
  assert.equal(tree.props.tabIndex, -1);
  for (const [url, note, count] of [["", "", 0], [content.url, "", 1], ["", content.note, 1]]) {
    const empty = cardHarness({ ...content, url, note });
    assert.equal(nodes(empty.render(), node => node.type === empty.module.TimelineHoverCopyButton).length, count);
  }
  assert.doesNotMatch(cardText, /复制失败，请选择文本后手动复制|timeline-hover-feedback/);
});

test("copy controls show a delayed hint on pointer or keyboard focus and cancel it on departure", () => {
  const h = buttonHarness();
  let button = h.button();
  button.props.onPointerEnter();
  h.flush(299);
  assert.doesNotMatch(renderToStaticMarkup(h.render()), /复制到剪贴板/);
  h.flush(300);
  let html = renderToStaticMarkup(h.render());
  assert.match(html, /复制到剪贴板/);
  assert.match(html, /role="tooltip"/);
  assert.match(html, /aria-describedby="timeline-copy-note-hint"/);
  h.button().props.onPointerLeave();
  assert.doesNotMatch(renderToStaticMarkup(h.render()), /复制到剪贴板/);
  button = h.button();
  button.props.onFocus();
  button.props.onBlur();
  assert.equal(h.timers.size, 0);
  h.flush(300);
  assert.doesNotMatch(renderToStaticMarkup(h.render()), /复制到剪贴板/);
  h.button().props.onFocus();
  h.flush(300);
  assert.match(renderToStaticMarkup(h.render()), /复制到剪贴板/);
});

test("URL and note copy the complete text, show only an icon that turns into a check, then reset after 1.8s", async () => {
  const copied = [];
  const url = buttonHarness(content.url, async text => { copied.push(text); }, "Win32", "url");
  const note = buttonHarness(content.note, async text => { copied.push(text); });
  url.button().props.onClick();
  note.button().props.onClick();
  await tick();
  assert.deepEqual(copied, [content.url, content.note]);
  for (const h of [url, note]) {
    const html = renderToStaticMarkup(h.render());
    assert.match(html, /is-copied/);
    assert.match(html, /is-success/);
    assert.match(html, /aria-label="已复制"/);
    assert.doesNotMatch(html, />(?:已复制！|复制)</);
    assert.doesNotMatch(html, /role="tooltip"|timeline-hover-feedback|Toast/);
    assert.equal(h.timers.size, 1);
  }
  url.flush(1799);
  assert.match(renderToStaticMarkup(url.render()), /aria-label="已复制"/);
  url.flush(1800);
  assert.doesNotMatch(renderToStaticMarkup(url.render()), /aria-label="已复制"|is-copied|is-success/);
  assert.match(renderToStaticMarkup(note.render()), /aria-label="已复制"/);
  note.flush(1800);
  assert.doesNotMatch(renderToStaticMarkup(note.render()), /aria-label="已复制"/);
});

test("clipboard rejection selects the entire unabridged text and uses only a platform-specific shortcut bubble", async () => {
  for (const [platform, shortcut] of [["Win32", "Ctrl+C"], ["MacIntel", "Cmd+C"]]) {
    const h = buttonHarness(content.note, async () => { throw new Error("denied"); }, platform);
    h.button().props.onClick();
    await tick();
    assert.equal(h.selection.text, content.note);
    const tree = h.render(), html = renderToStaticMarkup(tree);
    const hint = nodes(tree, node => node.props.role === "tooltip")[0];
    assert.equal(hint.props.children, `复制失败，请按 ${shortcut} 完成复制`);
    assert.doesNotMatch(html, /role="alert"|<p\b|已复制|复制失败，请选择文本后手动复制/);
    h.button().props.onBlur();
    assert.doesNotMatch(renderToStaticMarkup(h.render()), /role="tooltip"/);
  }
  const h = buttonHarness(content.url);
  h.navigator.clipboard = undefined;
  h.button().props.onClick();
  await tick();
  assert.equal(h.selection.text, content.url);
});

test("late clipboard responses and timers cannot affect changed or unmounted controls", async () => {
  let resolve;
  const h = buttonHarness(content.note, () => new Promise(done => { resolve = done; }));
  h.button().props.onClick();
  h.render("另一任务的备注");
  resolve();
  await tick();
  assert.doesNotMatch(renderToStaticMarkup(h.render()), /已复制/);
  h.button().props.onClick();
  h.unmount();
  resolve();
  await tick();
  assert.equal(h.lateUpdates, 0);
  assert.equal(h.timers.size, 0);
  const hint = buttonHarness();
  hint.button().props.onPointerEnter();
  hint.unmount();
  assert.equal(hint.timers.size, 0);
  const success = buttonHarness();
  success.button().props.onClick();
  await tick();
  success.unmount();
  assert.equal(success.timers.size, 0);
});

test("compact card CSS truncates notes to three lines and keeps copy feedback subtle and motion-safe", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  assert.match(css, /\.timeline-hover-card\.interactive-hover-card \{[^}]*max-height: min\(320px,[^}]*pointer-events: auto;[^}]*user-select: text;/);
  assert.match(css, /\.timeline-hover-url \{[^}]*overflow: hidden;[^}]*-webkit-line-clamp: 2;/);
  assert.match(css, /\.interactive-hover-card \.timeline-hover-note \{ -webkit-line-clamp: 3;/);
  assert.doesNotMatch(css, /\.interactive-hover-card :is\(\.timeline-hover-url, \.timeline-hover-note\)[^}]*unset/);
  assert.match(css, /\.timeline-copy-control > \.timeline-hover-copy \{[^}]*width: 28px;[^}]*min-width: 28px;[^}]*cursor: pointer/);
  assert.match(css, /\.timeline-copy-icon\.is-success \{ animation: timeline-copy-pop/);
  assert.match(css, /prefers-reduced-motion: reduce[^}]*\.timeline-copy-icon\.is-success \{ animation: none/);
});

test("recurring save stages scope confirmation without success toast and retains target lookup errors", async () => {
  for (const fail of [false, true]) {
    const feedback = [], target = { id: "next", occurrence_date: "2026-10-26" };
    const state = {
      selectedRecurringItem: { id: "recurring" }, busy: false, recurringTargetLoading: false, recurringTarget: target, recurringForm: { title: "事项", display_time: "09:00", display_duration_minutes: 30 },
      setBusy(value) { state.busy = value; }, setFeedback: value => feedback.push(value),
      resolveRecurringEditTarget: async () => { if (fail) throw new Error("读取失败"); return target; },
      recurringChangeIssue: () => null, shanghaiDateValue: () => "2026-10-25",
      setRecurringScopeError() {}, setPendingItemChange(value) { state.pending = value; },
      recurringItemInputForForm: value => value, uiErrorMessage: error => error.message
    };
    vm.runInNewContext(compile(saveHandler), state);
    await state.saveRecurringItem();
    assert.equal(state.busy, false);
    if (fail) assert.equal(feedback.at(-1), "无法保存：读取失败");
    else { assert.equal(state.pending.occurrence.id, "next"); assert.equal(feedback.length, 0); }
    assert.ok(feedback.every(value => !value.includes("重复事项已保存")));
  }
});

test("task hover cards receive every tag without truncating the source data", () => {
  const tags = ["工作", "设计", "本周", "第四个标签"];
  const h = componentHarness("TaskTimelineHoverCard", { content: { ...content, tags }, cardRef: { current: null }, onPointerEnter() {}, onPointerLeave() {}, onFocus() {}, onBlur() {} });
  const tree = h.render();
  const tagList = nodes(tree, node => node.props.tags === tags)[0];
  assert.equal(tagList.props.expanded, true);
  assert.match(renderToStaticMarkup(tree), /工作、设计、本周、第四个标签/);
});
