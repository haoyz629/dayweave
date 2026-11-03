import test from 'node:test';
import assert from 'node:assert/strict';
import { weekDatesFor, weekHeading, shiftWeekDate, weekEntries, weekGroups, weekInitialMinute, weekClock } from './week-timeline-model.ts';

const dates = weekDatesFor('2026-11-04');
const entry = (key, start, end, date='2026-11-02') => ({layoutKey:key,date,title:key,status:'已安排',tone:'plan',startMinute:start,endMinute:end,time:'',notes:null,tags:[]});
const empty = () => ({plan_id:null,plan_status:null,plan_source:null,task_blocks:[],fixed_events:[]});
const block = (id, patch={}) => ({id,task_id:id,task_title:id,task_status:'scheduled',starts_at:'2026-11-02T09:00:00+08:00',ends_at:'2026-11-02T10:00:00+08:00',execution_status:'planned',review:null,execution_note:null,...patch});

test('Monday-based dates and padded range do not depend on host timezone', () => {
  assert.deepEqual(dates,['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06','2026-11-07','2026-11-08']);
  assert.deepEqual(weekDatesFor('2026-11-08'),dates);
  assert.deepEqual(weekHeading(dates[0],dates[6]),{range:'2026年11月02日-11月08日',year:2026,week:45});
  assert.equal(shiftWeekDate('2024-02-28',1),'2024-02-29');
  assert.equal(weekClock(1440),'24:00');
});

test('ISO week-year and cross-year heading preserve both date years', () => {
  for (const [date,year,week] of [['2021-01-01',2020,53],['2025-12-31',2026,1],['2027-01-01',2026,53],['2024-12-30',2025,1]]) {
    const d=weekDatesFor(date), heading=weekHeading(d[0],d[6]);
    assert.equal(heading.year,year); assert.equal(heading.week,week);
    assert.match(heading.range,/年.*-\d{4}年/);
  }
  const d=weekDatesFor('2026-11-01'); assert.equal(weekHeading(d[0],d[6]).range,'2026年10月26日-11月01日');
});

test('production block visibility, review precedence and notes/tags are reused', () => {
  const schedule={...empty(),task_blocks:[block('plan'),block('done',{execution_status:'completed'}),block('review',{review:{outcome:'not_started',notes:'结果备注'}}),block('deleted',{task_status:'deleted'}),block('future-done',{task_status:'done'}),block('bad',{ends_at:'bad'}),block('zero',{ends_at:'2026-11-02T09:00:00+08:00'})]};
  const rows=weekEntries('2026-11-02',schedule,[],[{id:'plan',tags:['真实标签'],notes:'原备注'}],'2026-11-02');
  assert.equal(rows.length,3);
  assert.equal(rows.find(r=>r.layoutKey==='block:plan').tone,'plan');
  assert.deepEqual(rows.find(r=>r.layoutKey==='block:plan').tags,['真实标签']);
  assert.equal(rows.find(r=>r.layoutKey==='block:done').tone,'completed');
  assert.equal(rows.find(r=>r.layoutKey==='block:review').tone,'not-started');
  assert.equal(rows.find(r=>r.layoutKey==='block:review').notes,'结果备注');
  assert.equal(weekEntries('2026-11-02',schedule,[],[],'2026-11-04').length,4,'historical unfinished facts remain visible');
});

test('cross-midnight and UTC-offset timestamps clip to the actual Shanghai day', () => {
  const schedule={...empty(),task_blocks:[block('before',{starts_at:'2026-11-01T23:30:00+08:00',ends_at:'2026-11-02T00:30:00+08:00'}),block('after',{starts_at:'2026-11-02T23:30:00+08:00',ends_at:'2026-11-03T00:30:00+08:00'}),block('utc',{starts_at:'2026-11-02T01:00:00Z',ends_at:'2026-11-02T02:00:00Z'}),block('outside',{starts_at:'2026-11-03T09:00:00+08:00',ends_at:'2026-11-03T10:00:00+08:00'})]};
  const rows=weekEntries('2026-11-02',schedule,[],[],'2026-11-04');
  assert.deepEqual(rows.map(r=>[r.startMinute,r.endMinute]),[[0,30],[540,600],[1410,1440]]);
  assert.equal(rows[2].time,'23:30–24:00');
});

