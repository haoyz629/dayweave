import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

test("today schedule date has a prominent responsive heading", () => {
  assert.match(app, /<h2 className="timeline-day-title">\{selectedDateTitle\}<\/h2>/);
  assert.match(styles, /\.today-page \.timeline-day-title \{[^}]*font: 800 clamp\(26px, 1\.75vw, 30px\)\/1\.25 var\(--jx-font-serif\)/);
});

test("weekday, lunar date and solar term remain readable beneath the date", () => {
  assert.match(styles, /\.today-page \.timeline-date-meta\.timeline-day-subline \{[^}]*gap: 8px; margin-top: 6px; color: var\(--jx-ink-soft\); font: 500 14px\/1\.5 var\(--jx-font-sans\)/);
  assert.match(styles, /\.today-page \.timeline-day-subline > span \{ font: inherit; color: inherit; \}/);
  assert.match(styles, /\.today-page \.timeline-day-subline > \.historical-plan-status \{ font: inherit; \}/);
  assert.match(styles, /\.today-page \.timeline-day-subline > \.timeline-term-chip \{[^}]*font: 500 13px\/1\.4 var\(--jx-font-sans\)/);
});
