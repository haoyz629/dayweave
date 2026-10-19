import { readFileSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export const logoSourceInfo = Object.freeze(JSON.parse(readFileSync(new URL("../design-references/dayweave-logo/source-logo.json", import.meta.url), "utf8")));
const sourceBytes = readFileSync(new URL("../design-references/dayweave-logo/source-logo.svg", import.meta.url));
const sourceHash = createHash("sha256").update(sourceBytes).digest("hex").toUpperCase();
if (sourceHash !== logoSourceInfo.sha256 || sourceBytes.length !== logoSourceInfo.bytes) {
  throw new Error("The approved user SVG changed. Update its provenance only after an explicit logo replacement.");
}
const sourceSvg = sourceBytes.toString("utf8");
export const logoViewBox = Object.freeze(sourceSvg.match(/\bviewBox="([^"]+)"/)[1].trim().split(/\s+/).map(Number));
if (logoViewBox.length !== 4 || !logoViewBox.every(Number.isFinite) || logoViewBox[2] <= 0 || logoViewBox[3] <= 0) throw new Error("Invalid user SVG viewBox");

// Legacy theme calls remain supported. The exact user file is the only current logo.
export function createLogoSvg(mode = "light") {
  if (!["light", "dark"].includes(mode)) throw new Error(`Unknown logo mode: ${mode}`);
  return sourceSvg;
}

export function vectorOutputs() {
  return new Map([
    ["src/assets/logo-light.svg", sourceSvg],
    ["design-references/dayweave-logo/dayweave-icon-light.svg", sourceSvg],
    ["src-tauri/icons/dayweave.svg", sourceSvg]
  ]);
}

async function writeVectors() {
  for (const [relative, svg] of vectorOutputs()) {
    const destination = path.join(root, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, svg);
  }
  console.log("Copied 3 SVG assets verbatim from the approved user file.");
}

async function checkVectors() {
  for (const relative of vectorOutputs().keys()) {
    const bytes = await readFile(path.join(root, relative));
    if (!bytes.equals(sourceBytes)) throw new Error(`Logo differs from the user SVG: ${relative}`);
  }
  console.log(`All 3 SVG assets match the approved user file. SHA256=${sourceHash}`);
}

// Optional exports use an already installed Playwright/browser. No source geometry is modified.
async function renderWindowsAssets() {
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.DAYWEAVE_PLAYWRIGHT_PATH || "playwright");
  const executablePath = process.env.DAYWEAVE_BROWSER_PATH;
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    const page = await browser.newPage();
    const rendered = await page.evaluate(async svg => {
      const image = new Image(); image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; await image.decode();
      const sizes = [16, 24, 32, 48, 64, 128, 256, 1024];
      return sizes.map(size => {
        const canvas = document.createElement("canvas"); canvas.width = canvas.height = size;
        const context = canvas.getContext("2d"); context.drawImage(image, 0, 0, size, size);
        return { size, png: canvas.toDataURL("image/png").split(",")[1], rgba: size === 128 ? Array.from(context.getImageData(0, 0, size, size).data) : null };
      });
    }, sourceSvg);
    const pngs = new Map(rendered.map(({ size, png }) => [size, Buffer.from(png, "base64")]));
    await writeFile(path.join(root, "src-tauri/icons/logo-light.rgba"), Buffer.from(rendered.find(item => item.size === 128).rgba));
    for (const [name, size] of [["32x32.png", 32], ["64x64.png", 64], ["128x128.png", 128], ["128x128@2x.png", 256], ["icon.png", 1024]]) {
      await writeFile(path.join(root, "src-tauri/icons", name), pngs.get(size));
    }
    const icoSizes = [16, 24, 32, 48, 64, 128, 256];
    const header = Buffer.alloc(6 + 16 * icoSizes.length);
    header.writeUInt16LE(1, 2); header.writeUInt16LE(icoSizes.length, 4);
    let offset = header.length;
    for (const [index, size] of icoSizes.entries()) {
      const entry = 6 + 16 * index;
      header[entry] = header[entry + 1] = size === 256 ? 0 : size;
      header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
      header.writeUInt32LE(pngs.get(size).length, entry + 8); header.writeUInt32LE(offset, entry + 12);
      offset += pngs.get(size).length;
    }
    await writeFile(path.join(root, "src-tauri/icons/icon.ico"), Buffer.concat([header, ...icoSizes.map(size => pngs.get(size))]));
    console.log("Rendered native light RGBA and Windows PNG/ICO at the requested resolutions, preserving the original SVG viewBox.");
  } finally { await browser.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (!args.length || args.some(arg => !["--write-svg", "--check", "--render-windows"].includes(arg))) throw new Error("Use --write-svg, --check, and/or --render-windows.");
  if (args.includes("--write-svg")) await writeVectors();
  if (args.includes("--check")) await checkVectors();
  if (args.includes("--render-windows")) await renderWindowsAssets();
}
