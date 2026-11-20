import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const asset = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const app = asset("./App.tsx");
const styles = asset("./styles.css");
const colors = asset("./color-system.css");
const brand = asset("./logo.tsx");

test("prototype sidebar uses 236px expanded and preserves the saved 52px collapsed rail", () => {
  assert.doesNotMatch(app, /ShellResizeSession|shellResize|resizingShell|sidebarWidth|shell_sidebar_width|shell-resize-handle/);
  assert.match(app, /className="shell-divider" aria-hidden="true"/);
  assert.match(colors, /\.next-shell \{ --sidebar-width: 236px/);
  assert.match(colors, /\.next-shell\.sidebar-collapsed \{ --sidebar-width: 52px/);
  assert.match(styles, /grid-template-columns: var\(--sidebar-width\) 1px minmax\(0, 1fr\)/);
  assert.match(app, /setUiSetting\(SHELL_SIDEBAR_COLLAPSED_SETTING, String\(nextCollapsed\)\)/);
});

test("brand lives once in the integrated 42px topbar, not in the collapsible sidebar", () => {
  const titlebar = asset("./app-titlebar.tsx");
  const chrome = asset("./app-titlebar.css");
  assert.match(titlebar, /<ProductBrand \/>/);
  assert.doesNotMatch(app, /<ProductBrand/);
  assert.match(app, /<AppTitlebar viewSlotRef=\{setHeaderViewSlot\} onError=\{notifyWindowError\}/);
  assert.doesNotMatch(app, /calendarSlotRef|setHeaderCalendarSlot/);
  assert.match(brand, /<h1 className="product-brand-name">今序<CopySeparator \/><span lang="en">Dayweave<\/span><\/h1>/);
  assert.doesNotMatch(brand, /product-brand-copy/);
  assert.match(chrome, /--app-titlebar-height: 42px/);
  assert.match(chrome, /\.app-titlebar \.product-brand-name \{[^}]*font: 600 13px\/18px var\(--jx-font-sans\)/);
  assert.match(chrome, /\.app-titlebar \.product-brand-logo \{[^}]*width: 24px; height: 24px/);
  assert.match(brand, /from "\.\/assets\/logo-light\.svg"/);
});

test("sidebar groups use protected navigation and place settings and collapse toggle in the bottom bar", () => {
  const sidebar = app.match(/<aside id="main-sidebar"[\s\S]*?<\/aside>/)?.[0];
  assert.ok(sidebar);
  assert.match(sidebar, /日程视图[\s\S]*今日安排[\s\S]*任务管理[\s\S]*全部任务/);
  assert.match(sidebar, /requestNavigation\(\{ active: "任务", taskView: "all" \}\)/);
  assert.match(sidebar, /requestNavigation\(\{ active: "任务", taskView \}\)/);
  assert.match(sidebar, /sidebar-footer-group[\s\S]*sidebar-summary-card[\s\S]*sidebar-bottom-bar[\s\S]*setSettingsOpen\(true\)[\s\S]*shell-collapse-button/);
  assert.doesNotMatch(app.replace(sidebar, ""), /shell-collapse-button/);
  assert.doesNotMatch(sidebar, /next-create|记一件事/);
  const sidebarOrder = app.match(/const sidebarTaskViews[^=]*=\s*\[([\s\S]*?)\];/)?.[1] ?? "";
  const labels = [...sidebarOrder.matchAll(/label:\s*"([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(labels, ["进行中", "草稿箱", "重复规则", "待安排", "未完成", "已完成", "回收站"]);
  assert.doesNotMatch(colors, /\.sidebar-collapsed \.next-sidebar :is\([^)]*\.sidebar-footer-group\)/);
  assert.doesNotMatch(colors, /nav > \.sidebar-task-views \{[^}]*border: 0;/);
  assert.match(colors, /nav > \.sidebar-task-views \{[^}]*border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0;/);
  assert.match(colors, /@media \(max-width: 860px\)[\s\S]*?\.next-sidebar \.shell-collapse-button \{ display: none; \}/);
});
