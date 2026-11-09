import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

// The tray has its own small-size artwork; never regenerate the approved app logo here.
const source = new URL("../src-tauri/icons/tray.svg", import.meta.url);
const output = new URL("../src-tauri/icons/tray.rgba", import.meta.url);
const check = process.argv.includes("--check");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.DAYWEAVE_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true, ...(process.env.DAYWEAVE_BROWSER_PATH ? { executablePath: process.env.DAYWEAVE_BROWSER_PATH } : {}) });
try {
  const page = await browser.newPage();
  const svg = (await readFile(source)).toString("base64");
  const rgba = Buffer.from(await page.evaluate(async svg => {
    const image = new Image();
    image.src = `data:image/svg+xml;base64,${svg}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 32;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, 32, 32);
    return Array.from(context.getImageData(0, 0, 32, 32).data);
  }, svg));
  if (check) {
    if (!(await readFile(output)).equals(rgba)) throw new Error("Tray RGBA differs from tray.svg");
  } else {
    await writeFile(output, rgba);
  }
  console.log(check ? "Tray RGBA matches its vector source." : "Generated dedicated 32px tray RGBA.");
} finally {
  await browser.close();
}
