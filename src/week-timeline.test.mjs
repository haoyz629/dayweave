import test from 'node:test';
import assert from 'node:assert/strict';
import { weekDatesFor, weekHeading, shiftWeekDate, weekEntries, weekGroups, weekInitialMinute, weekClock, weekDetailRange } from './week-timeline-model.ts';
import { readFileSync } from 'node:fs';

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
  assert.equal(rows.length,4,'recycled planned blocks stay visible today, future-done blocks are hidden');
  assert.equal(rows.find(r=>r.layoutKey==='block:plan').tone,'plan');
  assert.deepEqual(rows.find(r=>r.layoutKey==='block:plan').tags,['真实标签']);
  assert.equal(rows.find(r=>r.layoutKey==='block:done').tone,'completed');
  assert.equal(rows.find(r=>r.layoutKey==='block:review').tone,'not-started');
  assert.equal(rows.find(r=>r.layoutKey==='block:review').notes,'结果备注');
  assert.equal(rows.find(r=>r.layoutKey==='block:deleted').tone,'plan');
  assert.equal(weekEntries('2026-11-02',schedule,[],[],'2026-11-04').length,5,'historical unfinished facts and recycled blocks remain visible');
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

test('day and week share date content while all views use one header', () => {
  const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
  const app = read('./App.tsx'), week = read('./week-timeline.tsx'), css = read('./week-timeline.css');
  assert.equal(app.match(/<header className="timeline-design-topbar">/g)?.length, 1);
  assert.doesNotMatch(app, /className="month-controls"/);
  assert.doesNotMatch(week, /week-timeline-toolbar/);
  for (const source of [app, week]) assert.match(source, /<TimelineWeekDateContent /);
  assert.match(css, /--week-columns: 64px repeat\(5, minmax\(0, 1fr\)\) repeat\(2, minmax\(0, \.5fr\)\)/);
  assert.match(css, /\.week-timeline-dates, \.week-timeline-body \{[^}]*grid-template-columns: var\(--week-columns\)/);
  assert.match(week, /measure\.widths\[index\]/, 'task text wrapping uses each actual day width');
});

test('week removes redundant read-only copy and includes the incomplete semantic legend', () => {
  const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
  const app = read('./App.tsx'), week = read('./week-timeline.tsx'), css = read('./week-timeline.css');
  assert.doesNotMatch(app, /只读周日程/);
  assert.match(app, /todayView !== "week" && <div className="timeline-date-meta timeline-day-subline">/);
  assert.doesNotMatch(week, /只读 · 点击任务或日期查看完整安排/);
  assert.match(week, /aria-label="任务状态图例"><span className="tone-plan">已安排<\/span><span className="tone-completed">已完成<\/span><span className="tone-not-started">未完成<\/span>/);
  assert.match(css, /\.tone-not-started[^{}]*\{ --week-tone: var\(--state-not-started\); --week-bg: var\(--state-not-started-surface\); --week-edge: var\(--state-not-started-border\);/);
});

test('week dates inherit day card styling while column separators stay independent', () => {
  const css = readFileSync(new URL('./week-timeline.css', import.meta.url), 'utf8');
  const button = css.match(/\.today-page \.week-timeline \.week-timeline-dates > button \{([^}]+)\}/)[1];
  assert.match(button, /height: calc\(100% - 12px\); margin: 6px 4px/);
  assert.doesNotMatch(button, /border|border-radius|padding|background/);
  assert.match(css, /\.week-timeline-dates > button::after \{[^}]*right: -5px; width: 1px;[^}]*pointer-events: none/);
});

