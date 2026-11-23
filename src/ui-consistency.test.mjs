import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const appText = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const appTitlebarText = readFileSync(new URL("./app-titlebar.tsx", import.meta.url), "utf8");
const stylesCss = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const colorSystemCss = readFileSync(new URL("./color-system.css", import.meta.url), "utf8");
const createCss = readFileSync(new URL("./timeline-task-create.css", import.meta.url), "utf8");
const weekCss = readFileSync(new URL("./week-timeline.css", import.meta.url), "utf8");
const tagsCss = readFileSync(new URL("./task-tags.css", import.meta.url), "utf8");
const settingsCss = readFileSync(new URL("./settings-dialog.css", import.meta.url), "utf8");
const tagEditorText = readFileSync(new URL("./task-tag-editor.tsx", import.meta.url), "utf8");

const source = ts.createSourceFile("App.tsx", appText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const compile = (code) => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;

test("Ctrl+N shortcut opens task creation cleanly across views and guards modals, repeats, and browser defaults", () => {
  let shortcutEffect = null;
  let shortcutAction = null;
  function walk(node) {
    if (ts.isBinaryExpression(node) && node.left.getText(source) === "createShortcutActionRef.current") {
      shortcutAction = node.right.getText(source);
    }
    if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" && node.arguments[0]?.getText(source).includes("handleCreateShortcut")) {
      shortcutEffect = node.arguments[0].getText(source);
    }
    ts.forEachChild(node, walk);
  }
  walk(source);
  assert.ok(shortcutEffect, "missing global Ctrl+N effect");
  assert.ok(shortcutAction, "missing createShortcutActionRef assignment");

  const host = new EventTarget();
  const navigations = [];
  let modalOpen = null;
  const state = {
    window: host,
    document: { querySelector: () => modalOpen },
    settingsOpen: false,
    pendingPlanLeave: null,
    pendingNavigation: null,
    createShortcutActionRef: { current: () => {} },
    requestNavigation: (intent) => navigations.push(intent)
  };
  const ctx = vm.createContext(state);
  state.createShortcutActionRef.current = vm.runInContext(compile(`(${shortcutAction})`), ctx);
  const cleanup = vm.runInContext(compile(`((${shortcutEffect})())`), ctx);

  function press(key = "n", overrides = {}) {
    const event = new Event("keydown", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "key", { value: key });
    Object.assign(event, { ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, isComposing: false, repeat: false, ...overrides });
    host.dispatchEvent(event);
    return event;
  }

  const normal = press("n");
  assert.equal(normal.defaultPrevented, true);
  assert.deepEqual(JSON.parse(JSON.stringify(navigations)), [{ active: "任务", createTask: true }]);

  const macCmd = press("N", { ctrlKey: false, metaKey: true });
  assert.equal(macCmd.defaultPrevented, true);
  assert.equal(navigations.length, 2);

  for (const blocked of [{ repeat: true }, { shiftKey: true }, { altKey: true }, { isComposing: true }]) {
    press("n", blocked);
  }
  assert.equal(navigations.length, 2, "modifiers, repeats, and IME composing must not retrigger");

  state.settingsOpen = true;
  const inSettings = press("n");
  assert.equal(inSettings.defaultPrevented, true, "WebView default Ctrl+N still prevented inside Settings");
  assert.equal(navigations.length, 2);
  state.settingsOpen = false;

  modalOpen = {};
  const inDialog = press("n");
  assert.equal(inDialog.defaultPrevented, true);
  assert.equal(navigations.length, 2);
  modalOpen = null;

  assert.match(appTitlebarText, /title="新建安排 \(Ctrl\+N\)" aria-keyshortcuts="Control\+N"/);
  assert.doesNotMatch(appTitlebarText, /<kbd\b/);
  cleanup();
});

