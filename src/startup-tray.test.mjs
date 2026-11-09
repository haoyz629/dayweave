import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("startup shows the existing brand and a quiet accessible loading state, not developer instructions", () => {
  const html = read("index.html");
  assert.match(html, /class="startup" aria-labelledby="startup-title" aria-busy="true"/);
  assert.match(html, /src="\/src\/assets\/logo-light.svg" alt="" width="64" height="64"/);
  assert.match(html, /role="status"[\s\S]*正在打开今序…/);
  assert.match(html, /Bring order to your day\./);
  assert.match(html, /让今天，井然有序。/);
  assert.match(html, /prefers-reduced-motion: reduce/);
  assert.match(html, /<noscript>/);
  assert.doesNotMatch(html, /npm run|双击 HTML|Rust 后端|启动.*安装包|min-width: 720px/);
});

test("tray setup and refreshes use the fine-framed D/W, leaving window artwork intact", () => {
  const rust = read("src-tauri/src/lib.rs");
  assert.match(rust, /fn tray_logo\(\)[\s\S]*include_bytes!\("\.\.\/icons\/tray\.rgba"\), 32, 32/);
  assert.match(rust, /TrayIconBuilder::with_id\("main-tray"\)\s*\.icon\(tray_logo\(\)\)/);
  assert.match(rust, /tray\.set_icon\(Some\(tray_logo\(\)\)\)/);
  assert.match(rust, /window\.set_icon\(icon.clone\(\)\)/);
  const svg = read("src-tauri/icons/tray.svg");
  assert.match(svg, /viewBox="0 0 16 16"/);
  assert.match(svg, /<rect[^>]*rx="3"[^>]*fill="#e8eaed"[^>]*stroke="#42453f"[^>]*stroke-width="\.6"/);
  assert.match(svg, /<path[^>]*fill="#262825"[^>]*fill-rule="evenodd"/);
  assert.doesNotMatch(svg, /<filter|<image|Gradient/);
});
