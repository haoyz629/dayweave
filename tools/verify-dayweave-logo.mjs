import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { renderWindowsAssets, createLogoSvg, sourceSha256 } from "./generate-dayweave-logo.mjs";
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
  assert(served.equals(Buffer.from(createLogoSvg())),'Homepage uses supplied paths with tighter viewport');
  assert.equal(await page.locator('.product-brand-text img').count(),0);
  assert.equal(await page.locator('.product-brand-name').innerText(),'今序 · Dayweave');
  assert.equal(await page.locator('.product-brand-chinese').innerText(),'让今天，井然有序。');
  assert.equal(await page.locator('.product-brand-english').innerText(),'Bring order to your day.');
  const shadow=await logo.evaluate(img=>({filter:getComputedStyle(img).filter,boxShadow:getComputedStyle(img).boxShadow}));
  assert(shadow.filter.includes('drop-shadow('),'Homepage logo has a contour shadow');
  assert.equal(shadow.boxShadow,'none','No rectangular tile shadow');
  const native=await page.evaluate(async()=>{
    const img=new Image(); img.src='/src/assets/logo-windows.png';await img.decode();
    const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
    const rgba=ctx.getImageData(0,0,256,256).data;let visible=0,edge=0;
    for(let y=0;y<256;y++)for(let x=0;x<256;x++){const a=rgba[(y*256+x)*4+3];if(a>0)visible++;if((x===0||y===0||x===255||y===255)&&a>0)edge++;}
    return {visible,edge,corner:rgba[3]};
  });
  assert(native.visible>1000);assert.equal(native.corner,0);assert.equal(native.edge,0,'Native mark and shadow must not touch canvas edge');
  for(const theme of ['default','github','codex'])for(const mode of ['light','dark'])for(const width of [960,1200,1600,1920,2560]){
    await page.evaluate(({theme,mode})=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.mode=mode;},{theme,mode});
    await page.setViewportSize({width,height:900});
    const layout=await page.locator('.sidebar-brand').evaluate(brand=>{
      const rect=e=>e.getBoundingClientRect().toJSON();
      const panel=rect(brand),logo=rect(brand.querySelector('.product-brand-logo')),text=rect(brand.querySelector('.product-brand-text'));
      const lines=[...brand.querySelectorAll('.product-brand-text h1,.product-brand-text p')].map(e=>{
        const range=document.createRange();range.selectNodeContents(e);
        return {text:e.textContent,rect:range.getBoundingClientRect().toJSON(),fontSize:parseFloat(getComputedStyle(e).fontSize)};
      });
      return {panel,logo,text,lines,group:rect(brand.querySelector('.product-brand-heading')),sidebar:rect(brand.closest('.next-sidebar')),button:rect(brand.closest('.next-sidebar').querySelector('.next-create'))};
    });
    const scale=layout.button.width/214;
    assert(Math.abs(layout.logo.width-56*scale)<.1,'Logo scales with button width');
    assert(Math.abs(layout.text.x-layout.logo.right-10*scale)<.1,'Logo/text gap scales proportionally');
    assert(Math.abs((layout.group.x+layout.group.right)/2-(layout.button.x+layout.button.right)/2)<1,'Whole logo/text group centers within button bounds');
    assert(layout.group.x>=layout.button.x&&layout.group.right<=layout.button.right+1,'Whole group fits inside button width');
    assert(layout.panel.x>=layout.sidebar.x&&layout.panel.right<=layout.sidebar.right+1);
    assert(Math.abs(layout.panel.x-layout.button.x)<1&&Math.abs(layout.panel.right-layout.button.right)<1,'Brand and create button share exact horizontal bounds');
    for(const line of layout.lines) assert(line.rect.right<=layout.panel.right+1,`${width}px: ${line.text} overflows`);
    for(const [i,size] of [17,12.5,11].entries())assert(Math.abs(layout.lines[i].fontSize-size*scale)<.1,'Text scales with logo');
    const occupancy=layout.group.width/layout.button.width;
    assert(occupancy>.89&&occupancy<.92,'Brand occupies a consistent share of button width');
    if(layouts.length)assert(Math.abs(occupancy-layouts[0].occupancy)<.005,'Large windows preserve brand/button proportions');
    layouts.push({theme,mode,width,buttonWidth:layout.button.width,logoWidth:layout.logo.width,groupWidth:layout.group.width,occupancy,fontSizes:layout.lines.map(l=>l.fontSize)});
    if(theme==='default'&&[1200,1920,2560].includes(width))await page.screenshot({path:path.join(root,`design-references/dayweave-logo/home-brand-${mode}${width===1200?'':`-${width}`}.png`),clip:{x:layout.sidebar.x,y:layout.panel.y-6,width:layout.sidebar.width,height:layout.button.bottom-layout.panel.y+18},scale:'css'});
  }
  await page.locator('.next-shell').evaluate(e=>e.classList.add('sidebar-collapsed'));
  assert.equal(await page.locator('.product-brand-text:visible').count(),0);
  assert.equal(await page.locator('.product-brand-logo:visible').count(),1);
  assert.deepEqual(errors,[]);
  const result={sourceSha256,native,shadow,layouts,errors,checks:['Supplied SVG paths and existing shadows unchanged','Windows resources match fresh Chromium rendering','Three themes, light/dark, 960/1200/1600/1920/2560px: brand scales proportionally with button width, stays centered and contained','Collapsed sidebar icon only'],note:'Does not assert live Explorer icon-cache refresh.'};
  await writeFile(path.join(root,'design-references/dayweave-logo/checks.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
}finally{if(browser)await browser.close();server.kill();}
