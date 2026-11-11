import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { validateHolidayYear } from "../src/official-holiday-calendar.ts";

const directory = new URL("../data/holidays/", import.meta.url);
const readJson = async (path) => {
  const text = await readFile(new URL(path, directory), "utf8");
  assert.ok(Buffer.byteLength(text) <= 256 * 1024, `${path}: 数据过大`);
  return JSON.parse(text);
};
const index = await readJson("index.json");
assert.equal(index.schemaVersion, 1, "不支持的索引结构版本");
assert.ok(Array.isArray(index.years) && index.years.length <= 301, "年度索引无效");
const seen = new Set();
for (const entry of index.years) {
  assert.ok(!seen.has(entry.year), "重复年度");
  seen.add(entry.year);
  assert.equal(entry.path, `${entry.year}.json`, "年度路径必须固定，不允许外部地址");
  const data = await readJson(entry.path);
  validateHolidayYear(data);
  for (const key of ["year", "revision", "sourceUrl", "verifiedAt"]) assert.equal(data[key], entry[key], `${entry.path}: ${key} 与索引不符`);
  console.log(`${data.year} revision ${data.revision}: ${data.holidays.reduce((sum, group) => sum + group.dates.length, 0)} 放假日、${data.makeupWorkdays.length} 补班日，校验通过`);
}
for (const name of await readdir(directory)) {
  if (/^\d{4}\.json$/.test(name)) assert.ok(seen.has(Number(name.slice(0, 4))), `${name} 未加入索引`);
}
console.log("发布结构校验完成；官方通知内容仍需维护者人工逐项核对。");
