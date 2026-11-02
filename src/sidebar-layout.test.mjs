import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const asset = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const app = asset("./App.tsx");
const styles = asset("./styles.css");
const brand = asset("./logo.tsx");

test("sidebar uses a responsive proportion without draggable or saved width controls", () => {
  assert.doesNotMatch(app, /ShellResizeSession|shellResize|resizingShell|sidebarWidth|shell_sidebar_width|shell-resize-handle/);
  assert.match(app, /className="shell-divider" aria-hidden="true"/);
  assert.match(styles, /\.next-shell \{[^}]*--sidebar-width: max\(252px, 18vw\);[^}]*grid-template-columns: var\(--sidebar-width\) 1px minmax\(0, 1fr\)/);
  assert.match(styles, /\.next-shell\.sidebar-collapsed \{[^}]*--sidebar-width: 52px/);
  assert.match(app, /setUiSetting\(SHELL_SIDEBAR_COLLAPSED_SETTING, String\(nextCollapsed\)\)/);
});

test("brand lives once in the integrated topbar, not in the collapsible sidebar", () => {
  const titlebar = asset("./app-titlebar.tsx");
  assert.match(titlebar, /<ProductBrand weekLabel=\{weekLabel\} \/>/);
  assert.doesNotMatch(app, /<ProductBrand/);
  assert.match(app, /<AppTitlebar viewSlotRef=\{setHeaderViewSlot\} onError=\{notifyWindowError\}/);
  assert.doesNotMatch(app, /calendarSlotRef|setHeaderCalendarSlot/);
  assert.match(brand, /<h1 className="product-brand-name">今序<CopySeparator \/>dayweave<\/h1>/);
  assert.match(brand, /<p className="product-brand-copy"><span className="product-brand-chinese">让今天，井然有序<\/span><CopySeparator \/>/);
  assert.match(brand, /lang="en">Bring order to your day\./);
});

test("integrated brand uses one subdued bilingual subtitle and the original logo", () => {
  const chrome = asset("./app-titlebar.css");
  assert.match(chrome, /\.app-titlebar \.product-brand-name \{[^}]*font: 650 15px\/18px var\(--jx-font-sans\)/);
  assert.match(chrome, /\.app-titlebar \.product-brand-copy \{[^}]*color: var\(--color-muted\); font: 400 12px\/16px/);
  assert.match(chrome, /\.app-titlebar \.product-brand-logo \{[^}]*width: 44px; height: 44px/);
  assert.match(brand, /from "\.\/assets\/logo-light\.svg"/);
});

test("create and navigation actions share an intermediate width without changing the collapsed icon rail", () => {
  assert.match(styles, /\.next-sidebar \.sidebar-brand, \.next-sidebar \.next-create, \.next-sidebar nav \{ width: calc\(100% - 10px\); max-width: 280px; align-self: center/);
  assert.match(styles, /\.sidebar-collapsed \.next-sidebar \.next-create \{[^}]*width: 40px/);
  assert.match(styles, /\.sidebar-collapsed \.next-sidebar nav \{[^}]*width: 100%/);
  assert.match(styles, /\.sidebar-collapsed \.sidebar-nav-selection \{[^}]*width: 40px/);
});

test("create action is a compact flat button while navigation keeps the 52px step", () => {
  assert.match(styles, /--sidebar-action-height: 52px/);
  assert.match(styles, /\.next-sidebar \.next-create \{[^}]*height: 40px; min-height: 40px/);
  assert.match(styles, /\.next-sidebar nav \{ --sidebar-nav-height: var\(--sidebar-action-height\); --sidebar-nav-step: calc\(var\(--sidebar-nav-height\) \+ 8px\)/);
  assert.match(styles, /\.sidebar-collapsed \.next-sidebar \.next-create \{[^}]*height: 44px; min-height: 44px/);
});

test("create action uses the approved green palette with flat styling in both themes", () => {
  assert.match(styles, /\.next-sidebar \{ --sidebar-create-bg: #1B633E; --sidebar-create-ink: #f2f6f2;/);
  assert.match(styles, /html\[data-mode="dark"\] \.next-sidebar \{ --sidebar-create-bg: #228452; --sidebar-create-hover: #1B633E; background: #181a18; \}/);
  assert.match(styles, /\.next-sidebar \.next-create \{[^}]*border: 0; border-radius: 11px/);
  assert.match(styles, /\.next-create > \.sidebar-create-icon \{[^}]*filter: brightness\(0\) invert\(1\)/);
});

test("sidebar tabs use compact 13px labels and a quieter selected weight", () => {
  assert.match(styles, /\.next-sidebar nav button > \.nav-copy strong \{ color: inherit !important; font: 500 13px\/1\.4 var\(--jx-font-sans\); white-space: nowrap; \}/);
  assert.match(styles, /\.next-sidebar nav button\.active > \.nav-copy strong \{ font-weight: 600; \}/);
});
