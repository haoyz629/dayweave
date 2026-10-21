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

test("sidebar balances the supplied SVG logo beside the larger three-line wordmark", () => {
  assert.match(brand, /<h1 className="product-brand-name">今序 · Dayweave<\/h1>/);
  assert.doesNotMatch(brand, /brand-wordmark\.svg/);
  assert.match(styles, /\.product-brand-logo \{ width: calc\(56 \* var\(--brand-unit\)\); height: calc\(56 \* var\(--brand-unit\)\)/);
  assert.match(styles, /\.product-brand-heading \{ display: grid; grid-template-columns: max-content max-content;[^}]*gap: calc\(10 \* var\(--brand-unit\)\);[^}]*width: max-content;[^}]*margin-inline: auto/);
  assert.doesNotMatch(styles, /product-brand-text \{[^}]*justify-self: end/);
  assert.match(styles, /\.product-brand-logo \{[^}]*justify-self: center/);
  assert.match(styles, /--brand-unit: clamp\(1px, \.46728972cqw, 1\.30841122px\)/);
});

test("sidebar keeps the full logo canvas and left-aligns the brand without changing collapsed icons", () => {
  assert.match(styles, /\.next-sidebar \.sidebar-brand \{[^}]*align-items: center;[^}]*text-align: left/);
  assert.match(styles, /\.product-brand-logo > \.dayweave-logo \{ width: 100%; height: 100%; \}/);
  assert.match(styles, /\.sidebar-collapsed \.next-sidebar \.sidebar-brand \{ width: 100%; max-width: none; align-items: center/);
  assert.match(styles, /\.sidebar-collapsed \.next-sidebar \.product-brand-logo > \.dayweave-logo \{ position: static; width: 100%; height: 100%/);
});

test("create and navigation actions share an intermediate width without changing the collapsed icon rail", () => {
  assert.match(styles, /\.next-sidebar \.sidebar-brand, \.next-sidebar \.next-create, \.next-sidebar nav \{ width: calc\(100% - 10px\); max-width: 280px; align-self: center/);
  assert.match(styles, /\.sidebar-collapsed \.next-sidebar \.next-create \{[^}]*width: 40px/);
  assert.match(styles, /\.sidebar-collapsed \.next-sidebar nav \{[^}]*width: 100%/);
  assert.match(styles, /\.sidebar-collapsed \.sidebar-nav-selection \{[^}]*width: 40px/);
});

test("create and navigation buttons share the 52px midpoint height and matching selection step", () => {
  assert.match(styles, /--sidebar-action-height: 52px/);
  assert.match(styles, /\.next-sidebar \.next-create \{[^}]*height: var\(--sidebar-action-height\); min-height: var\(--sidebar-action-height\)/);
  assert.match(styles, /\.next-sidebar nav \{ --sidebar-nav-height: var\(--sidebar-action-height\); --sidebar-nav-step: calc\(var\(--sidebar-nav-height\) \+ 8px\)/);
  assert.match(styles, /\.sidebar-collapsed \.next-sidebar \.next-create \{[^}]*height: 44px; min-height: 44px/);
});

test("create action uses the approved green palette and white icon in both themes", () => {
  assert.match(styles, /\.next-sidebar \{ --sidebar-create-bg: #1B633E; --sidebar-create-ink: #fff;/);
  assert.match(styles, /html\[data-mode="dark"\] \.next-sidebar \{ --sidebar-create-bg: #228452;/);
  assert.match(styles, /\.next-sidebar \.next-create \{[^}]*border: 1px solid #145032;/);
  assert.match(styles, /html\[data-mode="dark"\] \.next-sidebar \.next-create \{ border-color: #34A86A; box-shadow: 0 3px 14px rgba\(34,132,82,0\.36\);/);
  assert.match(styles, /\.next-create > \.sidebar-create-icon \{[^}]*filter: brightness\(0\) invert\(1\)/);
});

test("sidebar tabs use compact 13px labels and a quieter selected weight", () => {
  assert.match(styles, /\.next-sidebar nav button > \.nav-copy strong \{ color: inherit !important; font: 500 13px\/1\.4 var\(--jx-font-sans\); white-space: nowrap; \}/);
  assert.match(styles, /\.next-sidebar nav button\.active > \.nav-copy strong \{ font-weight: 600; \}/);
});
