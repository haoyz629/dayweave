import { readFileSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export const originalLogoBytes = readFileSync(path.join(root, "design-references/dayweave-logo/refined-source.svg"));
export const sourceSha256 = createHash("sha256").update(originalLogoBytes).digest("hex").toUpperCase();
export const logoViewBox = Object.freeze([0, 0, 203, 171]);
const sourceSvg = originalLogoBytes.toString("utf8");
const body = sourceSvg.slice(sourceSvg.indexOf("<svg")).replace('width="812" height="684"', 'width="203" height="171"');
export function createLogoSvg(mode = "light") {
  if (!["light", "dark"].includes(mode)) throw new Error(`Unknown logo mode: ${mode}`);
  return sourceSvg.replace('viewBox="0 0 203 171"', 'viewBox="12 24 171 145"');
}
// A square native canvas adds safe margins and a soft shadow, without changing the supplied paths.
export function createWindowsSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 179 179"><defs><filter id="windows-shadow" x="-25%" y="-25%" width="150%" height="155%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="3" stdDeviation="2.5" flood-color="#14263D" flood-opacity=".48"/></filter></defs><g filter="url(#windows-shadow)"><g transform="translate(-5 -9)">${body}</g></g></svg>\n`;
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
  console.log(`Copied supplied SVG unchanged; Windows-only shadow wrapper. Source SHA-256: ${sourceSha256}`);
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
    const rendered = await page.evaluate(async source => {
      const image = new Image(); image.src = `data:image/svg+xml;base64,${source}`; await image.decode();
      return [16, 24, 32, 48, 64, 128, 256, 1024].map(size => {
        const canvas = document.createElement("canvas"); canvas.width = canvas.height = size;
        const context = canvas.getContext("2d"); context.drawImage(image, 0, 0, size, size);
        return { size, png: canvas.toDataURL("image/png").split(",")[1], rgba: size === 128 ? Array.from(context.getImageData(0, 0, size, size).data) : null };
      });
    }, Buffer.from(createWindowsSvg()).toString("base64"));
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
    outputs.set("src-tauri/icons/icon.ico", Buffer.concat([header,...sizes.map(size => pngs.get(size))]));
    for (const [relative, bytes] of outputs) {
      if (check) {
        if (!(await readFile(path.join(root,relative))).equals(bytes)) throw new Error(`Native render differs: ${relative}`);
      } else await writeFile(path.join(root,relative),bytes);
    }
    console.log(check ? "All native PNG/ICO/RGBA match fresh shadowed SVG renders." : "Rendered transparent Windows PNG/ICO/RGBA with Windows-only shadow.");
  } finally { await browser.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (!args.length || args.some(arg => !["--write-svg","--write-assets","--check","--render-windows"].includes(arg))) throw new Error("Use --write-assets, --check and/or --render-windows.");
  if (args.includes("--write-svg") || args.includes("--write-assets")) await writeSources();
  if (args.includes("--render-windows")) await renderWindowsAssets();
  if (args.includes("--check")) await checkSources();
}
