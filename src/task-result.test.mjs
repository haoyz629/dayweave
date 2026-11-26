import assert from 'node:assert/strict';
import test from 'node:test';
import { executionResultForOutcome, taskExecutionResolution, timelineTaskCompletionAction, taskResultEditable, blockResultEditable, resultWindowOpen, resultToday, visibleTaskScheduleBlocks, historicalTaskCreationError, historicalBlockCompletionLocked, historicalTaskCompletionLocked } from './task-result.ts';
const at=value=>Date.parse(value);
const block={id:'block',task_id:'task',task_status:'scheduled',ends_at:'2026-10-19T23:30:00+08:00',execution_status:'planned',review:null};
const task={id:'task',status:'scheduled',updated_at:'v1',result_date:'2026-10-19',result_ends_at:block.ends_at,execution_locked:true,remaining_workload_minutes:90};

test('result mapping and payload permit correcting completed task without legacy scheduling fields',()=>{
  assert.equal(executionResultForOutcome(null),null);
  assert.equal(executionResultForOutcome('completed'),'completed');
  for(const value of ['partial','not_started','blocked','cancelled']) assert.equal(executionResultForOutcome(value),'not_completed');
  for(const status of ['open','scheduled','done']) for(const outcome of ['completed','not_started']) {
    assert.deepEqual(taskExecutionResolution(block,{...task,status},outcome,' note '),{plan_block_id:'block',expected_task_updated_at:'v1',outcome,note:'note',next_action:null,starts_at:null,ends_at:null,remaining_workload_minutes:null});
  }
  for(const current of [undefined,{...task,id:'other'},{...task,status:'deleted'},{...task,deleted_at:'date'}]) assert.throws(()=>taskExecutionResolution(block,current,'completed',''));
});

test('same CST day or original end plus six hours with inclusive boundary',()=>{
  const end='2026-10-19T23:30:00+08:00';
  for(const clock of ['2026-10-19T00:00:00+08:00','2026-10-19T23:59:59+08:00','2026-10-20T05:29:59+08:00','2026-10-20T05:30:00+08:00']) assert.equal(resultWindowOpen('2026-10-19',end,at(clock)),true,clock);
  for(const clock of ['2026-10-18T23:59:59+08:00','2026-10-20T05:30:00.001+08:00','2026-10-21T00:00:00+08:00']) assert.equal(resultWindowOpen('2026-10-19',end,at(clock)),false,clock);
  assert.equal(resultToday(at('2026-10-19T16:00:00Z')),'2026-10-20');
  assert.equal(resultWindowOpen('2026-10-19',end,at('2026-10-19T21:30:00Z')),true);
  for(const date of [null,undefined,'invalid','2026-02-30']) assert.equal(resultWindowOpen(date,end,at('2026-10-20T05:00:00+08:00')),false);
  assert.equal(resultWindowOpen('2026-10-19',null,at('2026-10-20T01:00:00+08:00')),false);
});

test('editing or restoring does not extend task result context; unknown legacy completion is read only',()=>{
  const done={...task,status:'done'};
  const now=at('2026-10-20T05:00:00+08:00');
  assert.equal(taskResultEditable(done,now),false,'historical completion overrides the old six-hour grace');
  for(const change of [{updated_at:'2026-10-20T09:00:00+08:00'},{title:'renamed'},{restored_at:'today'}]) assert.equal(taskResultEditable({...done,...change},at('2026-10-20T05:30:01+08:00')),false);
  assert.equal(taskResultEditable({...done,result_date:null},now),false);
  assert.equal(taskResultEditable({...done,deleted_at:'date'},now),false);
  assert.equal(taskResultEditable({...task,result_date:null,execution_locked:false},now),true);
});