test('timed/untimed recurring and all-day events stay in complete lists', () => {
  const occurrences=[{id:'r',occurrence_date:'2026-11-02',title:'重复事项',display_time:'23:45',display_duration_minutes:15,tags:[]},{id:'u',occurrence_date:'2026-11-02',title:'无时间',display_time:null,display_duration_minutes:null,tags:[]},{id:'other',occurrence_date:'2026-11-03',title:'其他日',tags:[]}];
  const schedule={...empty(),fixed_events:[{id:'all',title:'全天',is_all_day:true,starts_at:'2026-11-02T00:00:00+08:00',ends_at:'2026-11-03T00:00:00+08:00'},{id:'deleted',deleted_at:'now',starts_at:'bad',ends_at:'bad'}]};
  const rows=weekEntries('2026-11-02',schedule,occurrences,[],'2026-11-04');
  assert.equal(rows.length,3); assert.equal(rows.filter(r=>r.startMinute===null).length,2);
  assert.equal(weekGroups(rows).length,1); assert.equal(weekGroups(rows)[0].entries[0].endMinute,1440);
});

test('equal-time blocks stay separate and adjacent intervals are not collisions', () => {
  const groups=weekGroups([entry('a',540,600),entry('b',540,600),entry('next',600,660)]);
  assert.equal(groups.length,2); assert.equal(groups[0].columns,2); assert.equal(groups[0].visible.length,2);
  assert.notEqual(groups[0].lanes.a.column,groups[0].lanes.b.column);
});

test('connected chains reuse columns and expand only through fully free intervals', () => {
  const [group]=weekGroups([entry('long',540,720),entry('short',540,600),entry('middle',540,630),entry('expand',630,690)]);
  assert.equal(group.columns,3); assert.equal(group.lanes.expand.column,1); assert.equal(group.lanes.expand.columnSpan,2);
  const [chain]=weekGroups([entry('a',540,600),entry('b',570,630),entry('c',600,660)]);
  assert.equal(chain.columns,2); assert.equal(chain.lanes.a.column,chain.lanes.c.column);
});

test('dense groups retain accurate hidden counts and all 20/100/1000 entries', () => {
  for (const count of [20,100,1000]) {
    const [group]=weekGroups(Array.from({length:count},(_,i)=>entry(String(i).padStart(4,'0'),540,630)));
    assert.equal(group.entries.length,count); assert.equal(group.visible.length,2); assert.equal(group.hidden,count-2); assert.equal(group.columns,3);
  }
});

test('current week always prefers now; empty or untimed other week prefers noon', () => {
  assert.equal(weekInitialMinute(dates,'2026-11-04',615,[],300),615);
  assert.equal(weekInitialMinute(dates,'2026-11-04',615,[entry('late',1200,1320)],300),615);
  assert.equal(weekInitialMinute(dates,'2026-11-11',615,[],300),720);
  assert.equal(weekInitialMinute(dates,'2026-11-11',615,[entry('untimed',null,null)],300),720);
});

test('other week uses aggregate occupied minutes with a shared viewport', () => {
  const entries=[entry('early',420,450),...Array.from({length:7},(_,i)=>entry(`late-${i}`,960,1020,dates[i]))];
  const center=weekInitialMinute(dates,'2026-11-11',615,entries,240);
  assert.ok(center-120<=960&&center+120>=1020,center);
  assert.equal(weekInitialMinute(dates,'2026-11-11',615,[entry('only',960,1020)],240),990);
  assert.equal(weekInitialMinute(dates,'2026-11-11',615,[entry('midnight',0,30)],240),120);
  assert.equal(weekInitialMinute(dates,'2026-11-11',615,[entry('late',1410,1440)],240),1320);
});

test('random dense/chain layouts retain every task with no temporal lane collisions', () => {
  let seed=12345; const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
  for(let sample=0;sample<100;sample++) {
    const items=Array.from({length:30},(_,i)=>{const start=Math.floor(random()*1300);return entry(String(i),start,Math.min(1440,start+1+Math.floor(random()*140)));});
    const groups=weekGroups(items); assert.equal(groups.reduce((sum,g)=>sum+g.entries.length,0),items.length);
    for(const group of groups) {
      assert.equal(group.visible.length+group.hidden,group.entries.length);
      for(const a of group.visible) for(const b of group.visible) {
        if(a===b||a.startMinute>=b.endMinute||b.startMinute>=a.endMinute) continue;
        const x=group.lanes[a.layoutKey],y=group.lanes[b.layoutKey];
        assert.ok(x.column+x.columnSpan<=y.column||y.column+y.columnSpan<=x.column);
      }
    }
  }
});
