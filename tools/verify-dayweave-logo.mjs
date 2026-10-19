import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createLogoSvg, logoSourceInfo } from "./generate-dayweave-logo.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.DAYWEAVE_PLAYWRIGHT_PATH || "playwright");
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.env.DAYWEAVE_LOGO_TEST_PORT || 1421), base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [path.join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: root, stdio: "pipe" });
let serverLog = "", browser;
server.stdout.on("data", data => { serverLog += data; });
server.stderr.on("data", data => { serverLog += data; });
server.on("error", error => { serverLog += error.message; });
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Preview server exited: ${serverLog}`);
    try { ready = (await fetch(base)).ok; } catch { /* wait for this test's server */ }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(ready, `Preview server did not start: ${serverLog}`);
  browser = await chromium.launch({ headless: true, ...(process.env.DAYWEAVE_BROWSER_PATH ? { executablePath: process.env.DAYWEAVE_BROWSER_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1200, height: 960 }, reducedMotion: "reduce" });
  const errors = [], checks = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto(`${base}/design-references/dayweave-logo/index.html`);
  await page.locator(".dw-hero img:visible").first().waitFor();
  const original = await readFile(path.join(root, "design-references/dayweave-logo/source-logo.svg"), "utf8");
  const { renders, geometry } = await page.evaluate(async ({ original, production, legacyDark }) => {
    async function render(svg, size) {
      const xml = new DOMParser().parseFromString(svg, "image/svg+xml");
      if (xml.querySelector("parsererror")) throw new Error("Invalid SVG XML");
      const image = new Image(); image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = size;
      const context = canvas.getContext("2d"); context.drawImage(image, 0, 0, size, size);
      return context.getImageData(0, 0, size, size).data;
    }
    const results = [];
    for (const size of [16, 24, 32, 48, 128, 256]) {
      const a = await render(original, size), b = await render(production, size), c = await render(legacyDark, size);
      let changedPixels = 0, themeDifferences = 0, visiblePixels = 0;
      for (let i = 0; i < a.length; i += 4) {
        if ([0, 1, 2, 3].some(channel => a[i + channel] !== b[i + channel])) changedPixels++;
        if ([0, 1, 2, 3].some(channel => b[i + channel] !== c[i + channel])) themeDifferences++;
        if (b[i + 3] > 0) visiblePixels++;
      }
      results.push({ size, changedPixels, themeDifferences, visiblePixels, cornerAlpha: b[3] });
    }
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-9999px;visibility:hidden'; host.innerHTML = production; document.body.append(host);
    let measured;
    try {
      const svg = host.querySelector('svg'), v = svg.viewBox.baseVal;
      const box = selector => { const b = host.querySelector(selector).getBBox(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
      measured = { viewBox: [v.x, v.y, v.width, v.height], panel: box('#panelShape'), d: box('#dShape'), ribbon: box('#ribbon') };
      const mark = host.querySelector('#centeredMark'), bounds = mark.getBBox();
      const center = new DOMPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2).matrixTransform(mark.transform.baseVal.consolidate().matrix);
      measured.markCenter = { x: center.x, y: center.y };
      const ribbon = host.querySelector('#raisedRibbon'), ribbonBounds = ribbon.getBBox();
      const ribbonCenter = new DOMPoint(ribbonBounds.x + ribbonBounds.width / 2, ribbonBounds.y + ribbonBounds.height / 2)
        .matrixTransform(ribbon.transform.baseVal.consolidate().matrix)
        .matrixTransform(mark.transform.baseVal.consolidate().matrix);
      measured.ribbonCenterY = ribbonCenter.y;
      measured.dCenterY = measured.d.y + measured.d.height / 2 + mark.transform.baseVal.consolidate().matrix.f;
    } finally { host.remove(); }
    return { renders: results, geometry: measured };
  }, { original, production: createLogoSvg("light"), legacyDark: createLogoSvg("dark") });
  assert.deepEqual(geometry.viewBox, [-44, 10, 1024, 1024]);
  assert.deepEqual(geometry.markCenter, { x: 468, y: 522 }, 'W/D combined outline is centered in the SVG canvas');
  assert.equal(geometry.ribbonCenterY, geometry.dCenterY - 30, 'W is optically raised 30 units above D center');
  for (const result of renders) {
    assert.equal(result.changedPixels, 0, `${result.size}px matches the user SVG exactly`);
    assert.equal(result.themeDifferences, 0, `${result.size}px themes share the exact image`);
    assert(result.visiblePixels > 0); assert.equal(result.cornerAlpha, 0);
  }
  checks.push("16/24/32/48/128/256px: production and original user SVG render identical pixels, with identical light/dark theme content and transparent exterior");
  checks.push("Light panel, midnight D and blue W palette applied; original paths and confirmed placement retained, with W 30 units above D center");
  for (const theme of ["default", "github", "codex"]) {
    await page.getByRole("combobox", { name: "主题", exact: true }).selectOption(theme);
    for (const mode of ["light", "dark"]) {
      await page.getByRole("combobox", { name: "明暗模式", exact: true }).selectOption(mode);
      await page.waitForFunction(({ theme, mode }) => document.documentElement.dataset.theme === theme && document.documentElement.dataset.mode === mode, { theme, mode });
      for (const background of ["light", "dark"]) {
        const panel = page.locator(`[data-variant="${background}"]`);
        assert.equal(await panel.locator('.dayweave-logo-light:visible').count(), 6);
        assert.equal(await panel.locator('.dayweave-logo-dark').count(), 0);
      }
      assert(await page.locator('.dayweave-logo img:visible').evaluateAll(images => images.every(image => image.complete && image.naturalWidth === 1024 && image.naturalHeight === 1024 && image.src.includes('logo-light'))));
      for (const selector of [".dw-live .brand-mark", ".dw-live .assistant-orb"]) assert.equal(await page.locator(selector).evaluate(element => getComputedStyle(element).boxShadow), "none");
      await page.locator(".dw-live .assistant-orb").hover();
      assert.equal(await page.locator(".dw-live .assistant-orb").evaluate(element => getComputedStyle(element).boxShadow), "none");
      await page.mouse.move(0, 0);
      if (theme === "default") await page.screenshot({ path: path.join(root, `design-references/dayweave-logo/review-${mode}.png`), fullPage: true });
      checks.push(`${theme}/${mode}: production Logo uses the supplied 1024px SVG without theme or container-shadow overrides`);
    }
  }
  const servedUrl = await page.locator('.dw-hero img:visible').first().getAttribute('src');
  const served = await (await page.request.get(new URL(servedUrl, base).href)).body();
  assert.deepEqual(served, Buffer.from(original), 'served application SVG is byte-identical to the user file');
  const rasterBrowser = await chromium.launch({ headless: true, ...(process.env.DAYWEAVE_BROWSER_PATH ? { executablePath: process.env.DAYWEAVE_BROWSER_PATH } : {}) });
  let rendered;
  try {
  const rasterPage = await rasterBrowser.newPage();
  rendered = await rasterPage.evaluate(async svg => {
    const image = new Image(); image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; await image.decode();
    let rgba;
    for (const size of [16, 24, 32, 48, 64, 128]) {
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = size;
      const context = canvas.getContext("2d"); context.drawImage(image, 0, 0, size, size);
      canvas.toDataURL("image/png");
      if (size === 128) rgba = Array.from(context.getImageData(0, 0, size, size).data);
    }
    return rgba;
  }, original);
  } finally { await rasterBrowser.close(); }
  assert.deepEqual(await readFile(path.join(root, 'src-tauri/icons/logo-light.rgba')), Buffer.from(rendered));
  checks.push("Application-served SVG bytes and native 128px RGBA match the supplied file and its unmodified render");
  await page.goto(base);
  await page.locator('.sidebar-brand .product-brand-name').waitFor();
  await page.locator('.sidebar-brand img').evaluate(image => image.decode());
  for (const width of [960, 1200]) {
    await page.setViewportSize({ width, height: 800 });
    const layout = await page.locator('.sidebar-brand').evaluate(brand => {
      const rect = selector => {
        const r = brand.querySelector(selector).getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
      };
      return { panel: brand.getBoundingClientRect().toJSON(), name: rect('.product-brand-name'), chinese: rect('.product-brand-chinese'), english: rect('.product-brand-english'), logo: rect('.product-brand-logo') };
    });
    assert(layout.name.bottom <= layout.chinese.y, 'Chinese copy is below the brand name');
    assert(layout.chinese.bottom <= layout.english.y, 'English copy is below Chinese');
    assert.equal(layout.name.x, layout.chinese.x);
    assert.equal(layout.name.x, layout.english.x);
    assert(layout.logo.right <= layout.name.x, 'Logo is left of the text stack');
    for (const item of [layout.name, layout.chinese, layout.english, layout.logo]) {
      assert(item.x >= layout.panel.x && item.right <= layout.panel.right + 1, `Brand fits the sidebar at ${width}px`);
    }
  }
  if (process.env.PI_SCRATCH_DIR) await page.locator('.sidebar-brand').screenshot({ path: path.join(process.env.PI_SCRATCH_DIR, 'dayweave-brand-layout.png') });
  await page.locator('.next-shell').evaluate(shell => shell.classList.add('sidebar-collapsed'));
  assert.equal(await page.locator('.product-brand-text:visible').count(), 0);
  assert.equal(await page.locator('.product-brand-logo:visible').count(), 1);
  checks.push('Homepage at 960/1200px: approved Logo left of name/Chinese/English stack, aligned and contained; collapsed sidebar shows only Logo');
  assert.deepEqual(errors, []);
  await writeFile(path.join(root, "design-references/dayweave-logo/checks.json"), JSON.stringify({ source: logoSourceInfo, checks, geometry, renders, errors, note: "Original user SVG is preserved exactly. Browser/native asset checks do not claim live Windows tray/taskbar or installer acceptance." }, null, 2) + "\n");
  console.log(JSON.stringify({ checks, geometry, renders, errors }, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill();
}
