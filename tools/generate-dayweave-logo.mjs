import { readFileSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export const originalLogoBytes = readFileSync(path.join(root, "design-references/dayweave-logo/refined-source.svg"));
export const sourceSha256 = createHash("sha256").update(originalLogoBytes).digest("hex").toUpperCase();
export const logoViewBox = Object.freeze([0, 0, 512, 512]);
const sourceSvg = originalLogoBytes.toString("utf8");
const ringCenter = [85.0199813843, 96.445186615];
const shapeGroups = [["ring", "woven-ring"], ["short-orange-check", "orange-check-shape"], ["middle-gold-check", "gold-check-shape"], ["main-blue-check", "blue-check-shape"]];
export function smallLogoInset(size) {
  if (!Number.isFinite(size) || size <= 0) throw new Error(`Invalid logo size: ${size}`);
  return size <= 16 ? .9 : size <= 24 ? 1.4 : size <= 32 ? 1.2 : size <= 48 ? .9 : size <= 64 ? .6 : 0;
}
function createTileSvg(size) {
  const inset = smallLogoInset(size);
  const tile = { x: 36, y: 22, size: 440 };
  const width = tile.size * .84, scale = width / 171;
  const x = tile.x + tile.size / 2 - (ringCenter[0] - 12) * scale;
  const y = tile.y + tile.size / 2 - (ringCenter[1] - 24) * scale;
  let mark = sourceSvg.slice(sourceSvg.indexOf("<svg"))
    .replace('width="812" height="684"', `x="${x}" y="${y}" width="${width}" height="${145 * scale}"`)
    .replace('viewBox="0 0 203 171"', 'viewBox="12 24 171 145"');
  if (inset) {
    const masks = shapeGroups.map(([group, shape]) => `<mask id="thin-${group}" maskUnits="userSpaceOnUse" x="0" y="0" width="203" height="171" mask-type="luminance"><rect width="203" height="171" fill="white"/><use href="#${shape}" fill="none" stroke="black" stroke-width="${inset}" stroke-linejoin="round"/></mask>`).join("");
    mark = mark.replace("</defs>", `${masks}</defs>`);
    for (const [group] of shapeGroups) mark = mark.replace(`<g id="${group}"`, `<g id="${group}" mask="url(#thin-${group})"`);
  }
  // The ring, not the long checkmark's bounding box, is centered on the tile.
  // Small renders trim the original contours rather than shrinking the complete mark.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512" role="img" aria-labelledby="tile-title"><title id="tile-title">今序 · Dayweave</title><defs>
<linearGradient id="tile-fill" x1="0" y1="0" x2="1" y2="1"><stop offset=".04" stop-color="#ffffff"/><stop offset=".37" stop-color="#fcfcfd"/><stop offset=".75" stop-color="#f2f3f6"/><stop offset="1" stop-color="#e9ebf0"/></linearGradient>
<linearGradient id="tile-edge" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#ffffff" stop-opacity=".15"/><stop offset="1" stop-color="#ffffff" stop-opacity=".72"/></linearGradient>
<filter id="tile-shadow" filterUnits="userSpaceOnUse" x="2" y="2" width="508" height="508" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="16.72" stdDeviation="14.96" flood-color="#283044" flood-opacity=".20"/></filter>
<filter id="mark-shadow" filterUnits="userSpaceOnUse" x="0" y="0" width="512" height="512" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="${inset ? .9 : 3.96}" stdDeviation="${inset ? .6 : 2.64}" flood-color="#203346" flood-opacity="${inset ? .12 : .24}"/></filter>
</defs><rect id="logo-tile" x="36" y="22" width="440" height="440" rx="101.2" fill="url(#tile-fill)" filter="url(#tile-shadow)"/>
<rect x="36.66" y="22.66" width="438.68" height="438.68" rx="100.54" fill="none" stroke="#ffffff" stroke-opacity=".85" stroke-width="1.32"/>
<rect x="38.64" y="24.64" width="434.72" height="434.72" rx="98.56" fill="none" stroke="url(#tile-edge)" stroke-width=".88"/>
<g filter="url(#mark-shadow)">${mark}</g></svg>\n`;
}
export function createLogoSvg(mode = "light", size = 56) {
  if (!["light", "dark"].includes(mode)) throw new Error(`Unknown logo mode: ${mode}`);
  return createTileSvg(size);
}
export function createWindowsSvg(size = 256) {
  return createTileSvg(size);
}
export function vectorOutputs() {
  return new Map([
    ["design-references/dayweave-logo/source-logo.svg", sourceSvg],
    ["design-references/dayweave-logo/dayweave-icon-light.svg", sourceSvg],
    ["src/assets/logo-light.svg", createLogoSvg()],
    ["src/assets/logo-windows.svg", createWindowsSvg()],
    ["src-tauri/icons/dayweave.svg", createWindowsSvg()]
  ]);
}
async function writeSources() {
  for (const [relative, content] of vectorOutputs()) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), content);
  }
  console.log(`Generated ring-centered porcelain tiles; original paths preserved. Source SHA-256: ${sourceSha256}`);
}
async function checkSources() {
  for (const [relative, content] of vectorOutputs()) {
    if (!(await readFile(path.join(root, relative))).equals(Buffer.from(content))) throw new Error(`SVG output differs: ${relative}`);
  }
  console.log("SVG source outputs match.");
}
export async function renderWindowsAssets(check = false) {
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.DAYWEAVE_PLAYWRIGHT_PATH || "playwright");
  const browser = await chromium.launch({ headless: true, ...(process.env.DAYWEAVE_BROWSER_PATH ? { executablePath: process.env.DAYWEAVE_BROWSER_PATH } : {}) });
  try {
    const page = await browser.newPage();
    const sources = [16, 24, 32, 48, 64, 128, 256, 1024].map(size => ({ size, svg: Buffer.from(createWindowsSvg(size)).toString("base64") }));
    const rendered = await page.evaluate(async sources => {
      return Promise.all(sources.map(async ({ size, svg }) => {
        const image = new Image(); image.src = `data:image/svg+xml;base64,${svg}`; await image.decode();
        const canvas = document.createElement("canvas"); canvas.width = canvas.height = size;
        const context = canvas.getContext("2d"); context.drawImage(image, 0, 0, size, size);
        return { size, png: canvas.toDataURL("image/png").split(",")[1], rgba: size === 128 ? Array.from(context.getImageData(0, 0, size, size).data) : null };
      }));
    }, sources);
    const pngs = new Map(rendered.map(({ size, png }) => [size, Buffer.from(png, "base64")]));
    const outputs = new Map([["src-tauri/icons/logo-light.rgba", Buffer.from(rendered.find(item => item.size === 128).rgba)], ["src/assets/logo-windows.png", pngs.get(256)]]);
    for (const [name, size] of [["32x32.png",32],["64x64.png",64],["128x128.png",128],["128x128@2x.png",256],["icon.png",1024]]) outputs.set(`src-tauri/icons/${name}`, pngs.get(size));
    const sizes = [16,24,32,48,64,128,256], header = Buffer.alloc(6 + 16 * sizes.length);
    header.writeUInt16LE(1,2); header.writeUInt16LE(sizes.length,4);
    let offset = header.length;
    for (const [index,size] of sizes.entries()) {
      const entry = 6 + 16 * index;
      header[entry] = header[entry+1] = size === 256 ? 0 : size;
      header.writeUInt16LE(1,entry+4); header.writeUInt16LE(32,entry+6);
      header.writeUInt32LE(pngs.get(size).length,entry+8); header.writeUInt32LE(offset,entry+12);
      offset += pngs.get(size).length;
    }
    const ico = Buffer.concat([header,...sizes.map(size => pngs.get(size))]);
    outputs.set("src-tauri/icons/icon.ico", ico);
    outputs.set("src/assets/logo-favicon.ico", ico);
    for (const [relative, bytes] of outputs) {
      if (check) {
        if (!(await readFile(path.join(root,relative))).equals(bytes)) throw new Error(`Native render differs: ${relative}`);
      } else await writeFile(path.join(root,relative),bytes);
    }
    console.log(check ? "All native PNG/ICO/RGBA match fresh size-specific tile renders." : "Rendered porcelain Windows PNG/ICO/RGBA with size-specific contour trimming.");
  } finally { await browser.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (!args.length || args.some(arg => !["--write-svg","--write-assets","--check","--render-windows"].includes(arg))) throw new Error("Use --write-assets, --check and/or --render-windows.");
  if (args.includes("--write-svg") || args.includes("--write-assets")) await writeSources();
  if (args.includes("--render-windows")) await renderWindowsAssets();
  if (args.includes("--check")) await checkSources();
}
