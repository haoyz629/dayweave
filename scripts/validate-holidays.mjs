import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { validateHolidayYear } from "../src/official-holiday-calendar.ts";

// These files are bundled offline fallbacks, not a remotely published index.
const directory = new URL("../data/holidays/", import.meta.url);
const files = (await readdir(directory)).filter((name) => /^\d{4}\.json$/.test(name)).sort();
assert.ok(files.length > 0, "未找到内置年度数据");
for (const name of files) {
  const text = await readFile(new URL(name, directory), "utf8");
  assert.ok(Buffer.byteLength(text) <= 256 * 1024, `${name}: 数据过大`);
  const data = JSON.parse(text);
  validateHolidayYear(data);
  assert.equal(name, `${data.year}.json`, "内置年度文件名与内容不符");
  console.log(`${data.year} revision ${data.revision}: ${data.holidays.reduce((sum, group) => sum + group.dates.length, 0)} 放假日、${data.makeupWorkdays.length} 补班日，内置兜底校验通过`);
}
console.log("内置数据校验完成；在线更新直接读取 jsDelivr 上的 holiday-cn 年度 JSON，不使用自有索引。");
