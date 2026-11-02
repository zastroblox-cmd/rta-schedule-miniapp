import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const requiredIds = [
  "prevWeek", "nextWeek", "todayWeek", "days", "dayView",
  "repScopeDate", "repScopeAll", "repEditForm", "repOpen",
  "groupModal", "weekRange", "weekParity"
];

for (const id of requiredIds) {
  assert.match(html, new RegExp('id=["\\']' + id + '["\\']'), `Missing required UI element: #${id}`);
}

const inlineScripts = [];
const scriptPattern = /<script\\b([^>]*)>([\\s\\S]*?)<\\/script\\s*>/gi;
let match;
while ((match = scriptPattern.exec(html)) !== null) {
  if (/\\bsrc\\s*=/.test(match[1])) continue;
  const source = match[2].trim();
  if (source) inlineScripts.push(source);
}
assert.ok(inlineScripts.length >= 2, "Expected main app and representative editor inline scripts");
inlineScripts.forEach((source, index) => {
  new vm.Script(source, { filename: `index.html:inline-script-${index + 1}` });
});

assert.match(html, /new Date\\(2026,\\s*9,\\s*12\\)/, "Week parity anchor must remain 12 October 2026");
assert.match(html, /12–18 октября 2026 — неделя Б/, "Week B anchor explanation must remain");
assert.match(html, /visibilitychange/, "Swipe recovery on app visibility changes must remain");
assert.match(html, /pageshow/, "Swipe recovery after page restore must remain");
assert.match(html, /Telegram\\.WebApp/, "Telegram Mini App SDK integration must remain");
assert.match(html, /repScopeAll/, "Representative all-weeks scope must remain");
assert.match(html, /repScopeDate/, "Representative one-date scope must remain");

console.log(`Smoke check passed: ${requiredIds.length} required UI elements, ${inlineScripts.length} inline scripts parsed, week navigation and Telegram hooks present.`);
