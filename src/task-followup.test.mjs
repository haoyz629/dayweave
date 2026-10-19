import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { followupActionLabel, canCreateTaskFollowup } from './task-followup.ts';
const source=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('unfinished tasks may create followups without day restrictions',()=>{
  for(const status of ['open','scheduled']) assert.equal(canCreateTaskFollowup({status}),true);
  for(const task of [null,undefined,{status:'done'},{status:'deleted'}]) assert.equal(canCreateTaskFollowup(task),false);
});
test('existing followup lookup is unrelated to date and deleted children do not block new creation',()=>{
  assert.equal(followupActionLabel(undefined),'创建后续任务');
  assert.equal(followupActionLabel([]),'创建后续任务');
  for(const starts_at of [null,'2026-10-20T09:00:00+08:00','2026-12-31T09:00:00+08:00']) {
    assert.equal(followupActionLabel([{task_id:'child',title:'renamed',status:'scheduled',starts_at}]),'查看后续任务');
  }
  assert.equal(followupActionLabel([{task_id:'child',status:'done'}]),'查看后续任务');
  assert.equal(followupActionLabel([{task_id:'child',status:'deleted'}]),'创建后续任务');
});
test('followup entry reuses guarded navigation, persisted drafts and source metadata',()=>{
  const app=source('./App.tsx');
  assert.match(app,/prepareTaskFollowup\(sourceTaskId\)/);
  assert.match(app,/await openPersistedTaskDraft\(result.draft\)/);
  assert.match(app,/change.kind === "linked-select"/);
  assert.match(app,/change.kind === "followup"/);
  assert.match(app,/persistedNewTaskDraft\?\.origin && <TaskOriginBanner/);
  assert.match(app,/!persistedNewTaskDraft\?\.target_task_id && !persistedNewTaskDraft\?\.origin/);
  assert.match(app,/Boolean\(intent.followupSourceId\)/);
  assert.match(app,/creating\) \{\s*if \(!await saveNewTaskBeforeLeaving\(\)\) return;/);
});
test('lineage displays actual IDs and separate execution notes, never copies source notes into new input',()=>{
  const lineage=source('./task-lineage.tsx'),api=source('./tauri.ts');
  assert.match(lineage,/onOpenTask\(origin.source_task_id!\)/);
  assert.match(lineage,/onOpenTask\(child.task_id\)/);
  assert.match(lineage,/来源任务已永久删除，来源信息仍保留/);
  assert.match(lineage,/metadata\?\.latest_execution/);
  assert.match(api,/"prepare_task_followup", \{ sourceTaskId \}/);
  assert.doesNotMatch(lineage,/创建明天|今天未完成|查看明天/);
});

test('failed followup preparation stays on its source task so the persistent CTA can retry', async()=>{
  const ast=ts.createSourceFile('App.tsx',source('./App.tsx'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const functions=[];
  function collect(node){if(ts.isFunctionDeclaration(node)&&['selectLinkedTask','openFollowupDraft'].includes(node.name?.text))functions.push(node.getText(ast));ts.forEachChild(node,collect)}
  collect(ast);
  const original={id:'source',status:'scheduled',title:'Source'};
  const state={tasks:[original],preparingFollowup:{current:false},preferredSelection:{current:null},view:'open',selectedId:null,creating:false,busy:false,
    viewForStatus:status=>status,draftForTask:task=>({...task}),uiErrorMessage:String,
    async prepareTaskFollowup(){throw new Error('preparation failed')}};
  for(const key of ['search','tagFilter','view','creating','selectedRecurringId','selectedId','draft','compactTaskEditorDismissed','feedback','busy'])state[`set${key[0].toUpperCase()}${key.slice(1)}`]=value=>{state[key]=value};
  const context=vm.createContext(state);
  vm.runInContext(ts.transpileModule(functions.join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  await context.openFollowupDraft('source');
  assert.equal(state.selectedId,'source');
  assert.equal(state.view,'scheduled');
  assert.equal(state.creating,false);
  assert.match(state.feedback,/preparation failed/);
  assert.equal(state.busy,false);
  assert.equal(state.preparingFollowup.current,false);
});
