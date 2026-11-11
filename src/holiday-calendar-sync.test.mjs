import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(readFileSync(new URL("./holiday-calendar-sync.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };
function harness() {
  const read = deferred(), check = deferred();
  let snapshot = { years: [], checking: false, lastError: null }, event, cleanup;
  const modules = {
    react: { useEffect: fn => { cleanup = fn(); }, useSyncExternalStore: (_subscribe, get) => get() },
    "@tauri-apps/api/event": { listen: async (_name, callback) => { event = callback; return () => {}; } },
    "./tauri": { getHolidayCalendar: () => read.promise, checkHolidayUpdates: () => check.promise },
    "./official-holiday-calendar": {
      getHolidayCalendarSnapshot: () => snapshot, installHolidayCalendarSnapshot: next => { snapshot = next; },
      holidayDataKey: next => JSON.stringify(next.years), subscribeHolidayCalendar: () => () => {}
    }
  };
  const context = vm.createContext({ exports: {}, window: { __TAURI_INTERNALS__: {} }, require: name => {
    assert.ok(modules[name], `unexpected import ${name}`); return modules[name];
  } });
  vm.runInContext(source, context);
  context.exports.useHolidayCalendarSync();
  return { api: context.exports, read, check, emit: payload => event({ payload }), current: () => snapshot, stop: () => cleanup() };
}

test("late startup read cannot overwrite a committed calendar event", async () => {
  const h = harness(); await flush();
  const latest = { years: [{ year: 2027, revision: 2 }], checking: false };
  h.emit(latest); h.read.resolve({ years: [{ year: 2026, revision: 1 }] }); await flush();
  assert.equal(h.current(), latest); h.stop();
});

test("late manual response or rejection cannot undo a newer calendar event", async () => {
  for (const reject of [false, true]) {
    const h = harness(); await flush(); h.read.resolve(h.current()); await flush();
    const request = h.api.requestHolidayUpdate([2027], true);
    const latest = { years: [{ year: 2027, revision: 2 }], checking: false, lastError: null };
    h.emit(latest);
    if (reject) h.check.reject(new Error("old failure")); else h.check.resolve({ years: [], checking: true });
    await request; assert.equal(h.current(), latest); h.stop();
  }
});

test("without an intervening event manual replies install and failures retain usable data", async () => {
  const h = harness(); await flush(); h.read.resolve(h.current()); await flush();
  const request = h.api.requestHolidayUpdate([2027], true);
  const loaded = { years: [{ year: 2027, revision: 1 }], checking: false };
  h.check.resolve(loaded); await request; assert.equal(h.current(), loaded); h.stop();
  const failed = harness(); await flush(); const previous = failed.current();
  failed.read.resolve(previous); await flush();
  const retry = failed.api.requestHolidayUpdate([], true); failed.check.reject(new Error("offline")); await retry;
  assert.equal(failed.current().years, previous.years); assert.match(failed.current().lastError, /offline/); failed.stop();
});
