import assert from "node:assert/strict";
import test from "node:test";
import { joinTaskNotes, splitTaskNotes } from "./task-notes.ts";

test("URL and remarks round-trip through saved task notes", () => {
  const saved = joinTaskNotes("https://example.com/a?b=1", "核对资料\n联系负责人");
  assert.deepEqual(splitTaskNotes(saved), {
    url: "https://example.com/a?b=1",
    body: "核对资料\n联系负责人"
  });
  assert.deepEqual(splitTaskNotes(joinTaskNotes("https://example.com", "")), {
    url: "https://example.com", body: ""
  });
});

test("existing plain remarks stay unchanged when no URL is entered", () => {
  assert.deepEqual(splitTaskNotes("第一行\n第二行"), { url: "", body: "第一行\n第二行" });
  assert.equal(joinTaskNotes("", "第一行\n第二行"), "第一行\n第二行");
});