test("Phase 1 removes light backdrop blur, black/pill footer buttons, and oversized modal close buttons", () => {
  assert.doesNotMatch(stylesCss, /\.schedule-picker-backdrop\s*\{[^}]*backdrop-filter:\s*blur/);
  assert.doesNotMatch(stylesCss, /\.timeline-floating-layer\.is-time-editor,\s*\.timeline-floating-layer\.is-block-editor\s*\{[^}]*backdrop-filter:\s*blur/);
  assert.match(colorSystemCss, /html:root:not\(\[data-mode="dark"\]\) :is\(\.dialog-backdrop, \.schedule-picker-backdrop, \.task-completion-backdrop, \.timeline-floating-layer:is\(\.is-time-editor, \.is-block-editor\)\) \{ background: rgb\(20 38 61 \/ 20%\); \}/);
  assert.match(createCss, /html:root:not\(\[data-mode="dark"\]\) \.selection-create-dialog::backdrop \{\s*background: rgb\(20 38 61 \/ 20%\);/);
  assert.match(weekCss, /\.week-timeline-details::backdrop \{ background: rgb\(20 38 61 \/ 20%\); \}/);

  assert.doesNotMatch(stylesCss, /\.plan-draft-time-form > footer \.primary-action \{[^}]*#0f172a/);
  assert.doesNotMatch(stylesCss, /\.plan-draft-time-form > footer \.quiet-button,\s*\.plan-draft-time-form > footer \.primary-action \{[^}]*999px/);
  assert.doesNotMatch(stylesCss, /\.schedule-picker-footer \.secondary-action, \.schedule-picker-confirm \{[^}]*border-radius: 999px/);
  assert.match(stylesCss, /\.timeline-floating-panel\.task-block-editor > \.execution-capture-footer \.primary-action \{[^}]*var\(--color-primary/);
  assert.match(stylesCss, /\.completed-record-footer \.quiet-button \{[^}]*min-height: 34px;[^}]*border-radius: 8px;[^}]*font-size: 13px;/);

  for (const [label, css, pattern] of [
    ["timeline floating close", stylesCss, /\.timeline-floating-panel > header > button \{[^}]*width: 30px; height: 30px;[^}]*border-radius: 7px;/],
    ["completed block close", stylesCss, /\.completed-record:not\(\[hidden\]\)\) > header > button \{[^}]*width: 30px; height: 30px;[^}]*border-radius: 7px;/],
    ["schedule picker close", stylesCss, /\.schedule-picker-close \{[^}]*width: 30px; height: 30px;[^}]*border-radius: 7px;/],
    ["selection create close", createCss, /\.selection-close-btn \{[^}]*width: 30px;\s*height: 30px;[^}]*border-radius: 7px;/s],
    ["week timeline close", weekCss, /\.week-timeline-details \.detail-close \{[^}]*width: 30px; height: 30px;[^}]*border-radius: 7px;/]
  ]) {
    assert.match(css, pattern, label);
  }

  assert.match(appText, /closeOnEscape[\s\S]*event\.key === "Tab"/);
  assert.match(appText, /onMouseDown=\{\(event\) => \{ if \(event\.target === event\.currentTarget && \(planDraftTimeEdit \|\| selectedBlock \|\| selectedRecurringOccurrence\)\) closeTimelinePanel\(\); \}\}/);
  assert.match(appText, /if \(!timelinePanelModal \|\| !panel/);
});

test("Phase 2 unifies desktop dropdown density, SVG clear icons, Toast typography, and light tokens", () => {
  assert.match(tagsCss, /\.task-tag-option \{[^}]*min-height: 32px;[^}]*font-size: 12\.5px;/);
  assert.match(stylesCss, /\.priority-dropdown-option \{[^}]*min-height: 32px;[^}]*font-size: 12\.5px;/s);
  assert.match(tagEditorText, /aria-label="关闭标签选择" onClick=\{\(\) => close\(true\)\}><svg /);
  assert.doesNotMatch(tagEditorText, /className="task-filter-clear"[\s\S]*?>×</);
  assert.match(appText, /className="task-filter-clear"[\s\S]*?><Icon name="close" size=\{11\} \/><\/button>/);
  assert.match(settingsCss, /\.settings-dialog \.settings-feedback-viewport \.feedback-toast-content \{ font-size: 13\.5px;/);
  assert.match(colorSystemCss, /html:root:not\(\[data-mode="dark"\]\) \.ledger-empty svg/);
  assert.match(colorSystemCss, /html:root:not\(\[data-mode="dark"\]\) \.ledger-quick-action\.icon-only::after \{[^}]*background: #0f172a;/);
  assert.match(colorSystemCss, /html:root:not\(\[data-mode="dark"\]\) \.plan-draft-mode/);
  assert.doesNotMatch(stylesCss, /\.plan-draft-edit-error \{[^}]*#884d4d/);
});

test("Phase 3 fixes recurring copy consistency and removes dead ReviewPage / recurring-modal artifacts", () => {
  assert.match(appText, /recurring \? \(editing \? "编辑重复事项" : "重复事项详情"\) : \(editing \? "编辑任务" : "任务详情"\)/);
  assert.match(appText, /<button type="button" className="secondary-action" disabled=\{busy\} onClick=\{onEdit\}><Icon name="file" size=\{14\} \/>编辑事项<\/button>/);
  assert.doesNotMatch(appText, /确认创建任务|确认修改任务/);
  assert.equal(existsSync(new URL("./review-page.tsx", import.meta.url)), false);
  assert.equal(existsSync(new URL("./review-close.ts", import.meta.url)), false);
  assert.doesNotMatch(stylesCss, /(?:^|\n)\.(?:plan-action-tooltip|recurring-modal-backdrop|recurring-event-modal)\b|\.today-workspace > \.review-page/);
  assert.doesNotMatch(colorSystemCss, /recurring-modal-backdrop|recurring-event-modal|\.review-page/);
});