test('today completion and cancellation act only on the block, not the whole-task result window',()=>{
  const now=at('2026-10-19T10:00:00+08:00');
  for(const status of ['scheduled','done']) {
    const current={...task,status,result_date:null};
    const daily={...block,task_status:status};
    assert.equal(timelineTaskCompletionAction({...daily,execution_status:'completed'},current,'2026-10-19',resultToday(now),now),'uncomplete-block');
    assert.equal(timelineTaskCompletionAction({...daily,review:{outcome:'partial'}},current,'2026-10-19',resultToday(now),now),null);
    for(const execution_status of ['not_started','partial','cancelled','blocked']) assert.equal(timelineTaskCompletionAction({...daily,execution_status},current,'2026-10-19',resultToday(now),now),'clear');
    assert.equal(timelineTaskCompletionAction(daily,current,'2026-10-19',resultToday(now),now),'complete-block');
  }
  for(const current of [undefined,{...task,id:'other'},{...task,status:'deleted'},{...task,deleted_at:'date'}]) assert.equal(timelineTaskCompletionAction(block,current,'2026-10-19','2026-10-19',now),null);
  const recycled={...block,task_status:'deleted'};
  const recycledTask={...task,status:'deleted',deleted_at:'2026-10-18T10:00:00+08:00'};
  assert.equal(timelineTaskCompletionAction(recycled,recycledTask,'2026-10-19','2026-10-19',now),'complete-block');
  assert.equal(timelineTaskCompletionAction(recycled,{...recycledTask,id:'other'},'2026-10-19','2026-10-19',now),null);
  assert.equal(timelineTaskCompletionAction(recycled,undefined,'2026-10-19','2026-10-19',now),null);
  assert.equal(timelineTaskCompletionAction({...recycled,review:{outcome:'not_started'}},recycledTask,'2026-10-19','2026-10-19',now),null);
  assert.equal(timelineTaskCompletionAction({...recycled,execution_status:'not_started'},recycledTask,'2026-10-19','2026-10-19',now),null);
  assert.equal(timelineTaskCompletionAction({...recycled,execution_status:'completed'},recycledTask,'2026-10-19','2026-10-19',now),null);
  assert.equal(timelineTaskCompletionAction(recycled,recycledTask,'2026-10-21','2026-10-19',now),null);
});

test('recycled blocks stay hidden across past, today and future views until restored',()=>{
  const recycled={...block,task_status:'deleted'};
  for (const date of ['2026-10-18', '2026-10-19', '2026-10-20']) {
    for (const fact of [
      {},
      { execution_status: 'completed' },
      { execution_status: 'not_started' },
      { review: { outcome: 'not_started' } },
      { execution_note: '保留备注', execution_captured_at: '2026-10-19T10:00:00+08:00' },
      { execution_captured_at: '2026-10-19T10:00:00+08:00' },
      { actual_minutes: 15 }
    ]) {
      assert.deepEqual(visibleTaskScheduleBlocks([{ ...recycled, ...fact }], date, '2026-10-19'), []);
    }
  }
  const restored = { ...recycled, task_status: 'scheduled', execution_status: 'completed' };
  assert.deepEqual(visibleTaskScheduleBlocks([restored], '2026-10-18', '2026-10-19'), [restored]);
  assert.deepEqual(visibleTaskScheduleBlocks([restored], '2026-10-19', '2026-10-19'), [restored]);
});

test('historical actions use only that block outcome, regardless of task completion or record age',()=>{
  for(const now of [at('2026-10-20T05:30:00+08:00'),at('2026-10-20T12:00:00+08:00'),at('2027-01-01T12:00:00+08:00')]) {
    for(const status of ['open','scheduled','done']) for(const outcome of ['planned','completed','not_started','partial','blocked','cancelled']) {
      for(const review of [null,{outcome}]) {
        const expected = outcome === 'completed' ? null : outcome === 'planned' ? 'complete-block' : review ? null : 'clear';
        assert.equal(timelineTaskCompletionAction({...block,task_status:status,execution_status:outcome,review},{...task,status},'2026-10-19',resultToday(now),now),expected);
      }
    }
  }
});

test('block editing validates actual dates and rejects future, deleted and mismatched records',()=>{
  const now=at('2026-10-20T12:00:00+08:00');
  for(const date of ['2026-10-20','2026-10-19','2020-01-01']) assert.equal(blockResultEditable(date,now),true);
  for(const date of [null,undefined,'invalid','2026-02-30','2026-10-21']) assert.equal(blockResultEditable(date,now),false);
  for(const current of [undefined,{...task,id:'other'},{...task,status:'deleted'},{...task,deleted_at:'date'}]) assert.equal(timelineTaskCompletionAction(block,current,'2026-10-19','2026-10-20',now),null);
  assert.equal(timelineTaskCompletionAction({...block,result_date:'2026-10-18'},task,'2026-10-19','2026-10-20',now),null);
});

test('ended pending blocks disappear but execution history and recorded facts remain',()=>{
  const pending={...block,task_status:'done'},fact={...pending,execution_status:'completed'},finalized={...pending,review:{outcome:'partial'}};
  assert.deepEqual(visibleTaskScheduleBlocks([pending,fact,finalized,block],'2026-10-19','2026-10-19'),[fact,finalized,block]);
  assert.deepEqual(visibleTaskScheduleBlocks([pending],'2026-10-18','2026-10-19'),[pending]);
});

test('task details use the backend completion candidate rather than the most recently backfilled fact',()=>{
  const active={...task,status:'scheduled',result_date:null,execution_locked:false};
  const metadata={task_id:active.id,tags:[],recurrence:null,completion_date:'2026-10-20',completion_ends_at:'2026-10-20T23:30:00+08:00',latest_execution:{plan_date:'2026-10-19',ends_at:block.ends_at,outcome:'not_started'}};
  assert.equal(taskResultEditable(active,at('2026-10-20T12:00:00+08:00'),metadata),true);
  assert.equal(taskResultEditable({...active,status:'done',result_date:'2026-10-19',result_ends_at:block.ends_at},at('2026-10-20T12:00:00+08:00'),metadata),false,'completed task still uses its original completion context');
});

