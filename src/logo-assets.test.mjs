import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { createLogoSvg, vectorOutputs, logoSourceInfo, logoViewBox } from "../tools/generate-dayweave-logo.mjs";

const root = new URL("../", import.meta.url);
const bytes = path => readFileSync(new URL(path, root));
const asset = path => bytes(path).toString("utf8");
const source = bytes("design-references/dayweave-logo/source-logo.svg");
const sample = (rgba, x, y) => {
  const px = Math.floor((x - logoViewBox[0]) / logoViewBox[2] * 128);
  const py = Math.floor((y - logoViewBox[1]) / logoViewBox[3] * 128);
  return [...rgba.subarray((py * 128 + px) * 4, (py * 128 + px) * 4 + 4)];
};

test("the light-panel midnight-D blue-ribbon logo is the pinned SVG source", () => {
  const expected = "6BF2890E3BE9D6BC643A722FAD9DA45C8CDDD12187AF114F07F559A32299EFE9";
  assert.equal(logoSourceInfo.sha256, expected);
  assert.equal(createHash("sha256").update(source).digest("hex").toUpperCase(), expected);
  assert.equal(source.length, 7452);
  const preview = asset("design-previews/dayweave-blue-soft.svg");
  const paths = svg => [...svg.matchAll(/\bd="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(paths(source.toString("utf8")), paths(preview), "All path geometry stays unchanged");
  assert(source.includes(Buffer.from('id="centeredMark" transform="translate(7.5 -2)"')));
  assert(source.includes(Buffer.from('id="raisedRibbon" transform="translate(0 -45.5)"')));
  assert.deepEqual(logoViewBox, [-44, 10, 1024, 1024]);
  assert(source.includes(Buffer.from('dy="0" stdDeviation="18" flood-color="#64748B" flood-opacity=".24"')));
  assert(source.includes(Buffer.from('dy="10" stdDeviation="10" flood-color="#475569" flood-opacity=".14"')));
});

test("every current SVG is byte-identical to the supplied file and themes cannot recolor it", () => {
  assert.equal(vectorOutputs().size, 3);
  for (const path of vectorOutputs().keys()) assert.deepEqual(bytes(path), source, path);
  assert.equal(createLogoSvg("light"), source.toString("utf8"));
  assert.equal(createLogoSvg("dark"), createLogoSvg("light"));
  assert.throws(() => createLogoSvg("unknown"));
  for (const path of ["src/assets/logo-dark.svg", "src-tauri/icons/logo-dark.rgba"]) assert(!existsSync(new URL(path, root)));
});

test("provided ribbon, panel, gradients and transparent exterior remain intact without added guides", () => {
  const svg = createLogoSvg("light");
  for (const id of ["ribbon", "panelShape", "dShape", "ribbonClip", "panelShadow", "ribbonShadow", "blue", "blueShade", "softFold", "middle", "back", "right"]) assert(svg.includes(`id="${id}"`));
  assert(svg.includes('fill-rule="evenodd"'));
  assert(!/<(?:script|image|foreignObject|circle|line)\b/.test(svg));
  assert(!/href="(?!#)/.test(svg));
  assert(!svg.includes("tile-guides"));
});

test("native icon preserves the midnight D, light panel, blue W and deep teal fold", () => {
  const rgba = bytes("src-tauri/icons/logo-light.rgba");
  assert.equal(rgba.length, 128 * 128 * 4);
  const d = sample(rgba, 240, 260), aperture = sample(rgba, 400, 330);
  assert(d[0] < 45 && d[1] < 80 && d[2] > d[1] + 30 && d[3] === 255, `midnight D: ${d}`);
  assert(aperture[0] > 220 && aperture[1] > 220 && aperture[2] >= aperture[0] && aperture[3] === 255, `light aperture: ${aperture}`);
  for (const point of [[240, 425], [670, 405]]) {
    const ribbon = sample(rgba, ...point);
    assert(ribbon[0] < 100 && ribbon[1] > 100 && ribbon[2] > 180 && ribbon[3] === 255, `blue W ${point}: ${ribbon}`);
  }
  const fold = sample(rgba, 520, 510);
  assert(fold[0] < 35 && fold[1] > 40 && fold[1] < 110 && fold[2] > fold[1] && fold[2] < 150 && fold[3] === 255, `deep teal fold: ${fold}`);
  assert.equal(rgba[3], 0, "exterior stays transparent");
});

test("Windows ICO includes the required icon sizes", () => {
  const ico = bytes("src-tauri/icons/icon.ico");
  assert.equal(ico.readUInt16LE(2), 1); assert.equal(ico.readUInt16LE(4), 7);
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  for (const [i, size] of sizes.entries()) {
    const offset = 6 + i * 16;
    assert.equal(ico[offset] || 256, size); assert.equal(ico[offset + 1] || 256, size);
    assert(ico.readUInt32LE(offset + 12) + ico.readUInt32LE(offset + 8) <= ico.length);
  }
});

test("Windows resource build tracks changes to the application ICO", () => {
  assert(asset("src-tauri/build.rs").includes('println!("cargo:rerun-if-changed=icons/icon.ico");'));
});

test("all themes and favicon retain one light logo without container shadow overrides", () => {
  const component = asset("src/logo.tsx"), styles = asset("src/styles.css");
  assert(!component.includes("logo-dark"));
  assert.equal((component.match(/<img\b/g) || []).length, 1);
  assert.match(component, /export function logoUrl\([^)]*\)\s*\{\s*return lightLogo;/);
  assert(!styles.includes(".dayweave-logo-dark"));
});

test("sidebar brand keeps its position and places Chinese then English below the name", () => {
  const component = asset("src/logo.tsx"), app = asset("src/App.tsx");
  for (const text of ["今序 · Dayweave", "Bring order to your day.", "让今天，井然有序。"]) assert(component.includes(text));
  assert.match(component, /className="product-brand-text">\s*<h1 className="product-brand-name">今序 · Dayweave<\/h1>\s*<div className="product-brand-copy">\s*<h2 className="product-brand-chinese">让今天，井然有序。<\/h2>\s*<p className="product-brand-english" lang="en">Bring order to your day\.<\/p>/);
  assert.match(asset("src/styles.css"), /\.sidebar-collapsed \.next-sidebar \.product-brand-text\s*\{\s*display: none;/);
  const sidebar = app.slice(app.indexOf('<aside id="main-sidebar"'));
  assert(sidebar.indexOf("<ProductBrand />") < sidebar.indexOf('className="next-create"'));
});
