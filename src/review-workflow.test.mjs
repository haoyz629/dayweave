import assert from 'node:assert/strict';
import test from 'node:test';
import { canRecordReview, canCaptureTaskResult, canCaptureRecurringResult, optionalReviewMinutes, reviewNeedsAttention, normalizeTodayNavigation, restoreReviewDraft, mergeReviewDrafts, ReviewDraftQueue } from './review-workflow.ts';

test('seven CST calendar days include today and day 7, reject day 8 and future', () => {
  for (const date of ['2026-10-16', '2026-10-10']) assert.equal(canRecordReview(date, '2026-10-16'), true);
  for (const date of ['2026-10-09', '2026-10-17', 'invalid', '2026-02-30']) assert.equal(canRecordReview(date, '2026-10-16'), false);
  assert.equal(canRecordReview('2026-12-28', '2027-01-03'), true);
});
test('unknown time is not zero; optional minute inputs require safe nonnegative integers', () => {
  assert.equal(optionalReviewMinutes(' '), null);
  assert.equal(optionalReviewMinutes('0'), 0);
  assert.equal(optionalReviewMinutes(' 40 '), 40);
  for (const value of ['-1', '1.5', 'NaN', '1e2', '9007199254740992']) assert.throws(() => optionalReviewMinutes(value));
});
test('normal records need no second confirmation, anomalies stay actionable', () => {
  assert.equal(reviewNeedsAttention('completed'), false);
  for (const outcome of [null, 'partial', 'blocked', 'cancelled', 'not_started', 'not_completed']) assert.equal(reviewNeedsAttention(outcome), true);
});
test('legacy review navigation returns to the single Today schedule', () => {
  assert.deepEqual(normalizeTodayNavigation('复盘'), { active: '今日' });
  assert.deepEqual(normalizeTodayNavigation('今日'), { active: '今日' });
  assert.deepEqual(normalizeTodayNavigation('任务'), { active: '任务' });
});

test('task block dialogs record today or first results within seven days without overwriting history', () => {
  const block = { task_status: 'scheduled', review: null, execution_status: 'planned', execution_captured_at: null, actual_minutes: null };
  for (const date of ['2026-10-16', '2026-10-10']) assert.equal(canCaptureTaskResult(date, '2026-10-16', block), true);
  for (const date of ['2026-10-09', '2026-10-17']) assert.equal(canCaptureTaskResult(date, '2026-10-16', block), false);
  for (const change of [{ execution_status: 'blocked' }, { execution_captured_at: 'saved' }, { actual_minutes: 0 }]) {
    assert.equal(canCaptureTaskResult('2026-10-15', '2026-10-16', { ...block, ...change }), false);
    assert.equal(canCaptureTaskResult('2026-10-16', '2026-10-16', { ...block, ...change }), true);
  }
  for (const change of [{ review: { outcome: 'completed' } }, { task_status: 'deleted' }, { task_status: 'done' }]) {
    assert.equal(canCaptureTaskResult('2026-10-16', '2026-10-16', { ...block, ...change }), false);
  }
});

test('repeat dialogs preserve first-write-only history, date limits and trash protection', () => {
  assert.equal(canCaptureRecurringResult('2026-10-16', '2026-10-16', 'partial', true), true);
  assert.equal(canCaptureRecurringResult('2026-10-10', '2026-10-16', null, true), true);
  for (const [date, outcome, writable] of [
    ['2026-10-15', 'partial', true], ['2026-10-09', null, true],
    ['2026-10-17', null, true], ['2026-10-16', null, false]
  ]) assert.equal(canCaptureRecurringResult(date, '2026-10-16', outcome, writable), false);
});
test('committing A preserves unsaved B/C; finalized entries disappear from draft map', () => {
  const base = { A: 'fresh', B: 'defaultB', C: 'defaultC' };
  assert.deepEqual(mergeReviewDrafts(base, { B: 'diskB' }, { A: 'old', B: 'editB', C: 'editC' }, 'A'), { A: 'fresh', B: 'editB', C: 'editC' });
  assert.deepEqual(mergeReviewDrafts({ B: 'defaultB' }, { B: 'diskB' }, { A: 'old' }), { B: 'diskB' });
  assert.deepEqual(restoreReviewDraft({ notes: '', outcome: null }, '{broken'), { notes: '', outcome: null });
  assert.deepEqual(restoreReviewDraft({ notes: '', outcome: null }, '{"notes":"saved","outcome":"bogus","extra":4}'), { notes: 'saved', outcome: null });
});
const identity = { review_date: '2026-10-16', item_type: 'task', item_id: 'A' };
test('draft queue serializes new edits during save and flushes all before commit', async () => {
  const writes = [];
  let release;
  const queue = new ReviewDraftQueue(async (id, payload, revision) => {
    writes.push({ id, payload, revision });
    if (writes.length === 1) await new Promise(resolve => { release = resolve; });
    return { revision: revision + 1 };
  });
  queue.stage(identity, { notes: 'first' });
  const flushing = queue.flush();
  await new Promise(resolve => setImmediate(resolve));
  queue.stage(identity, { notes: 'latest' });
  queue.stage({ ...identity, item_id: 'B' }, { notes: 'other' });
  release();
  await flushing;
  assert.deepEqual(writes.map(w => w.revision), [0, 1, 0]);
  assert.equal(JSON.parse(writes[1].payload).notes, 'latest');
  assert.equal(queue.dirty, false);
  queue.forget(identity);
  await queue.flush();
  assert.equal(writes.length, 3, 'formal submission has no late draft resurrection');
});
test('failed writes retain pending input, retry uses persisted revision and date isolation', async () => {
  let failed = true;
  const writes = [];
  const queue = new ReviewDraftQueue(async (id, payload, revision) => {
    if (failed) throw new Error('offline');
    writes.push([id.review_date, revision]);
    return { revision: revision + 1 };
  });
  queue.hydrate([{ ...identity, payload_json: '{}', revision: 3 }]);
  queue.stage(identity, { notes: 'keep' });
  await assert.rejects(queue.flush());
  assert.equal(queue.dirty, true);
  failed = false;
  queue.stage({ ...identity, review_date: '2026-10-15' }, { notes: 'yesterday' });
  await queue.flush();
  assert.deepEqual(writes, [['2026-10-16', 3], ['2026-10-15', 0]]);
});