test('week task blocks use narrower horizontal gutters and clearer vertical gaps', () => {
  const week = readFileSync(new URL('./week-timeline.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('./week-timeline.css', import.meta.url), 'utf8');
  assert.match(week, /const height = Math.max\(2, timeTop\(entry.endMinute - entry.startMinute\) - 6\)/);
  assert.match(week, /top: timeTop\(entry.startMinute\) \+ 3, height, left: `calc\([^`]+\+ 2px\)`, right: `calc\([^`]+\+ 2px\)`/);
  assert.match(week, /measure.widths\[index\][^\n]+- 14 >= measure.time/);
  assert.match(css, /\.week-timeline-more \{[^}]*left: calc\(66.666667% \+ 2px\); right: 2px/);
});

test('week blocks reserve tag space while hover keeps every tag', () => {
  const source = readFileSync(new URL('./week-timeline.tsx', import.meta.url), 'utf8');
  const sizing = ['showTime', 'showTags', 'lines'].map(name => source.match(new RegExp(`const ${name} = ([^;]+);`))?.[0]).join('\n');
  const size = new Function('height', 'timeRows', 'entry', `${sizing}\nreturn { showTags, lines };`);
  assert.deepEqual(size(66, 1, { tags: ['工作'] }), { showTags: true, lines: 1 });
  assert.equal(size(30, 1, { tags: ['工作'] }).showTags, false);
  assert.equal(size(66, 1, { tags: [] }).showTags, false);
  assert.deepEqual(size(102, 2, { tags: ['工作', '设计'] }), { showTags: true, lines: 2 });
  assert.match(source, /<TaskTagList tags=\{entry.tags\}/);
  assert.match(source, /<TaskTagList tags=\{hover.entry.tags\} expanded/);
  const css = readFileSync(new URL('./week-timeline.css', import.meta.url), 'utf8');
  assert.match(css, /\.week-timeline-event \{[^}]*gap: 3px;[^}]*padding: 3px 4px;/);
});

test('drawer range includes every timed member and ignores untimed/empty entries', () => {
  assert.equal(weekDetailRange([]), null);
  assert.equal(weekDetailRange([entry('untimed', null, null)]), null);
  assert.equal(weekDetailRange([entry('late', 630, 690), entry('early', 600, 660), entry('untimed', null, null)]), '10:00–11:30');
  assert.equal(weekDetailRange([entry('midnight', 0, 30), entry('end', 1410, 1440)]), '00:00–24:00');
  const [group] = weekGroups([entry('first', 600, 660), entry('middle', 630, 690), entry('last', 675, 720)]);
  assert.equal(weekDetailRange(group.entries), '10:00–12:00');
  const [dense] = weekGroups(Array.from({length:12}, (_, i) => entry(String(i), 540+i, 600+i)));
  assert.equal(weekDetailRange(dense.entries), '09:00–10:11');
});

test('task and more entrances open complete groups while date entrances retain every day entry', () => {
  const source = readFileSync(new URL('./week-timeline.tsx', import.meta.url), 'utf8');
  assert.equal(source.match(/openDetails\(day.date, group.entries, event.currentTarget\)/g)?.length, 2);
  assert.match(source, /openDetails\(day.date, day.entries, event.currentTarget\)/);
  assert.doesNotMatch(source, /openDetails\(entry.title, \[entry\]/);
  assert.match(source, /<TaskTagList tags=\{entry.tags\} expanded/);
  assert.match(source, /entry.startMinute !== null && entry.endMinute !== null && <span className="detail-duration">/);
  assert.match(source, /dateTime=\{details.date\}/);
  assert.match(source, /detailRange && <p className="detail-range">/);
  assert.match(source, /const short = tiny && height >= 28/);
});

test('approved light week is compact and drawer date/count are centered with a separate range', () => {
  const css = readFileSync(new URL('./week-timeline.css', import.meta.url), 'utf8');
  assert.match(css, /html:root:not\(\[data-mode="dark"\]\) \.today-page \.week-timeline \.week-timeline-dates \{ height: 88px/);
  assert.match(css, /html:root:not\(\[data-mode="dark"\]\) \.week-timeline-grid \{ min-width: 960px/);
  assert.match(css, /\.week-timeline-details \.detail-title \{[^}]*align-items: center/);
  assert.match(css, /\.week-timeline-details \.detail-heading-copy \{[^}]*flex-direction: column; gap: 4px/);
  assert.match(css, /\.detail-surface \{[^}]*width: min\(480px, 100vw\)/);
  assert.match(css, /\.week-timeline-event.is-tiny.is-short \{ padding: 4px/);
});

test('week resources split saved URLs before merging ordinary execution notes', () => {
  for (const [saved, url, body] of [
    ['URL: url\n\n12313213', 'url', '12313213'],
    ['URL: https://example.com/docs', 'https://example.com/docs', ''],
    ['URL: https://example.com/docs\r\n\r\n第一行\r\n第二行', 'https://example.com/docs', '第一行\r\n第二行'],
    ['URL: javascript:alert(1)\n\n保留正文', 'javascript:alert(1)', '保留正文'],
    ['普通备注\nURL: 正文中的内容', '', '普通备注\nURL: 正文中的内容'],
    [null, '', ''],
  ]) {
    for (const execution of [null, '执行备注\n第二行', 'URL: 这是执行备注，不是任务链接']) {
      const task = { id: 'resource', notes: saved, tags: [] };
      const schedule = { ...empty(), task_blocks: [block('resource', { execution_note: execution })] };
      const before = structuredClone({ task, schedule });
      const [row] = weekEntries('2026-11-02', schedule, [], [task], '2026-11-02');
      assert.equal(row.url, url);
      assert.equal(row.notes, [body, execution].filter(Boolean).join('\n\n') || null);
      assert.deepEqual({ task, schedule }, before, 'resource reads never rewrite saved data');
    }
  }
  const [reviewed] = weekEntries('2026-11-02', { ...empty(), task_blocks: [block('resource', { execution_note: '旧执行备注', review: { outcome: 'completed', notes: '确认后的备注' } })] }, [], [{ id: 'resource', notes: 'URL: https://example.com\n\n任务正文', tags: [] }], '2026-11-02');
  assert.equal(reviewed.url, 'https://example.com');
  assert.equal(reviewed.notes, '任务正文\n\n确认后的备注');
});

test('week recurring resources preserve snapshot URL and literal review notes separately', () => {
  for (const [saved, url, body] of [['URL: url\n\n重复正文', 'url', '重复正文'], ['URL: https://example.com', 'https://example.com', ''], [null, '', '']]) {
    const occurrence = { id: 'r', occurrence_date: '2026-11-02', title: '重复事项', display_time: '12:30', display_duration_minutes: 30, notes: saved, review_notes: 'URL: 执行备注原文', tags: [] };
    const [row] = weekEntries('2026-11-02', empty(), [occurrence], [], '2026-11-02');
    assert.equal(row.url, url);
    assert.equal(row.notes, [body, occurrence.review_notes].filter(Boolean).join('\n\n'));
  }
  const [fixed] = weekEntries('2026-11-02', { ...empty(), fixed_events: [{ id: 'f', title: '固定日程', starts_at: '2026-11-02T09:00:00+08:00', ends_at: '2026-11-02T10:00:00+08:00' }] }, [], [], '2026-11-02');
  assert.equal(fixed.url, '');
  assert.equal(fixed.notes, null);
});

test('ordinary and recurring entries share execution tones while keeping recurring identity', () => {
  for (const [outcome, execution, label] of [[null,'planned','已安排'],['completed','completed','本次已完成'],['partial','partial','本次部分完成'],['not_completed','not_started','本次未完成']]) {
    for (const untimed of [false, true]) {
      const item = { id:'repeat', occurrence_date:'2026-11-02', title:'重复标题', outcome, display_time:untimed?null:'09:00', display_duration_minutes:60, tags:['保留标签'] };
      const rows = weekEntries('2026-11-02', {...empty(),task_blocks:[block('ordinary',{execution_status:execution})]}, [item], [], '2026-11-04');
      const ordinary = rows.find(row=>row.layoutKey==='block:ordinary'), recurring = rows.find(row=>row.layoutKey==='recurring:repeat');
      assert.equal(recurring.tone, ordinary.tone);
      assert.equal(recurring.status, label);
      assert.deepEqual(recurring.tags, ['保留标签']);
      assert.equal(recurring.time, untimed?'时间未指定':'09:00–10:00');
      assert.equal(item.outcome, outcome, 'display must not mutate execution facts');
    }
  }
});

test('recurring icons and identity labels are independent of week execution tones', () => {
  const week = readFileSync(new URL('./week-timeline.tsx',import.meta.url),'utf8');
  const css = readFileSync(new URL('./week-timeline.css',import.meta.url),'utf8');
  const app = readFileSync(new URL('./App.tsx',import.meta.url),'utf8');
  assert.doesNotMatch(week, /tone-recurring/);
  assert.doesNotMatch(css, /tone-recurring/);
  assert.match(week, /week-timeline-task-title[^\n]+week-recurring-icon/);
  assert.match(week, /week-timeline-kind[^\n]+重复事项/);
  assert.match(week, /detail-kind\$\{entry.layoutKey.startsWith\("recurring:"\) \? " is-recurring"/);
  assert.match(css, /\.detail-kind\.is-recurring/);
  assert.match(app, /recurring-event execution-\$\{display.outcome\}/);
  assert.match(app, /timeline-recurring-marker/);
  assert.match(app, /<TimelineTaskContent[^\n]+type="recurring"/);
  assert.doesNotMatch(app, /tone: "recurring"/);
});

test('light week only marks today with a red circle and removes incoming day selection styling', () => {
  const css = readFileSync(new URL('./color-system.css', import.meta.url), 'utf8');
  const prefix = 'html:root:not([data-mode="dark"]) .next-workspace .today-page .week-timeline .week-timeline-dates > button';
  assert.ok(css.includes(`${prefix} .timeline-week-date { color: inherit; background: transparent; box-shadow: none; }`));
  assert.ok(css.includes(`${prefix}.today .timeline-week-date { color: var(--today-red-label); background: var(--today-red); }`));
  assert.ok(css.includes(`${prefix}.selected { color: var(--color-ink); border-color: transparent; background: transparent; box-shadow: none; }`));
  assert.ok(css.includes(`${prefix}.weekend.selected { background: color-mix(in srgb, var(--color-orange-bg) 60%, var(--color-panel)); }`));
});
