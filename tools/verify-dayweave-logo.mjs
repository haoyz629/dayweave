import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { renderWindowsAssets, createLogoSvg, createWindowsSvg, sourceSha256 } from "./generate-dayweave-logo.mjs";
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.DAYWEAVE_PLAYWRIGHT_PATH||"playwright");
const root=path.resolve(fileURLToPath(new URL("..",import.meta.url)));
const port=Number(process.env.DAYWEAVE_LOGO_TEST_PORT||1421), base=`http://127.0.0.1:${port}`;
await renderWindowsAssets(true);
const server=spawn(process.execPath,[path.join(root,"node_modules/vite/bin/vite.js"),"--host","127.0.0.1","--port",String(port),"--strictPort"],{cwd:root,stdio:"pipe"});
let log="",browser;
server.stdout.on("data",d=>log+=d);server.stderr.on("data",d=>log+=d);
server.on("error",e=>log+=e.message);
try {
  let ready=false;
  for(let i=0;i<100;i++){
    if(server.exitCode!==null) throw Error(log);
    try{ready=(await fetch(base)).ok;}catch{}
    if(ready)break; await new Promise(r=>setTimeout(r,100));
  }
  assert(ready,log);
  browser=await chromium.launch({headless:true,...(process.env.DAYWEAVE_BROWSER_PATH?{executablePath:process.env.DAYWEAVE_BROWSER_PATH}:{})});
  const page=await browser.newPage({viewport:{width:1200,height:900},reducedMotion:"reduce"});
  const errors=[],layouts=[];
  page.on("pageerror",e=>errors.push(e.message));
  page.on("response",r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
  await page.goto(base);
  await page.locator('.sidebar-brand .product-brand-name').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.locator('.sidebar-brand img').evaluateAll(imgs=>Promise.all(imgs.map(i=>i.decode())));
  const logo=page.locator('.sidebar-brand .dayweave-logo img');
  const served=await(await page.request.get(new URL(await logo.getAttribute('src'),base).href)).body();
  assert(served.equals(Buffer.from(createLogoSvg())),'Homepage uses the approved ring-centered porcelain tile');
  assert.equal(await page.locator('.product-brand-text img').count(),0);
  assert.equal(await page.locator('.product-brand-name').innerText(),'今序 · Dayweave');
  assert.equal(await page.locator('.product-brand-chinese').innerText(),'让今天，井然有序。');
  assert.equal(await page.locator('.product-brand-english').innerText(),'Bring order to your day.');
  const shadow=await logo.evaluate(img=>({filter:getComputedStyle(img).filter,boxShadow:getComputedStyle(img).boxShadow}));
  assert.equal(shadow.filter,'none','Tile shadows are embedded; do not apply a second CSS shadow');
  assert.equal(shadow.boxShadow,'none');
  const tileChecks = await page.evaluate(async sources => {
    const checks = [];
    for (const {size, svg: source} of sources) {
      const svg = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement;
      svg.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
      document.body.append(svg);
      const ring = svg.querySelector('#ring'), tile = svg.querySelector('#logo-tile');
      const b = ring.getBBox(), t = tile.getBBox();
      const center = new DOMPoint(b.x+b.width/2,b.y+b.height/2).matrixTransform(ring.getScreenCTM()).matrixTransform(tile.getScreenCTM().inverse());
      const centerError = {x:center.x-t.x-t.width/2,y:center.y-t.y-t.height/2};
      svg.remove(); svg.removeAttribute('style');
      svg.querySelectorAll(':scope > rect').forEach(rect => rect.remove());
      svg.querySelector(':scope > g').removeAttribute('filter');
      async function ink() {
        const image = new Image(); image.src = 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(svg)); await image.decode();
        const canvas = document.createElement('canvas'); canvas.width=canvas.height=size;
        const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0,size,size);
        const data=ctx.getImageData(0,0,size,size).data;
        let total=0;for(let i=3;i<data.length;i+=4)total+=data[i];return total;
      }
      const refinedInk = await ink();
      svg.querySelectorAll('g[mask^="url(#thin-"]').forEach(group => group.removeAttribute('mask'));
      const originalInk = await ink();
      checks.push({size,centerError,refinedInk,originalInk});
    }
    return checks;
  }, [16,24,32,48,64,128,256].map(size => ({size,svg:createWindowsSvg(size)})));
  for(const check of tileChecks) {
    assert(Math.abs(check.centerError.x)<.01&&Math.abs(check.centerError.y)<.01,'Ring center aligns with tile center');
    assert(check.refinedInk>0);
    if(check.size<=64)assert(check.refinedInk<check.originalInk,`${check.size}px mark has lighter contours, not a smaller tile`);
    else assert.equal(check.refinedInk,check.originalInk);
  }
  const native=await page.evaluate(async()=>{
    const img=new Image(); img.src='/src/assets/logo-windows.png';await img.decode();
    const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
    const rgba=ctx.getImageData(0,0,256,256).data;let visible=0,edge=0;
    for(let y=0;y<256;y++)for(let x=0;x<256;x++){const a=rgba[(y*256+x)*4+3];if(a>0)visible++;if((x===0||y===0||x===255||y===255)&&a>0)edge++;}
    return {visible,edge,corner:rgba[3]};
  });
  assert(native.visible>1000);assert.equal(native.corner,0);assert.equal(native.edge,0,'Native mark and shadow must not touch canvas edge');
  for(const theme of ['default','github','codex'])for(const mode of ['light','dark'])for(const width of [960,1100,1200,1440,1600,1920,2560,3440])for(const height of [640,700,701,900,1440]){
    await page.evaluate(({theme,mode})=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.mode=mode;},{theme,mode});
    await page.setViewportSize({width,height});
    const layout=await page.locator('.sidebar-brand').evaluate(brand=>{
      const rect=e=>e.getBoundingClientRect().toJSON();
      const panel=rect(brand),logo=rect(brand.querySelector('.product-brand-logo')),text=rect(brand.querySelector('.product-brand-text'));
      const image=rect(brand.querySelector('.product-brand-logo img'));
      const visibleTile={x:image.x+image.width*36/512,y:image.y+image.height*22/512,width:image.width*440/512,height:image.height*440/512};
      const lines=[...brand.querySelectorAll('.product-brand-text h1,.product-brand-text p')].map(e=>{
        const range=document.createRange();range.selectNodeContents(e);
        const style=getComputedStyle(e);
        return {text:e.textContent,rect:range.getBoundingClientRect().toJSON(),fontSize:parseFloat(style.fontSize),fontWeight:style.fontWeight,fontFamily:style.fontFamily,color:style.color,letterSpacing:parseFloat(style.letterSpacing)};
      });
      return {panel,logo,text,image,visibleTile,lines,group:rect(brand.querySelector('.product-brand-heading')),sidebar:rect(brand.closest('.next-sidebar')),button:rect(brand.closest('.next-sidebar').querySelector('.next-create'))};
    });
    const scale=layout.button.width/214;
    assert(Math.abs(layout.logo.width-layout.logo.height)<.1,'Logo remains square');
    assert(Math.abs(layout.image.width-layout.image.height)<.1,'Logo image scales uniformly');
    assert(Math.abs(layout.visibleTile.height-layout.text.height)<.15,`${width}x${height}: visible logo matches the full text height`);
    assert(Math.abs(layout.visibleTile.y-layout.text.y)<.15,`${width}x${height}: logo and text top edges align`);
    assert(Math.abs(layout.visibleTile.y+layout.visibleTile.height-layout.text.bottom)<.15,`${width}x${height}: logo and text bottom edges align`);
    assert(Math.abs(layout.text.x-layout.logo.right-10*scale)<.1,'Logo/text gap scales proportionally');
    assert(Math.abs((layout.group.x+layout.group.right)/2-(layout.button.x+layout.button.right)/2)<1,'Whole logo/text group centers within button bounds');
    assert(layout.group.x>=layout.button.x&&layout.group.right<=layout.button.right+1,'Whole group fits inside button width');
    assert(layout.panel.x>=layout.sidebar.x&&layout.panel.right<=layout.sidebar.right+1);
    assert(Math.abs(layout.panel.x-layout.button.x)<1&&Math.abs(layout.panel.right-layout.button.right)<1,'Brand and create button share exact horizontal bounds');
    for(const line of layout.lines) assert(line.rect.right<=layout.panel.right+1,`${width}px: ${line.text} overflows`);
    for(const [i,size] of [17.5,12.5,11].entries())assert(Math.abs(layout.lines[i].fontSize-size*scale)<.1,'Text scales with logo');
    const colors=mode==='dark'?['rgb(226, 232, 240)','rgb(180, 192, 208)','rgb(148, 163, 184)']:['rgb(30, 41, 59)','rgb(71, 85, 105)','rgb(100, 116, 139)'];
    for(const [i,weight] of ['700','500','400'].entries()) {
      assert.equal(layout.lines[i].fontWeight,weight,'Approved brand weight');
      assert.equal(layout.lines[i].color,colors[i],'Approved slate palette');
      assert(layout.lines[i].fontFamily.startsWith('Inter'),'Brand uses Inter and modern Chinese sans fallbacks');
      assert(Math.abs(layout.lines[i].letterSpacing-layout.lines[i].fontSize*[-.02,.04,.01][i])<.001,'Approved letter spacing');
    }
    const occupancy=layout.group.width/layout.button.width;
    assert(occupancy>.93&&occupancy<.97,'Enlarged brand fits within the existing button bounds');
    layouts.push({theme,mode,width,height,buttonWidth:layout.button.width,logoWidth:layout.logo.width,visibleLogoHeight:layout.visibleTile.height,textHeight:layout.text.height,topAlignmentError:layout.visibleTile.y-layout.text.y,groupWidth:layout.group.width,occupancy,fontSizes:layout.lines.map(l=>l.fontSize)});
    if(theme==='default'&&height===900&&[1200,1920,2560].includes(width))await page.screenshot({path:path.join(root,`design-references/dayweave-logo/home-brand-${mode}${width===1200?'':`-${width}`}.png`),clip:{x:layout.sidebar.x,y:layout.panel.y-6,width:layout.sidebar.width,height:layout.button.bottom-layout.panel.y+18},scale:'css'});
  }
  await page.locator('.next-shell').evaluate(e=>e.classList.add('sidebar-collapsed'));
  assert.equal(await page.locator('.product-brand-text:visible').count(),0);
  assert.equal(await page.locator('.product-brand-logo:visible').count(),1);
  const collapsed=await logo.boundingBox();
  assert(Math.abs(collapsed.width-42)<.1&&Math.abs(collapsed.height-42)<.1,'Collapsed sidebar keeps its existing 42px logo');
  assert.deepEqual(errors,[]);
  const result={sourceSha256,native,shadow,tileChecks,layouts,errors,checks:['Original paths preserved; approved porcelain tile, fine edges and embedded shadows','Ring center matches tile center; 16–64px contours are trimmed independently of the tile','Windows and favicon resources match fresh size-specific Chromium rendering','Three themes, light/dark, widths 960–3440px and heights 640–1440px: visible logo is square, matches text height and aligns at both edges; brand remains contained','Collapsed sidebar retains its 42px icon and hides text'],note:'Does not assert live Explorer icon-cache refresh.'};
  await writeFile(path.join(root,'design-references/dayweave-logo/checks.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
}finally{if(browser)await browser.close();server.kill();}
