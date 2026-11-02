import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createLogoSvg, createWindowsSvg, vectorOutputs, pngOutputs, sourceSha256, logoSourceBytes, logoViewBox } from "../tools/generate-dayweave-logo.mjs";
const bytes = path => readFileSync(new URL(`../${path}`, import.meta.url));
const asset = path => bytes(path).toString("utf8");
test("production source and all vector outputs preserve the approved framed D/W", () => {
  assert.equal(sourceSha256, "4807A16DE24BA50841941E36E20D2DDFB11295B12F4E59F8BFDC21662F2A52AB");
  assert.deepEqual(logoSourceBytes, bytes("src/assets/logo-source.svg"));
  assert.deepEqual(logoViewBox, [-16, -16, 288, 288]);
  for (const [path, expected] of vectorOutputs()) {
    assert(!path.startsWith("design-"), "Production generation must not write preview/reference assets");
    assert.equal(asset(path), expected, path);
  }
  assert.equal(createLogoSvg(), createLogoSvg("dark"));
  assert.throws(() => createLogoSvg("unknown"));
  const source = logoSourceBytes.toString("utf8");
  for (const size of [16, 24, 32, 48, 64, 128, 256, 288, 1024]) {
    const expected = source.replace('width="288" height="288"', `width="${size}" height="${size}"`);
    assert.equal(createWindowsSvg(size), expected);
    assert.equal(createLogoSvg("light", size), expected);
    assert(!/<(?:image|script|foreignObject|mask|linearGradient|radialGradient)\b/.test(expected));
  }
});
test("all sizes retain the exact approved frame, grey shadow and untrimmed D/W path", () => {
  for (const svg of [createLogoSvg(), createWindowsSvg(16), createWindowsSvg()]) {
    assert(svg.includes('viewBox="-16 -16 288 288"'));
    assert(svg.includes('<rect x="4" y="4" width="248" height="248" rx="56" fill="#ffffff" stroke="#262825" stroke-opacity="0.16" stroke-width="1.5" filter="url(#frame-shadow)"/>'));
    assert(svg.includes('<feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#262825" flood-opacity="0.24"/>'));
    assert(svg.includes('transform="matrix(0.84 0 0 0.84 23.18253 20.48)" fill="#262825" fill-rule="evenodd"'));
    assert.equal([...svg.matchAll(/<path\b/g)].length, 1);
  }
  for (const size of [0, -1, NaN, Infinity]) {
    assert.throws(() => createWindowsSvg(size));
    assert.throws(() => createLogoSvg("light", size));
  }
});
test("Windows and navigation PNGs have the generated dimensions", () => {
  for (const [path, size] of pngOutputs) {
    const png = bytes(path);
    assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), path);
    assert.equal(png.readUInt32BE(16), size, path);
    assert.equal(png.readUInt32BE(20), size, path);
  }
});
test("native RGBA has transparent margins, an opaque tile and soft alpha",()=>{
  const rgba=bytes("src-tauri/icons/logo-light.rgba");
  assert.equal(rgba.length,128*128*4); assert.equal(rgba[3],0);
  assert.equal(rgba[(64*128+64)*4+3],255);
  const alphas=[]; for(let i=3;i<rgba.length;i+=4) alphas.push(rgba[i]);
  assert(alphas.includes(255)); assert(alphas.some(a=>a>0&&a<255));
});
test("Windows and favicon ICOs include seven identical size-specific renders",()=>{
  const ico=bytes("src-tauri/icons/icon.ico");
  assert.deepEqual(bytes("src/assets/logo-favicon.ico"),ico);
  assert.equal(ico.readUInt16LE(2),1); assert.equal(ico.readUInt16LE(4),7);
  for(const [i,size] of [16,24,32,48,64,128,256].entries()) {
    const p=6+i*16; assert.equal(ico[p]||256,size);assert.equal(ico[p+1]||256,size);
    assert(ico.readUInt32LE(p+12)+ico.readUInt32LE(p+8)<=ico.length);
  }
  assert(asset("src-tauri/build.rs").includes('cargo:rerun-if-changed=icons/icon.ico'));
});
test("homepage uses the shared tile without a second CSS shadow",()=>{
  const component=asset("src/logo.tsx"), css=asset("src/styles.css");
  assert(component.includes('from "./assets/logo-light.svg"'));
  assert(component.includes('from "./assets/logo-windows.png"'));
  assert(css.includes('object-fit: contain; filter: none; box-shadow: none;'));
  assert(!css.includes('.product-brand-logo img { filter: drop-shadow('));
  assert(asset("index.html").includes('/src/assets/logo-favicon.ico'));
});
test("integrated brand keeps approved logo assets, shared separators and native text",()=>{
  const component=asset("src/logo.tsx"), css=asset("src/app-titlebar.css");
  assert(!component.includes('brand-wordmark.svg'));
  const name = component.match(/<h1 className="product-brand-name">([\s\S]*?)<\/h1>/)?.[1];
  assert(name, "Brand name heading is present");
  assert.match(name, /今序[\s\S]+dayweave/);
  assert(component.includes('import { CopySeparator } from "./copy-separator";'));
  const separator = "<CopySeparator />";
  assert(name.includes(separator), "Brand name uses shared decorative separator markup");
  const copy = component.match(/<p className="product-brand-copy">([\s\S]*?)<\/p>/)?.[1];
  assert(copy?.includes(separator), "Name and tagline use identical separator markup");
  assert.match(component, /className="product-brand-chinese">让今天，井然有序<\/span>/);
  assert(!component.includes('让今天，井然有序。'));
  assert(component.includes('Bring order to your day.'));
  assert.match(css,/product-brand-logo \{[^}]*width: 44px; height: 44px/);
  assert.match(css,/product-brand-logo img \{ width: 100%; height: 100%; \}/);
  assert(!css.includes('filter: drop-shadow('));
});
