import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { independentTaskDraft } from './task-followup.ts';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const task={id:'old-task',title:'开发任务',priority:'high',tags:['工作'],notes:'不复制的旧备注',status:'scheduled'};

test('quick new task copies only title, priority and tags into a normal independent draft',()=>{
  const before=structuredClone(task);
  const draft=independentTaskDraft(task,'2026-10-19');
  assert.deepEqual(draft,{
    item_type:'task',recurring_settings:null,title:task.title,notes:null,priority:'high',tags:['工作'],
    earliest_start_date:'2026-10-20',earliest_start_time:'09:00',due_date:'2026-10-20',due_time:'10:00',
    total_workload_minutes:60,remaining_workload_minutes:60,field_states_json:'{}',recurrence:null
  });
  assert.deepEqual(task,before);
  assert.equal('source_task_id' in draft,false);
  assert.equal('target_task_id' in draft,false);
  assert.equal('origin' in draft,false);
  draft.tags.push('独立新标签');
  assert.deepEqual(task.tags,['工作']);
});

test('each click gets an independent seed and dates use CST across month and year ends',()=>{
  for(const [today,tomorrow] of [['2026-10-31','2026-11-01'],['2026-12-31','2027-01-01'],['2028-02-28','2028-02-29']]) {
    const first=independentTaskDraft(task,today),second=independentTaskDraft(task,today);
    assert.equal(first.due_date,tomorrow);
    assert.notEqual(first,second);
    assert.notEqual(first.tags,second.tags);
  }
  assert.throws(()=>independentTaskDraft(task,'invalid'));
});

test('execution record component keeps facts and offers new task without relation links',()=>{
  const source=readFileSync(new URL('./task-lineage.tsx',import.meta.url),'utf8');
  assert.match(source,/metadata\?\.latest_execution/);
  assert.match(source,/fact.outcome !== "completed"/);
  assert.match(source,/>新建任务<\/button>/);
  assert.doesNotMatch(source,/source_task_id|followups|onOpenTask|来源任务|后续任务|status_locked/);
  const api=readFileSync(new URL('./tauri.ts',import.meta.url),'utf8');
  assert.doesNotMatch(api,/prepare_task_followup|status_locked|TaskOrigin|TaskFollowup/);
});

test('unfinished record new-task button remains available after its result window expires',()=>{
  const text=readFileSync(new URL('./task-lineage.tsx',import.meta.url),'utf8');
  const code=ts.transpileModule(text.replace(/^import type[^\n]*\n/,'').replace('export function','function'),{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;
  const context=vm.createContext({React});
  vm.runInContext(code,context);
  let calls=0;
  const oldFact={plan_date:'2020-01-01',outcome:'not_started',note:'旧执行备注'};
  const tree=context.TaskExecutionRecord({metadata:{latest_execution:oldFact},disabled:false,onNewTask(){calls++;}});
  const markup=renderToStaticMarkup(tree);
  assert.match(markup,/旧执行备注/);
  assert.match(markup,/新建任务/);
  const button=React.Children.toArray(tree.props.children).find(child=>child.type==='button');
  assert.equal(button.props.disabled,false);
  button.props.onClick();assert.equal(calls,1);
  const completed=context.TaskExecutionRecord({metadata:{latest_execution:{...oldFact,outcome:'completed'}},disabled:false,onNewTask(){calls++;}});
  assert.doesNotMatch(renderToStaticMarkup(completed),/新建任务/);
  assert.equal(context.TaskExecutionRecord({metadata:null,disabled:false,onNewTask(){}}),null);
});
