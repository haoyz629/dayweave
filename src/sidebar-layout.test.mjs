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

test("sidebar matches the visible square logo to the three-line text height", () => {
  assert.match(brand, /<h1 className="product-brand-name">今序 · Dayweave<\/h1>/);
  assert.doesNotMatch(brand, /brand-wordmark\.svg/);
  assert.match(styles, /\.product-brand-logo \{ width: var\(--product-brand-height\); height: var\(--product-brand-height\)/);
  assert.match(styles, /--product-brand-height: calc\(1\.2 \* var\(--product-brand-name-size\) \+ 32\.9 \* var\(--brand-unit\) \+ 2 \* var\(--product-brand-copy-gap\)\)/);
  assert.match(styles, /\.product-brand-logo img \{ position: absolute; width: 116\.363636%; height: 116\.363636%;[^}]*left: -8\.181818%; top: -5%/);
  assert.match(styles, /\.product-brand-text \{ min-width: 0; padding: 0; \}/);
  assert.match(styles, /\.product-brand-heading \{ display: grid; grid-template-columns: max-content max-content;[^}]*gap: calc\(10 \* var\(--brand-unit\)\);[^}]*width: max-content;[^}]*margin-inline: auto/);
  assert.doesNotMatch(styles, /product-brand-text \{[^}]*justify-self: end/);
  assert.match(styles, /\.product-brand-logo \{[^}]*justify-self: center/);
  assert.match(styles, /--brand-unit: clamp\(1px, \.46728972cqw, 1\.30841122px\)/);
});

test("brand uses the approved geometric sans typography and slate hierarchy", () => {
  assert.match(styles, /--product-brand-font: 'Inter', 'PingFang SC', MiSans, 'HarmonyOS Sans SC', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif/);
  assert.match(styles, /--product-brand-name-size: calc\(17\.5 \* var\(--brand-unit\)\)/);
  assert.match(styles, /\.product-brand-name \{[^}]*color: #1e293b; font: 700 var\(--product-brand-name-size\)\/1\.2 var\(--product-brand-font\); letter-spacing: -\.02em/);
  assert.match(styles, /\.product-brand-chinese \{[^}]*color: #475569; font: 500 calc\(12\.5 \* var\(--brand-unit\)\)\/1\.4 var\(--product-brand-font\); letter-spacing: \.04em/);
  assert.match(styles, /\.product-brand-english \{ margin: var\(--product-brand-copy-gap\) 0 0; color: #64748b; font: 400 calc\(11 \* var\(--brand-unit\)\)\/1\.4 var\(--product-brand-font\); letter-spacing: \.01em/);
  for (const [line, color] of [["name", "#e2e8f0"], ["chinese", "#b4c0d0"], ["english", "#94a3b8"]]) {
    const priority = line === "name" ? " !important" : "";
    assert(styles.includes(`html[data-mode="dark"] .next-sidebar .product-brand-${line} { color: ${color}${priority}; }`));
  }
});

test("sidebar keeps the full logo canvas and left-aligns the brand without changing collapsed icons", () => {
  assert.match(styles, /\.next-sidebar \.sidebar-brand \{[^}]*align-items: center;[^}]*text-align: left/);
  assert.match(styles, /\.product-brand-logo > \.dayweave-logo \{ width: 100%; height: 100%; \}/);
  assert.match(styles, /\.sidebar-collapsed \.next-sidebar \.sidebar-brand \{ width: 100%; max-width: none; align-items: center/);
  assert.match(styles, /\.sidebar-collapsed \.next-sidebar \.product-brand-logo > \.dayweave-logo \{ position: static; width: 100%; height: 100%/);
  assert.match(styles, /\.sidebar-collapsed \.next-sidebar \.product-brand-logo img \{ position: static; width: 100%; height: 100%; \}/);
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
