import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { renderWindowsAssets, createLogoSvg, createWindowsSvg, vectorOutputs, sourceSha256 } from "./generate-dayweave-logo.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.DAYWEAVE_PLAYWRIGHT_PATH || "playwright");
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.env.DAYWEAVE_LOGO_TEST_PORT || 1421), base = `http://127.0.0.1:${port}`;
for (const [relative, expected] of vectorOutputs()) {
  assert.equal(await readFile(path.join(root, relative), "utf8"), expected, relative);
}
await renderWindowsAssets(true);
const server = spawn(process.execPath, [path.join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: root, stdio: "pipe" });
let log = "", browser;
server.stdout.on("data", data => log += data); server.stderr.on("data", data => log += data);
server.on("error", error => log += error.message);
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw Error(log);
    try { ready = (await fetch(base)).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(ready, log);
  browser = await chromium.launch({ headless: true, ...(process.env.DAYWEAVE_BROWSER_PATH ? { executablePath: process.env.DAYWEAVE_BROWSER_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto(base);
  await page.locator('.product-brand .product-brand-name').waitFor();
  await page.evaluate(() => document.fonts.ready);
  const logo = page.locator('.product-brand .dayweave-logo img');
  await logo.evaluate(image => image.decode());
  const served = await (await page.request.get(new URL(await logo.getAttribute('src'), base).href)).body();
  assert(served.equals(Buffer.from(createLogoSvg())), 'Homepage uses the approved framed D/W SVG');
  assert.equal(await page.locator('.product-brand-text img').count(), 0);
  assert.match(await page.locator('.product-brand-name').innerText(), /^今序\s*·\s*dayweave$/);
  assert.equal(await page.locator('.product-brand-chinese').innerText(), '让今天，井然有序');
  assert.equal(await page.locator('.product-brand-english').innerText(), 'Bring order to your day.');
  const geometry = await page.evaluate(sources => sources.map(source => {
    const svg = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement;
    const frame = svg.querySelector('rect'), mark = svg.querySelector('path');
    const attrs = element => Object.fromEntries([...element.attributes].map(attribute => [attribute.name, attribute.value]));
    return { viewBox: svg.getAttribute('viewBox'), frame: attrs(frame), mark: attrs(mark), paths: svg.querySelectorAll('path').length, masks: svg.querySelectorAll('mask').length };
  }), [16, 24, 32, 48, 64, 128, 256, 1024].map(size => createWindowsSvg(size)));
  for (const item of geometry) {
    assert.equal(item.viewBox, '-16 -16 288 288');
    assert.equal(item.frame.rx, '56');
    assert.equal(item.frame.fill, '#ffffff');
    assert.equal(item.frame.filter, 'url(#frame-shadow)');
    assert.equal(item.mark.transform, 'matrix(0.84 0 0 0.84 23.18253 20.48)');
    assert.equal(item.mark.fill, '#262825');
    assert.equal(item.paths, 1); assert.equal(item.masks, 0);
    assert.deepEqual(item, geometry[0], 'All icon sizes preserve the same untrimmed geometry');
  }
  const native = await page.evaluate(async () => {
    const image = new Image(); image.src = '/src/assets/logo-windows.png'; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    const rgba = context.getImageData(0, 0, 256, 256).data;
    let opaque = 0, soft = 0, dark = 0;
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i + 3] === 255) opaque++;
      if (rgba[i + 3] > 0 && rgba[i + 3] < 255) soft++;
      if (rgba[i] === 38 && rgba[i + 1] === 40 && rgba[i + 2] === 37 && rgba[i + 3] === 255) dark++;
    }
    return { width: image.naturalWidth, height: image.naturalHeight, corner: rgba[3], opaque, soft, dark };
  });
  assert.equal(native.width, 256); assert.equal(native.height, 256); assert.equal(native.corner, 0);
  assert(native.opaque > 1000); assert(native.soft > 0); assert(native.dark > 1000);
  for (const theme of ['default', 'github', 'codex']) for (const mode of ['light', 'dark']) {
    await page.evaluate(({ theme, mode }) => { document.documentElement.dataset.theme = theme; document.documentElement.dataset.mode = mode; }, { theme, mode });
    const style = await logo.evaluate(image => ({ filter: getComputedStyle(image).filter, shadow: getComputedStyle(image).boxShadow, width: image.getBoundingClientRect().width, height: image.getBoundingClientRect().height }));
    assert.equal(style.filter, 'none', 'Frame shadow is embedded in the approved SVG');
    assert.equal(style.shadow, 'none', 'No duplicate CSS shadow');
    assert(style.width > 0); assert(Math.abs(style.width - style.height) < .1, 'Logo remains square');
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ sourceSha256, native, checks: ['Production SVG outputs and all Windows PNG/ICO/RGBA match regeneration', 'Approved frame and D/W geometry preserved at every size without contour trimming', 'Homepage serves the shared SVG and approved text without duplicate CSS shadows in all themes'] }, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill();
}
