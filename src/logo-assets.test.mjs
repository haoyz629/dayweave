import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createLogoSvg, createWindowsSvg, vectorOutputs, sourceSha256, originalLogoBytes, smallLogoInset } from "../tools/generate-dayweave-logo.mjs";
const bytes = path => readFileSync(new URL(`../${path}`, import.meta.url));
const asset = path => bytes(path).toString("utf8");
test("approved source and original vector paths are preserved", () => {
  assert.equal(sourceSha256,"E78FCE57F729A0777EB4F35E15A076A7D8E43FD63830E02291FB822D86E1725B");
  for (const [path,expected] of vectorOutputs()) assert.equal(asset(path),expected,path);
  assert.equal(createLogoSvg(),createLogoSvg("dark"));
  assert.throws(()=>createLogoSvg("unknown"));
  const paths = svg => [...svg.matchAll(/<path\b[\s\S]*?\/>/g)].map(match => match[0]);
  for (const size of [16,24,32,48,64,128,256,1024]) {
    assert.deepEqual(paths(createWindowsSvg(size)), paths(originalLogoBytes.toString("utf8")));
    assert(!/<(?:image|script|foreignObject)\b/.test(createWindowsSvg(size)));
  }
});
test("all logo outputs share the approved rounded tile, fine border and shadows",()=>{
  for (const svg of [createLogoSvg(), createWindowsSvg()]) {
    assert(svg.includes('viewBox="0 0 512 512"'));
    assert(svg.includes('id="logo-tile"'));
    assert(svg.includes('rx="101.2"'));
    assert(svg.includes('id="tile-edge"'));
    assert(svg.includes('id="tile-shadow"'));
    assert(svg.includes('id="mark-shadow"'));
    assert(svg.includes('<feDropShadow'));
    assert(svg.includes('viewBox="12 24 171 145"'));
  }
});
test("small-size contour trimming is independent of the tile and large master",()=>{
  for (const [size, inset] of [[16,.9],[24,1.4],[32,1.2],[48,.9],[64,.6],[128,0],[256,0]]) {
    assert.equal(smallLogoInset(size), inset);
    const svg = createWindowsSvg(size);
    assert.equal(svg.includes('id="thin-ring"'), inset > 0);
    if (inset) {
      assert(svg.includes(`stroke-width="${inset}"`));
      assert(svg.includes('fill="none" stroke="black"'));
      assert(svg.includes('mask="url(#thin-main-blue-check)"'));
    }
  }
  for (const size of [0,-1,NaN,Infinity]) assert.throws(()=>createWindowsSvg(size));
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
test("native text, proportional layout and collapsed behavior stay unchanged",()=>{
  const component=asset("src/logo.tsx");
  assert(!component.includes('brand-wordmark.svg'));
  assert(component.includes('<h1 className="product-brand-name">今序 · Dayweave</h1>'));
  assert(component.includes('让今天，井然有序。'));
  assert(component.includes('Bring order to your day.'));
  const css=asset("src/styles.css");
  assert.match(css,/product-brand-logo \{ width: var\(--product-brand-height\); height: var\(--product-brand-height\)/);
  assert(!css.includes('width: calc(100% + 24px)'));
  assert.match(css,/product-brand-heading \{[^}]*width: max-content;[^}]*margin-inline: auto/);
  assert.match(css,/\.sidebar-collapsed \.next-sidebar \.product-brand-text\s*\{\s*display: none;/);
});
