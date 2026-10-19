import assert from 'node:assert/strict';
import test from 'node:test';
import { executionResultForOutcome, taskExecutionResolution, visibleTaskScheduleBlocks } from './task-result.ts';
const block={id:'block',task_id:'task',task_status:'scheduled',execution_status:'planned',review:null};
const task={id:'task',status:'scheduled',updated_at:'version-1',remaining_workload_minutes:90};

test('new task result has only complete or incomplete; legacy outcomes map without exposing extra options',()=>{
  assert.equal(executionResultForOutcome(null),null);
  assert.equal(executionResultForOutcome('completed'),'completed');
  for(const outcome of ['partial','not_started','blocked','cancelled']) assert.equal(executionResultForOutcome(outcome),'not_completed');
});
test('completion and incomplete payloads never include old schedule or disposition fields',()=>{
  for(const outcome of ['completed','not_started']) {
    assert.deepEqual(taskExecutionResolution(block,task,outcome,' note '),{plan_block_id:'block',expected_task_updated_at:'version-1',outcome,note:'note',next_action:null,starts_at:null,ends_at:null,remaining_workload_minutes:null});
  }
});
test('incomplete permits empty notes and does not mutate task workload or status',()=>{
  const original=structuredClone(task);
  const input=taskExecutionResolution(block,task,'not_started','  ');
  assert.equal(input.note,null); assert.equal(input.next_action,null);
  assert.deepEqual(task,original);
});
test('missing, unrelated and inactive tasks cannot resolve stale blocks',()=>{
  for(const current of [undefined,{...task,id:'other'},{...task,status:'done'},{...task,status:'deleted'}]) assert.throws(()=>taskExecutionResolution(block,current,'completed',''));
});
test('ended pending blocks disappear but execution history and recorded facts remain',()=>{
  const pending={...block,task_status:'done'},fact={...pending,execution_status:'completed'},finalized={...pending,review:{outcome:'partial'}};
  assert.deepEqual(visibleTaskScheduleBlocks([pending,fact,finalized,block],'2026-10-19','2026-10-19'),[fact,finalized,block]);
  assert.deepEqual(visibleTaskScheduleBlocks([pending],'2026-10-18','2026-10-19'),[pending]);
});
