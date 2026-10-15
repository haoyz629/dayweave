import assert from "node:assert/strict";
import test from "node:test";
import { compactBlockDuration, taskBlockType, taskBlockTypeLabels } from "./task-block-display.ts";

test("block durations convert whole hours and keep remaining minutes", () => {
  for (const [minutes, expected] of [[0,"0m"],[15,"15m"],[59,"59m"],[60,"1h"],[90,"1h30m"],[120,"2h"],[125,"2h5m"],[1440,"24h"]]) {
    assert.equal(compactBlockDuration(minutes), expected);
  }
  assert.equal(compactBlockDuration(NaN), "—");
  assert.equal(compactBlockDuration(-15), "—");
});

test("block type follows the whole task date range, with unknown data left unclassified", () => {
  assert.equal(taskBlockType({ earliest_start_date: "2026-10-12", due_date: "2026-10-12" }), "single");
  assert.equal(taskBlockType({ earliest_start_date: "2026-10-12", due_date: "2026-10-13" }), "multi");
  assert.equal(taskBlockType({ earliest_start_date: null, due_date: "2026-10-13" }), null);
  assert.equal(taskBlockType(), null);
  assert.deepEqual(Object.values(taskBlockTypeLabels).map(label => [label.full,label.short]), [["单日任务","单日"],["多日任务","多日"],["重复事项","重复"]]);
});
