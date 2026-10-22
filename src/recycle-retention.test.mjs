import assert from "node:assert/strict";
import test from "node:test";

import { recycleRetentionMessage, recycleCleanupMessage } from "./recycle-retention.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.parse("2026-09-10T12:00:00+08:00");

test("recycle retention message combines elapsed weeks with remaining days", () => {
  const deletedAt = new Date(now - 24 * DAY_MS).toISOString();
  assert.equal(recycleRetentionMessage(deletedAt, now), "3 周前移入回收站，将在 6 天后被永久删除。");
});

test("recycle retention message updates at minute and hour boundaries", () => {
  assert.equal(
    recycleRetentionMessage(new Date(now - 35 * 60 * 1000).toISOString(), now),
    "35 分钟前移入回收站，将在 30 天后被永久删除。"
  );
  assert.equal(
    recycleRetentionMessage(new Date(now - 5 * 60 * 60 * 1000).toISOString(), now),
    "5 小时前移入回收站，将在 30 天后被永久删除。"
  );
});

test("recycle retention message handles expired and missing timestamps", () => {
  assert.equal(
    recycleRetentionMessage(new Date(now - 31 * DAY_MS).toISOString(), now),
    "1 个月前移入回收站，已到永久删除期限。"
  );
  assert.equal(
    recycleRetentionMessage(null, now),
    "已移入回收站，将在 30 天保留期结束后被永久删除。"
  );
});

test("inline cleanup uses the actual 30-day expiry date in Shanghai time", () => {
  assert.equal(recycleCleanupMessage("2026-10-21T16:30:00Z", Date.parse("2026-10-22T01:00:00+08:00")), "将于 2026-11-21 自动清理");
  assert.equal(recycleCleanupMessage("2026-10-21T15:59:00Z", Date.parse("2026-10-22T01:00:00+08:00")), "将于 2026-11-20 自动清理");
  assert.equal(recycleCleanupMessage("2026-09-01T12:00:00+08:00", Date.parse("2026-10-01T12:00:00+08:00")), "已到自动清理期限");
  assert.equal(recycleCleanupMessage(null, now), "30 天保留期后自动清理");
  assert.equal(recycleCleanupMessage("invalid", now), "30 天保留期后自动清理");
});