test('incomplete checkbox cancels the record rather than completing it on any elapsed date',()=>{
  for (const date of ['2026-10-20','2026-10-19','2020-01-01']) {
    for (const execution_status of ['not_started','partial','blocked','cancelled']) {
      const current = {...block,execution_status,result_date:date};
      const now = at('2026-10-20T12:00:00+08:00');
      assert.equal(timelineTaskCompletionAction(current,task,date,'2026-10-20',now),'clear');
    }
  }
});

test('recorded incomplete facts with a review never turn into completed through the checkbox',()=>{
  const now = at('2026-10-20T12:00:00+08:00');
  for (const date of ['2026-10-20','2026-10-19']) {
    const current = {...block,review:{outcome:'not_started'},result_date:date};
    assert.equal(timelineTaskCompletionAction(current,task,date,'2026-10-20',now),null);
  }
});

test('execution locking must not prevent explicitly completing an active whole task',()=>{
  const now=at('2026-10-20T12:00:00+08:00');
  for (const status of ['open','scheduled']) {
    assert.equal(taskResultEditable({...task,status,result_date:null,execution_locked:true},now),true);
  }
  assert.equal(taskResultEditable({...task,status:'done',result_date:'2026-10-19'},now),false);
});

test('active cross-day whole-task completion is independent of an old daily result context',()=>{
  const now=at('2026-10-20T12:00:00+08:00');
  const active={...task,status:'scheduled',earliest_start_date:'2026-10-19',due_date:'2026-10-22'};
  assert.equal(taskResultEditable(active,now),true);
  assert.equal(taskResultEditable(active,now,{completion_date:'2026-10-19',completion_ends_at:block.ends_at}),true);
  assert.equal(taskResultEditable({...active,due_date:'2026-10-19',earliest_start_date:'2026-10-18'},now),true,'an unfinished overdue cross-day task can still be explicitly completed');
  assert.equal(taskResultEditable({...active,status:'done'},now),false);
  assert.equal(taskResultEditable({...active,deleted_at:'deleted'},now),false);
});

test('historical whole-task completion overrides fresh metadata and locks exactly at Shanghai midnight',()=>{
  const done={...task,status:'done'};
  const before=at('2026-10-19T15:59:59.999Z'), after=at('2026-10-19T16:00:00Z');
  const metadata={task_id:task.id,completion_backfill_allowed:true,completion_recorded_at:'2026-10-19T23:59:00+08:00'};
  assert.equal(taskResultEditable(done,before,metadata),true);
  assert.equal(historicalTaskCompletionLocked(done,after),true);
  assert.equal(taskResultEditable(done,after,metadata),false);
  assert.equal(historicalTaskCompletionLocked({...done,status:'scheduled'},after),false);
  assert.equal(historicalBlockCompletionLocked('2026-10-19',{...block,execution_status:'completed'},before),false);
  assert.equal(historicalBlockCompletionLocked('2026-10-19',{...block,review:{outcome:'completed'}},after),true);
  assert.equal(historicalBlockCompletionLocked('2026-10-19',{...block,execution_status:'completed',review:{outcome:'not_started'}},after),false);
});

test('historical creation requires a complete valid single day and multi-day creation cannot start before Shanghai today',()=>{
  const now=at('2026-10-20T00:00:00+08:00');
  const schedule={earliest_start_date:'2026-10-19',earliest_start_time:'09:00',due_date:'2026-10-19',due_time:'10:00'};
  assert.equal(historicalTaskCreationError(schedule,now),null);
  for(const change of [{earliest_start_date:null},{earliest_start_time:null},{due_time:null},{due_time:'09:00'},{due_time:'09:14'},{earliest_start_time:'25:00'}]) assert.match(historicalTaskCreationError({...schedule,...change},now),/完整且有效/);
  assert.match(historicalTaskCreationError({...schedule,earliest_start_date:'2026-10-18'},now),/包含历史日期的多日任务/);
  for(const due_date of ['2026-10-20','2026-10-21']) assert.match(historicalTaskCreationError({...schedule,due_date},now),/开始日期不能早于今天/);
  const crossing={...schedule,earliest_start_date:'2026-10-19',due_date:'2026-10-20'};
  assert.equal(historicalTaskCreationError(crossing,now-1),null,'Shanghai midnight, not UTC midnight, determines history');
  assert.match(historicalTaskCreationError(crossing,now),/开始日期不能早于今天/);
  assert.equal(historicalTaskCreationError({...schedule,earliest_start_date:'2026-10-20',due_date:'2026-10-21'},now),null);
});
