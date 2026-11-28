const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const pause = ms => new Promise(r => setTimeout(r, ms));
const dir = path.resolve('Temp/cache/dayweave-interactions');
const mode = process.argv[2] || 'core';
assert.ok(['core', 'calendar', 'trash', 'consistency'].includes(mode), `Unknown suite: ${mode}`);
fs.mkdirSync(dir, {recursive:true});
const profile = fs.mkdtempSync(path.join(dir, `profile-${mode}-`));
const browser = process.env.DAYWEAVE_TEST_CHROME || [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
  .filter(Boolean).flatMap(root => ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe']
    .map(exe => path.join(root, exe))).find(exe => fs.existsSync(exe));
assert.ok(browser && fs.existsSync(browser), 'Install Chrome/Edge or set DAYWEAVE_TEST_CHROME to its executable.');
const {pathToFileURL} = require('node:url');
function fixture(mode) {
  const ls = [];
  const calls = [];
  const fixedNow = Date.parse('2026-10-01T01:00:00Z');
  window.Date = class extends Date {
    constructor(...args) { super(...(args.length ? args : [fixedNow])); }
    static now() { return fixedNow; }
  };
  const day = '2026-10-01';
  const task = {id:'audit-task',title:'Audit initial',note:'',mode:'timeline',tagId:'',priority:'',done:false,date:day,startMin:607,duration:61,dateStart:day,dateEnd:day,subtasks:[],deletedAt:null,createdAt:day,updatedAt:day};
  const state = {snap:{tasks:[task],drafts:[],recurringRules:[],archivedRecurringRules:[],trash:[],tags:[],settings:{'ui.show_lunar':'true','ui.auto_draft':'true'}}, fail:new Set(), defer:new Set(), pending:[], calls, ls, occurrences:[]};
  window.audit = state;
  if (mode === 'trash') state.snap.trash=[{...task,id:'trash-a',deletedAt:day},{...task,id:'trash-b',deletedAt:day}];
  if (mode === 'consistency') {
    state.snap.tags = [{id:'work',name:'work',color:'blue'}, {id:'shop',name:'workshop',color:'rose'}];
    state.snap.drafts = [{...task,id:'tagged-draft',title:'Tagged draft',mode:'pool',tagId:'work'}];
    state.snap.tasks.push(...['Timeline drop','Mini calendar drop','Month drop'].map(title=>({...task,id:title,title,mode:'pool',startMin:0,duration:45})));
    const rule = {id:'national',title:'节后工作日',note:'',tagId:'',priority:'',frequency:'weekdays',weekdays:[],monthDay:null,mode:'timeline',startMin:570,duration:30,startsOn:day,endsOn:null,active:true,createdAt:day,updatedAt:day};
    state.snap.recurringRules = [rule, {...rule,id:'makeup',title:'周末补班',startsOn:'2026-10-10'}];
    state.occurrences = ['2026-11-20','2026-12-20','2027-01-20'].map((date,i) => ({...rule,id:date,ruleId:rule.id,occurrenceDate:date,title:`Range ${i+1}`,done:false,skipped:false}));
  }
  window.__TAURI_INTERNALS__ = {metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:cb=>ls.push(cb),unregisterCallback:()=>{},invoke:async(cmd,args)=>{
    calls.push({cmd,args:structuredClone(args)});
    if(state.fail.has(cmd)) throw 'audit injected SQLite write failure';
    if(state.defer.has(cmd)) await new Promise(resolve=>state.pending.push({cmd,args,resolve}));
    switch(cmd) {
      case 'get_workspace_snapshot': return structuredClone(state.snap);
      case 'list_recurring_occurrences_range': return state.occurrences.filter(o=>o.occurrenceDate>=args.fromDate && o.occurrenceDate<=args.toDate);
      case 'set_ui_setting': state.snap.settings[args.key] = args.value; return null;
      case 'delete_tag': {
        state.snap.tags = state.snap.tags.filter(t=>t.id!==args.tagId);
        for (const d of state.snap.drafts) if (d.tagId===args.tagId) d.tagId='';
        return null;
      }
      case 'get_autostart_enabled': return false;
      case 'create_task': {
        if (args.fromDraftId && !state.snap.drafts.some(d=>d.id===args.fromDraftId)) throw 'missing draft';
        const saved = {...task,...args.input,id:'created-'+calls.length};
        state.snap.tasks.push(saved);
        state.snap.drafts = state.snap.drafts.filter(d=>d.id!==args.fromDraftId);
        return saved;
      }
      case 'update_task': { const i = state.snap.tasks.findIndex(t=>t.id===args.taskId); const saved = {...state.snap.tasks[i],...args.input}; state.snap.tasks[i]=saved; return saved; }
      case 'upsert_draft': { const saved = {...args.input,id:args.input.id||'draft-'+calls.length,updatedAt:day}; state.snap.drafts = [...state.snap.drafts.filter(d=>d.id!==saved.id),saved]; return saved; }
      case 'soft_delete_task': {
        const target = state.snap.tasks.find(t=>t.id===args.taskId);
        const deleted = {...target,deletedAt:day,updatedAt:day};
        state.snap.tasks = state.snap.tasks.filter(t=>t.id!==args.taskId);
        state.snap.trash = [deleted, ...state.snap.trash];
        return deleted;
      }
      case 'restore_task': {
        const target = state.snap.trash.find(t=>t.id===args.taskId);
        const restored = {...target,deletedAt:null,updatedAt:day};
        state.snap.trash = state.snap.trash.filter(t=>t.id!==args.taskId);
        state.snap.tasks = [restored, ...state.snap.tasks];
        return restored;
      }
      case 'purge_task': state.snap.trash = state.snap.trash.filter(t=>t.id!==args.taskId); return null;
      case 'empty_trash': state.snap.trash = []; return 1;
      case 'create_recurring_rule': { const saved = {...args.input,id:'rule-a',createdAt:day,updatedAt:day}; state.snap.recurringRules.push(saved); return saved; }
      case 'update_recurring_rule': { const saved = {...state.snap.recurringRules[0],...args.input}; state.snap.recurringRules[0]=saved; return saved; }
      case 'archive_recurring_rule': {
        const rule = state.snap.recurringRules.find(r=>r.id===args.ruleId);
        const archived = {...rule,active:false,updatedAt:day};
        state.snap.recurringRules = state.snap.recurringRules.filter(r=>r.id!==args.ruleId);
        state.snap.archivedRecurringRules = [archived, ...state.snap.archivedRecurringRules.filter(r=>r.id!==args.ruleId)];
        return archived;
      }
      case 'restore_recurring_rule': {
        const rule = state.snap.archivedRecurringRules.find(r=>r.id===args.ruleId);
        const restored = {...rule,active:true,updatedAt:day};
        state.snap.archivedRecurringRules = state.snap.archivedRecurringRules.filter(r=>r.id!==args.ruleId);
        state.snap.recurringRules = [restored, ...state.snap.recurringRules.filter(r=>r.id!==args.ruleId)];
        return restored;
      }
      default: return null;
    }
  }};
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {unregisterListener:()=>{}};
}
async function run() {
  const {createServer} = await import(pathToFileURL(path.resolve('node_modules/vite/dist/node/index.js')));
  const vite = await createServer({configFile:false,cacheDir:path.join(dir,'vite'),esbuild:{jsx:'automatic'},optimizeDeps:{entries:['index.html']},plugins:[{name:'interaction-fixture',transformIndexHtml:{order:'pre',handler(html){return html.replace('<head>',`<head><script>(${fixture})(${JSON.stringify(mode)})</script>`);}}}],server:{host:'127.0.0.1',port:0,watch:null}});
  let chrome, ws;
  try {
    await vite.listen();
    const port = vite.httpServer.address().port;
    chrome = spawn(browser,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--window-size=1280,800','about:blank'],{stdio:'ignore'});
    for(let i=0;i<100&&!fs.existsSync(path.join(profile,'DevToolsActivePort'));i++) await pause(50);
    const debugPort = fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];
    const target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(t=>t.type==='page');
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((done,fail)=>{ws.onopen=done;ws.onerror=fail;});
    let seq=0;const pending=new Map();const errors=[];
    ws.onmessage=e=>{const x=JSON.parse(e.data);if(x.method==='Runtime.exceptionThrown')errors.push(x.params.exceptionDetails);if(pending.has(x.id)){const [done,fail]=pending.get(x.id);pending.delete(x.id);x.error?fail(x.error):done(x.result);}};
    const rpc=(method,params={})=>new Promise((done,fail)=>{const id=++seq;pending.set(id,[done,fail]);ws.send(JSON.stringify({id,method,params}));});
    const evaluate=async expression=>{const r=await rpc('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
    const js=(fn,...args)=>evaluate(`(${fn})(${args.map(x=>JSON.stringify(x)).join(',')})`);
    const wait=async expression=>{for(let i=0;i<150;i++){if(await evaluate(`Boolean(${expression})`))return;await pause(40);}throw Error(`Wait timed out: ${expression}\n${JSON.stringify(errors)}\n${await evaluate('document.body.innerText.slice(0,1000)')}`);};
    const click=selector=>js(s=>document.querySelector(s).click(),selector);
    const press=async (key,mods=0)=>{const code=key.length===1?'Key'+key.toUpperCase():key;const v={Escape:27,Tab:9,Enter:13,n:78}[key];await rpc('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:v,modifiers:mods,...(key==='Enter'?{text:'\r',unmodifiedText:'\r'}:{})});await rpc('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:v,modifiers:mods});};
    const type=s=>rpc('Input.insertText',{text:s});
    const trace=()=>evaluate('audit.calls.map(x=>x.cmd)');
    const log=(name,data)=>console.log(name,JSON.stringify(data));
    await rpc('Runtime.enable');
    await rpc('Page.enable');
    await rpc('Emulation.setDeviceMetricsOverride',{width:960,height:640,deviceScaleFactor:1,mobile:false});
    await rpc('Page.navigate',{url:`http://127.0.0.1:${port}/`});
    await wait('window.audit?.calls.some(x=>x.cmd==="list_recurring_occurrences_range") && document.querySelector(".dw-workbench")');
    const day = await evaluate('audit.snap.tasks[0].date');
    const open=async title=>{await press('n',2);await wait('document.activeElement?.placeholder?.includes("标题")');await type(title);await wait(`document.activeElement.value === ${JSON.stringify(title)}`);};
    const writes=async cmd=>(await trace()).filter(x=>x===cmd).length;
    const byText=(selector,label)=>js((s,l)=>[...document.querySelectorAll(s)].find(b=>b.textContent.trim()===l).click(),selector,label);
    const pointerByText=async (selector,label)=>{
      const {x,y}=await js((s,l)=>{const el=[...document.querySelectorAll(s)].find(b=>b.textContent.trim()===l);el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};},selector,label);
      await rpc('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
      await rpc('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
    };
    const fault=(cmd,enabled)=>js((c,v)=>v?audit.fail.add(c):audit.fail.delete(c),cmd,enabled);
    const defer=cmd=>js(c=>audit.defer.add(c),cmd);
    const release=cmd=>js(c=>{audit.defer.delete(c);const [request]=audit.pending.splice(audit.pending.findIndex(p=>p.cmd===c),1);request.resolve();},cmd);
    const retryTwice=selector=>js(s=>{const form=document.querySelector(s);form.requestSubmit();form.requestSubmit();},selector);
    const count=selector=>js(s=>document.querySelectorAll(s).length,selector);
    if(mode==='core') {
      await open('escape preserves draft');
      await click('.dw-modal button[aria-label="安排方式"]');
      await wait('!!document.querySelector("[role=listbox]")');
      await press('Escape');
      await wait('!document.querySelector("[role=listbox]")');
      assert.equal(await writes('upsert_draft'),0);
      assert.equal(await count('.dw-modal'),1);
      await press('Escape');
      await wait('!document.querySelector(".dw-modal")');
      assert.equal(await writes('upsert_draft'),1);
      assert.equal(await evaluate('audit.snap.drafts[0].title'),'escape preserves draft');

      await open('close preserves draft');
      await click('.dw-modal [aria-label="关闭弹窗"]');
      await wait('!document.querySelector(".dw-modal")');
      await open('backdrop preserves draft');
      await js(()=>document.querySelector('.dw-modal-backdrop').dispatchEvent(new MouseEvent('mousedown',{bubbles:true})));
      await wait('!document.querySelector(".dw-modal")');
      assert.deepEqual(await evaluate('audit.snap.drafts.map(d=>d.title)'),['escape preserves draft','close preserves draft','backdrop preserves draft']);

      await fault('upsert_draft',true);
      await open('draft retry');
      await press('Escape');
      await wait('document.querySelector(".dw-toast.is-error")?.innerText.includes("暂存草稿失败")');
      assert.equal(await evaluate('document.querySelector(".dw-modal input").value'),'draft retry');
      await fault('upsert_draft',false);
      await defer('upsert_draft');
      await press('Escape');
      await wait('audit.pending.some(p=>p.cmd==="upsert_draft")');
      const draftsBefore = await writes('upsert_draft');
      await press('Escape');
      await click('.dw-modal [aria-label="关闭弹窗"]');
      assert.equal(await writes('upsert_draft'),draftsBefore);
      assert.equal(await count('.dw-modal'),1);
      await release('upsert_draft');
      await wait('!document.querySelector(".dw-modal")');

      await press('n',2);
      await wait('!!document.querySelector(".dw-modal-draft-row button")');
      await click('.dw-modal-draft-row button');
      await byText('.dw-modal-draft-item span','escape preserves draft');
      await wait('document.querySelector(".dw-modal input")?.value === "escape preserves draft"');
      const draftId=await evaluate('audit.snap.drafts[0].id');
      await js(()=>document.querySelector('.dw-modal textarea').focus());
      await type('preserve note');
      await fault('create_task',true);
      await click('.dw-modal button[type=submit]');
      await wait('document.querySelector(".dw-toast.is-error")?.innerText.includes("创建任务失败")');
      assert.equal(await evaluate('document.querySelector(".dw-modal textarea").value'),'preserve note');
      assert.equal(await evaluate('audit.snap.tasks.length'),1);
      assert.equal(await evaluate('audit.snap.drafts.length'),4);
      await press('n',2);
      assert.equal(await evaluate('document.querySelector(".dw-modal input").value'),'escape preserves draft');
      await fault('create_task',false);
      await defer('create_task');
      await retryTwice('.dw-modal form');
      await wait('audit.pending.some(p=>p.cmd==="create_task")');
      await press('Escape');
      assert.equal(await count('.dw-modal'),1);
      assert.equal(await writes('create_task'),2);
      assert.equal(await evaluate('audit.pending.find(p=>p.cmd==="create_task").args.fromDraftId'),draftId);
      await release('create_task');
      await wait('!document.querySelector(".dw-modal")');
      assert.equal(await writes('delete_draft'),0);
      assert.equal(await evaluate('audit.snap.drafts.length'),3);
      assert.equal(await evaluate('audit.snap.tasks.length'),2);

      await js(()=>document.querySelector('.dw-quick-input').focus());
      await type('quick retry');
      await fault('create_task',true);
      await press('Enter');
      await wait('document.querySelector(".dw-toast.is-error")?.innerText.includes("快速创建失败")');
      assert.equal(await evaluate('document.querySelector(".dw-quick-input").value'),'quick retry');
      await fault('create_task',false);
      await defer('create_task');
      await retryTwice('.dw-quick-form');
      await wait('audit.pending.some(p=>p.cmd==="create_task")');
      assert.equal(await writes('create_task'),4);
      await release('create_task');
      await wait('document.querySelector(".dw-quick-input").value === ""');
      log('DRAFT_AND_TASK_SAVES',{nestedEscape:true,escapeCloseBackdrop:3,retry:true,duplicateWrites:0,atomicCommand:true});

      await click('button[aria-label="重复规则"]');
      await byText('.dw-module button','+ 新建重复规则');
      await js(()=>document.querySelector('.dw-modal input').focus());
      await type('rule retry');
      await fault('create_recurring_rule',true);
      await click('.dw-modal button[type=submit]');
      await wait('document.querySelector(".dw-toast.is-error")?.innerText.includes("创建重复规则失败")');
      assert.equal(await evaluate('document.querySelector(".dw-modal input").value'),'rule retry');
      await fault('create_recurring_rule',false);
      await defer('create_recurring_rule');
      await retryTwice('.dw-modal form');
      await wait('audit.pending.some(p=>p.cmd==="create_recurring_rule")');
      assert.equal(await writes('create_recurring_rule'),2);
      await release('create_recurring_rule');
      await wait('!document.querySelector(".dw-modal")');
      await byText('.dw-recurring-card button','编辑');
      await js(()=>{const input=document.querySelector('.dw-modal input');input.focus();input.select();});
      await type('edit retry');
      await fault('update_recurring_rule',true);
      await click('.dw-modal button[type=submit]');
      await wait('document.querySelector(".dw-toast.is-error")?.innerText.includes("更新重复规则失败")');
      assert.equal(await evaluate('document.querySelector(".dw-modal input").value'),'edit retry');
      await fault('update_recurring_rule',false);
      await click('.dw-modal button[type=submit]');
      await wait('!document.querySelector(".dw-modal")');
      await byText('.dw-recurring-card button','归档');
      await wait('!!document.querySelector("dialog.dw-modal[open]")');
      assert.equal(await evaluate('document.activeElement?.textContent?.trim()'),'取消');
      await byText('dialog.dw-modal[open] button','取消');
      await wait('!document.querySelector("dialog.dw-modal")');
      assert.equal(await writes('archive_recurring_rule'),0);
      await byText('.dw-recurring-card button','归档');
      await wait('!!document.querySelector("dialog.dw-modal[open]")');
      await byText('dialog.dw-modal[open] button','确认归档');
      await wait('!document.querySelector("dialog.dw-modal") && !document.querySelector(".dw-recurring-card")');
      assert.equal(await writes('archive_recurring_rule'),1);
      await js(()=>[...document.querySelectorAll('.dw-tab-btn')].find(b=>b.textContent.includes('已归档')).click());
      await wait('document.querySelectorAll(".dw-recurring-card.is-archived").length === 1');
      await byText('.dw-recurring-card button','恢复规则');
      await wait('!!document.querySelector("dialog.dw-modal[open]")');
      assert.equal(await evaluate('document.activeElement?.textContent?.trim()'),'取消');
      await byText('dialog.dw-modal[open] button','取消');
      await wait('!document.querySelector("dialog.dw-modal")');
      assert.equal(await writes('restore_recurring_rule'),0);
      await byText('.dw-recurring-card button','恢复规则');
      await wait('!!document.querySelector("dialog.dw-modal[open]")');
      await byText('dialog.dw-modal[open] button','确认恢复');
      await wait('!document.querySelector("dialog.dw-modal") && document.querySelectorAll(".dw-recurring-card.is-archived").length === 0');
      assert.equal(await writes('restore_recurring_rule'),1);
      await js(()=>[...document.querySelectorAll('.dw-tab-btn')].find(b=>b.textContent.includes('当前规则')).click());
      await wait('document.querySelectorAll(".dw-recurring-card").length === 1');
      log('RECURRING_FORM',{createRetry:true,updateRetry:true,duplicateWrites:0,archiveConfirm:true,archiveCommand:true,archivedTab:true,restoreConfirm:true,restoreCommand:true});
    }
    if(mode==='calendar') {
      await js(()=>{const g=document.querySelector('.dw-timeline-grid');g.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,clientY:g.getBoundingClientRect().top+980}));});
      await wait('document.activeElement?.closest(".dw-inline-create")');
      await type('calendar retry');
      const header = await evaluate('document.querySelector(".dw-inline-create-top").textContent');
      assert.ok(header.includes(`安排到 ${Number(day.slice(5,7))}月${Number(day.slice(8))}日`));
      await click('button[aria-label="后一天"]');
      assert.equal(await count('.dw-grid-ghost'),0);
      assert.equal(await evaluate('document.querySelector(".dw-inline-create-top").textContent'),header);
      await fault('create_task',true);
      await click('.dw-inline-create button[type=submit]');
      await wait('document.querySelector(".dw-toast.is-error")?.innerText.includes("创建失败")');
      assert.equal(await evaluate('document.querySelector(".dw-inline-create input").value'),'calendar retry');
      await fault('create_task',false);
      await defer('create_task');
      await retryTwice('.dw-inline-create form');
      await wait('audit.pending.some(p=>p.cmd==="create_task")');
      assert.equal(await writes('create_task'),2);
      const actual=await evaluate('audit.pending.find(p=>p.cmd==="create_task").args.input');
      assert.deepEqual([actual.date,actual.dateStart,actual.dateEnd,actual.startMin],[day,day,day,975]);
      await release('create_task');
      await wait('!document.querySelector(".dw-inline-create")');
      await click('button[aria-label="前一天"]');
      await wait('[...document.querySelectorAll(".dw-event-title")].some(el=>el.textContent.includes("calendar retry"))');
      log('INLINE_PINNED_DATE',{openedOn:day,submittedOn:actual.date,startMin:actual.startMin,retry:true,duplicateWrites:0});
    }
    if(mode==='trash') {
      await wait('!!document.querySelector(".dw-event-title")');
      await pointerByText('.dw-event-title','Audit initial');
      await wait('!!document.querySelector(".dw-drawer-right")');
      await js(()=>{const input=document.querySelector('.dw-drawer-right input[type=text]');input.focus();});
      await type(' edited');
      await wait('!!document.querySelector(".dw-insp-dirty-badge")');
      await press('Escape');
      await wait('!!document.querySelector("dialog.dw-modal[open]")');
      assert.equal(await evaluate('document.activeElement?.textContent?.trim()'),'继续编辑');
      await byText('dialog.dw-modal[open] button','继续编辑');
      await wait('!document.querySelector("dialog.dw-modal") && !!document.querySelector(".dw-drawer-right")');
      await byText('.dw-drawer-right button','取消');
      await wait('!!document.querySelector("dialog.dw-modal[open]")');
      await byText('dialog.dw-modal[open] button','放弃修改');
      await wait('!document.querySelector("dialog.dw-modal") && !document.querySelector(".dw-drawer-right")');
      assert.equal(await writes('update_task'),0);
      assert.equal(await evaluate('document.querySelector(".dw-event-title").textContent'),'Audit initial');

      await pointerByText('.dw-event-title','Audit initial');
      await wait('!!document.querySelector(".dw-drawer-right")');
      await byText('.dw-drawer-right button','移入回收站');
      await wait('!!document.querySelector("dialog.dw-modal[open]")');
      assert.equal(await evaluate('document.activeElement.textContent.trim()'),'取消');
      await byText('dialog.dw-modal[open] button','取消');
      await wait('!document.querySelector("dialog.dw-modal")');
      assert.equal(await writes('soft_delete_task'),0);
      await byText('.dw-drawer-right button','移入回收站');
      await wait('!!document.querySelector("dialog.dw-modal[open]")');
      await byText('dialog.dw-modal[open] button','确认移入');
      await wait('!document.querySelector("dialog.dw-modal[open]") && !document.querySelector(".dw-drawer-right")');
      assert.equal(await writes('soft_delete_task'),1);

      await click('button[aria-label="回收站"]');
      await wait('document.querySelectorAll(".dw-module .dw-task-row").length === 3');
      assert.equal(await count('.dw-trash-countdown'),3);
      assert.ok(await evaluate('document.querySelector(".dw-trash-countdown").textContent.includes("天后彻底删除")'));
      const restoreBtn=()=>pointerByText('.dw-module button','恢复任务');
      const purge=()=>pointerByText('.dw-module button','彻底删除');
      const empty=()=>pointerByText('.dw-module button','清空回收站');
      assert.equal(await evaluate('getComputedStyle(document.querySelector("dialog")).display'),'none');
      assert.ok(await evaluate('[...document.querySelectorAll(".dw-module button")].find(b=>b.textContent.trim()==="彻底删除").classList.contains("dw-btn-danger-outline")'));
      await restoreBtn();
      await wait('!!document.querySelector("dialog[open]")');
      assert.equal(await evaluate('document.activeElement.textContent.trim()'),'取消');
      await byText('dialog button','取消');
      await wait('!document.querySelector("dialog[open]")');
      assert.equal(await writes('restore_task'),0);
      await restoreBtn();
      await wait('!!document.querySelector("dialog[open]")');
      await byText('dialog button','确认恢复');
      await wait('!document.querySelector("dialog[open]") && document.querySelectorAll(".dw-module .dw-task-row").length === 2');
      assert.equal(await writes('restore_task'),1);
      await purge();
      await wait('!!document.querySelector("dialog[open]")');
      assert.equal(await evaluate('document.activeElement.textContent.trim()'),'取消');
      assert.ok(await evaluate('document.querySelector("dialog").innerText.includes("Audit initial")'));
      await byText('dialog button','取消');
      await wait('!document.querySelector("dialog[open]")');
      assert.equal(await writes('purge_task'),0);
      await empty();
      await wait('!!document.querySelector("dialog[open]")');
      assert.ok(await evaluate('document.querySelector("dialog").innerText.includes("2 项任务")'));
      await press('Escape');
      await wait('!document.querySelector("dialog[open]")');
      assert.equal(await writes('empty_trash'),0);
      assert.equal(await count('.dw-task-row'),2);
      await purge();
      await defer('purge_task');
      await pointerByText('dialog button','确认彻底删除');
      await wait('audit.pending.some(p=>p.cmd==="purge_task")');
      await press('Escape');
      assert.equal(await count('dialog[open]'),1);
      await byText('dialog button','确认彻底删除');
      assert.equal(await writes('purge_task'),1);
      await release('purge_task');
      await wait('!document.querySelector("dialog[open]") && document.querySelectorAll(".dw-task-row").length === 1');
      await empty();
      await byText('dialog button','确认清空');
      await wait('!document.querySelector("dialog[open]") && !document.querySelector(".dw-task-row")');
      assert.equal(await writes('empty_trash'),1);
      log('TRASH_CONFIRMATION',{cancelWrites:0,softDeleteWrites:1,restoreWrites:1,purgeWrites:1,emptyWrites:1,safeFocus:true});
    }
    if(mode==='consistency') {
      await click('button[aria-label="重复规则"]');
      await wait('document.querySelectorAll(".dw-recurring-card").length === 2');
      const previews = await evaluate('[...document.querySelectorAll(".dw-recurring-card")].map(c=>c.innerText)');
      assert.match(previews[0], /下次安排：10月8日 09:30/);
      assert.match(previews[1], /下次安排：10月10日 09:30/);

      await click('button[aria-label="日程"]');
      await byText('.dw-view-switch button','月');
      const nextMonth = () => click('.dw-canvas button[aria-label="下个月"]');
      await defer('list_recurring_occurrences_range');
      await nextMonth();
      await wait('audit.pending.length === 1');
      await nextMonth();
      await wait('audit.pending.length === 2 && document.querySelector(".dw-occurrence-status")?.textContent.includes("正在加载")');
      await js(()=>audit.pending.pop().resolve());
      await wait('!document.querySelector(".dw-occurrence-status") && document.querySelector(".dw-canvas").innerText.includes("Range 2")');
      await release('list_recurring_occurrences_range');
      // Let the older reply pass through React before checking the current month's content.
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      assert.match(await evaluate('document.querySelector(".dw-canvas").innerText'), /Range 2/);
      await fault('list_recurring_occurrences_range',true);
      await nextMonth();
      await wait('document.querySelector(".dw-occurrence-status")?.textContent.includes("加载失败")');
      assert.doesNotMatch(await evaluate('document.querySelector(".dw-canvas").innerText'), /Range 2/);
      await fault('list_recurring_occurrences_range',false);
      await click('.dw-occurrence-status button');
      await wait('!document.querySelector(".dw-occurrence-status") && document.querySelector(".dw-canvas").innerText.includes("Range 3")');
      log('OCCURRENCES',{newestRangeWins:true,retry:true,holidayPreview:true,makeupDayPreview:true});

      await click('button[aria-label="设置"]');
      const lunar = '.dw-settings-card [role=switch]';
      await wait(`document.querySelector('${lunar}')?.getAttribute('aria-checked') === 'true'`);
      await fault('set_ui_setting',true);
      await click(lunar);
      await wait('document.querySelector(".dw-toast.is-error")?.innerText.includes("保存设置失败")');
      assert.equal(await js(sel=>document.querySelector(sel).getAttribute('aria-checked'),lunar),'true');
      assert.equal(await evaluate('audit.snap.settings["ui.show_lunar"]'),'true');
      await fault('set_ui_setting',false);
      await defer('set_ui_setting');
      await js(sel=>{const el=document.querySelector(sel);el.click();el.click();},lunar);
      await wait(`audit.pending.length === 1 && document.querySelector('${lunar}').disabled`);
      assert.equal(await writes('set_ui_setting'),2);
      assert.equal(await js(sel=>document.querySelector(sel).getAttribute('aria-checked'),lunar),'true');
      await release('set_ui_setting');
      await wait(`document.querySelector('${lunar}')?.getAttribute('aria-checked') === 'false'`);
      assert.equal(await evaluate('audit.snap.settings["ui.show_lunar"]'),'false');

      await js(()=>document.querySelector('.dw-quick-detail-btn').focus());
      await press('Enter');
      await wait('document.activeElement?.placeholder?.includes("标题")');
      for (const mods of [0,8]) for (let i=0;i<14;i++) {
        await press('Tab',mods);
        assert.ok(await evaluate('!!document.activeElement.closest(".dw-modal")'));
      }
      assert.ok(await evaluate('document.querySelector(".dw-titlebar").inert && document.querySelector(".dw-workspace-body").inert'));
      await click('.dw-modal [aria-label="安排方式"]');
      await pointerByText('[role=option]','全天 / 多日');
      await click('.dw-modal [aria-label="开始日期"]');
      await wait('!!document.querySelector(".dw-modal .dw-date-popover")');
      await press('Escape');
      await wait('!document.querySelector(".dw-date-popover")');
      assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'),'开始日期');
      await click('.dw-modal [aria-label="开始日期"]');
      await pointerByText('.dw-date-popover button','今天');
      await wait('!document.querySelector(".dw-date-popover")');
      await press('Escape');
      await wait('!document.querySelector(".dw-modal") && document.activeElement.matches(".dw-quick-detail-btn")');
      assert.equal(await writes('upsert_draft'),0);
      log('SETTINGS_AND_FOCUS',{failureRetainsValue:true,retry:true,tabAndShiftTab:true,popups:true,restoredFocus:true});

      await js(()=>document.querySelector('.dw-quick-input').focus());
      await type('send #workshop');
      await press('Enter');
      await wait('audit.snap.tasks.some(t=>t.title==="send" && t.tagId==="shop")');
      await js(()=>[...document.querySelectorAll('.dw-settings-card span')].find(el=>el.textContent==='#work').parentElement.parentElement.querySelector('button').click());
      await wait('!!document.querySelector("dialog.dw-modal[open]")');
      assert.equal(await evaluate('document.activeElement?.textContent?.trim()'),'取消');
      await byText('dialog.dw-modal[open] button','取消');
      await wait('!document.querySelector("dialog.dw-modal")');
      assert.equal(await writes('delete_tag'),0);
      await js(()=>[...document.querySelectorAll('.dw-settings-card span')].find(el=>el.textContent==='#work').parentElement.parentElement.querySelector('button').click());
      await wait('!!document.querySelector("dialog.dw-modal[open]")');
      await byText('dialog.dw-modal[open] button','确认删除');
      await wait('!document.querySelector("dialog.dw-modal") && audit.snap.tags.every(t=>t.id!=="work")');
      assert.equal(await writes('delete_tag'),1);
      await click('button[aria-label="草稿箱"]');
      await click('.dw-draft-card');
      await wait('document.querySelector(".dw-modal input")?.value === "Tagged draft"');
      assert.match(await evaluate('document.querySelector(\'.dw-modal [aria-label="任务标签"]\').innerText'), /无标签/);
      await click('.dw-modal button[type=submit]');
      await wait('!document.querySelector(".dw-modal") && audit.snap.tasks.some(t=>t.title==="Tagged draft" && t.tagId==="")');
      assert.equal(await evaluate('audit.calls.findLast(x=>x.cmd==="create_task").args.fromDraftId'),'tagged-draft');

      await click('button[aria-label="日程"]');
      await byText('.dw-view-switch button','日');
      await byText('.dw-canvas button','回到今天');
      await wait('document.querySelector(".dw-event-title")?.textContent === "Audit initial"');
      async function drag(selector, delta, start, duration, modifiers=0, releaseDelta=delta, releaseStart=start, releaseDuration=duration) {
        const {x,y} = await js(sel=>{const el=document.querySelector(sel);el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.left+r.width*0.6,y:r.top+r.height/2};},selector);
        await rpc('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1,modifiers});
        await rpc('Input.dispatchMouseEvent',{type:'mouseMoved',x,y:y+delta,buttons:1,modifiers});
        const block = 'document.querySelector(".dw-event-block")';
        await wait(`${block}.style.top === '${start}px' && ${block}.style.height === '${duration}px'`);
        await rpc('Input.dispatchMouseEvent',{type:'mouseReleased',x,y:y+releaseDelta,button:'left',clickCount:1,modifiers});
        await wait(`audit.snap.tasks[0].startMin === ${releaseStart} && audit.snap.tasks[0].duration === ${releaseDuration}`);
      }
      await drag('.dw-event-block',15,615,61,0,30,630,61);
      await drag('.dw-event-block .dw-resize-bottom',-16,630,45);
      await drag('.dw-event-block .dw-resize-top',-8,620,55,1);
      assert.equal(await writes('update_task'),3);
      log('TAGS_AND_DRAG',{longTagWins:true,restoredDraftCleared:true,absoluteMove:true,absoluteResize:true,altSnap:true,releaseCoordinates:true});

      const mouse = (type, point, buttons) => rpc('Input.dispatchMouseEvent',{type,...point,buttons,button:buttons || type!=='mouseMoved' ? 'left' : 'none',clickCount:1});
      const pointAt = (selector, minute) => js((s,m)=>{
        const el = document.querySelector(s);
        if (m === null) el.scrollIntoView({block:'nearest'});
        else el.closest('.dw-timeline-scroll').scrollTop = m - 150;
        const rect = el.getBoundingClientRect();
        return {x:Math.round(rect.left + rect.width / 2),y:Math.round(rect.top + (m ?? rect.height / 2))};
      },selector,minute ?? null);
      const dragPoolTaskTo = async (title, target, preview) => {
        const source = await js(t=>{
          const el = [...document.querySelectorAll('.dw-pool-card-title')].find(e=>e.textContent===t);
          el.scrollIntoView({block:'nearest'});
          const r=el.getBoundingClientRect();
          const x=Math.round(r.left+12), y=Math.round(r.top+r.height/2);
          if (document.elementFromPoint(x,y) !== el) throw Error(`Pool drag source not hit: ${x},${y}: ${document.elementFromPoint(x,y)?.className}`);
          return {x,y};
        },title);
        await mouse('mouseMoved',source,0);
        await mouse('mousePressed',source,1);
        await mouse('mouseMoved',{x:source.x+16,y:source.y},1);
        await mouse('mouseMoved',target,1);
        await wait('!!document.querySelector(".dw-pool-drag-ghost")');
        await wait(preview);
      };
      const dropPoolTask = async (title, selector, preview, date, startMin, minute) => {
        const target = await pointAt(selector,minute);
        await dragPoolTaskTo(title,target,preview);
        await mouse('mouseReleased',target,0);
        await wait(`audit.snap.tasks.find(t=>t.id===${JSON.stringify(title)}).mode === 'timeline'`);
        const {taskId,input} = await evaluate('audit.calls.findLast(x=>x.cmd==="update_task").args');
        assert.deepEqual([taskId,input.mode,input.date,input.startMin,input.duration],[title,'timeline',date,startMin,45]);
        await wait(`![...document.querySelectorAll('.dw-pool-card-title')].some(e=>e.textContent===${JSON.stringify(title)})`);
      };
      const grid = '.dw-timeline-grid';
      const ghost = 'document.querySelector(".dw-grid-ghost")';
      await dragPoolTaskTo('Timeline drop',await pointAt(grid,753),`${ghost}?.textContent.includes('Timeline drop')`);
      await mouse('mouseMoved',{x:10,y:10},1);
      await wait(`!${ghost}`);
      await mouse('mouseReleased',{x:10,y:10},0);
      await wait('!document.querySelector(".dw-pool-drag-ghost")');
      assert.equal(await writes('update_task'),3);
      await dropPoolTask('Timeline drop',grid,`${ghost}?.style.top==='750px' && ${ghost}.style.height==='45px'`,day,750,753);
      const mini = '.dw-minical-cell[data-date="2026-10-02"]';
      await dropPoolTask('Mini calendar drop',mini,`document.querySelector(${JSON.stringify(mini+'.is-drop-over')})`,'2026-10-02',570);
      await byText('.dw-view-switch button','月');
      const month = '.dw-month-cell.is-selected + .dw-month-cell';
      await dropPoolTask('Month drop',month,`document.querySelector('${month}.is-drop-over')`,'2026-10-03',570);
      assert.equal(await writes('update_task'),6);
      assert.equal(JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json','utf8')).app.windows[0].dragDropEnabled,false,
        'Windows Tauri drag-drop interception must be disabled');
      log('POOL_DRAG',{timeline:true,miniCalendar:true,monthCalendar:true,cancelWrites:0,pointerDrag:true});
    }
    assert.deepEqual(errors.map(e=>e.exception?.description||e.text),[]);
  } finally {if(ws)ws.close();if(chrome)chrome.kill();await vite.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
