import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

// The tray has its own small-size artwork; never regenerate the approved app logo here.
const source = new URL("../src-tauri/icons/tray.svg", import.meta.url);
const output = new URL("../src-tauri/icons/tray.rgba", import.meta.url);
const pngOutput = new URL("../src-tauri/icons/tray.png", import.meta.url);
const check = process.argv.includes("--check");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.DAYWEAVE_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true, ...(process.env.DAYWEAVE_BROWSER_PATH ? { executablePath: process.env.DAYWEAVE_BROWSER_PATH } : {}) });
try {
  const page = await browser.newPage();
  const svg = (await readFile(source)).toString("base64");
  const rendered = await page.evaluate(async svg => {
    const image = new Image();
    image.src = `data:image/svg+xml;base64,${svg}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 32;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, 32, 32);
    return { rgba: Array.from(context.getImageData(0, 0, 32, 32).data), png: canvas.toDataURL("image/png").split(",")[1] };
  }, svg);
  const rgba = Buffer.from(rendered.rgba);
  const png = Buffer.from(rendered.png, "base64");
  if (check) {
    if (!(await readFile(output)).equals(rgba)) throw new Error("Tray RGBA differs from tray.svg");
    if (!(await readFile(pngOutput)).equals(png)) throw new Error("Tray PNG differs from tray.svg");
  } else {
    await writeFile(output, rgba);
    await writeFile(pngOutput, png);
  }
  console.log(check ? "Tray RGBA and notification PNG match their vector source." : "Generated shared 32px tray RGBA and notification PNG.");
} finally {
  await browser.close();
}
