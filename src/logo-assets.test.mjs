import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { createLogoSvg, createWindowsSvg, vectorOutputs, sourceSha256 } from "../tools/generate-dayweave-logo.mjs";
const bytes = path => readFileSync(new URL(`../${path}`, import.meta.url));
const asset = path => bytes(path).toString("utf8");
test("supplied refined SVG is preserved byte-for-byte", () => {
  assert.equal(sourceSha256,"E78FCE57F729A0777EB4F35E15A076A7D8E43FD63830E02291FB822D86E1725B");
  for (const [path,expected] of vectorOutputs()) assert.equal(asset(path),expected,path);
  assert.equal(createLogoSvg(),createLogoSvg("dark"));
  assert.throws(()=>createLogoSvg("unknown"));
  assert(!/<(?:image|filter|script|foreignObject)\b/.test(createLogoSvg()));
});
test("Windows-only wrapper adds a shadow and a square transparent canvas",()=>{
  const svg=createWindowsSvg();
  assert(svg.includes('viewBox="0 0 179 179"'));
  assert(svg.includes('flood-opacity=".48"'));
  assert(createLogoSvg().includes('viewBox="12 24 171 145"'));
  assert(svg.includes('<feDropShadow'));
  assert(svg.includes('width="203" height="171"'));
  assert(!svg.includes('<image'));
  assert(!createLogoSvg().includes('<feDropShadow'));
});
test("native RGBA has transparent margins, opaque mark and soft alpha",()=>{
  const rgba=bytes("src-tauri/icons/logo-light.rgba");
  assert.equal(rgba.length,128*128*4); assert.equal(rgba[3],0);
  const alphas=[]; for(let i=3;i<rgba.length;i+=4) alphas.push(rgba[i]);
  assert(alphas.includes(255)); assert(alphas.some(a=>a>0&&a<255));
});
test("Windows ICO includes seven expected sizes",()=>{
  const ico=bytes("src-tauri/icons/icon.ico");
  assert.equal(ico.readUInt16LE(2),1); assert.equal(ico.readUInt16LE(4),7);
  for(const [i,size] of [16,24,32,48,64,128,256].entries()) {
    const p=6+i*16; assert.equal(ico[p]||256,size);assert.equal(ico[p+1]||256,size);
    assert(ico.readUInt32LE(p+12)+ico.readUInt32LE(p+8)<=ico.length);
  }
  assert(asset("src-tauri/build.rs").includes('cargo:rerun-if-changed=icons/icon.ico'));
});
test("homepage uses shadow-free SVG and native favicon remains separate",()=>{
  const component=asset("src/logo.tsx"), css=asset("src/styles.css");
  assert(component.includes('from "./assets/logo-light.svg"'));
  assert(component.includes('from "./assets/logo-windows.png"'));
  assert(css.includes('object-fit: contain; filter: none; box-shadow: none;'));
  assert(asset("index.html").includes('/src/assets/logo-windows.png'));
});
test("larger native text replaces SVG wordmark and preserves collapsed behavior",()=>{
  const component=asset("src/logo.tsx");
  assert(!component.includes('brand-wordmark.svg'));
  assert(component.includes('<h1 className="product-brand-name">今序 · Dayweave</h1>'));
  assert(component.includes('让今天，井然有序。'));
  assert(component.includes('Bring order to your day.'));
  const css=asset("src/styles.css");
  assert.match(css,/product-brand-logo \{ width: calc\(56 \* var\(--brand-unit\)\)/);
  assert(css.includes('.product-brand-logo img { filter: drop-shadow('));
  assert(!css.includes('width: calc(100% + 24px)'));
  assert.match(css,/product-brand-heading \{[^}]*width: max-content;[^}]*margin-inline: auto/);
  assert.match(css,/\.sidebar-collapsed \.next-sidebar \.product-brand-text\s*\{\s*display: none;/);
});
