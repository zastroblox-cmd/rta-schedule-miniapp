const test = require("node:test");
const assert = require("node:assert/strict");
const { getWeekType, validDateString } = require("../lib/schedule-utils");

test("week parity preserves the agreed October 2026 anchor", () => {
  assert.equal(getWeekType("2026-10-12"), "B");
  assert.equal(getWeekType("2026-10-18"), "B");
  assert.equal(getWeekType("2026-10-19"), "A");
  assert.equal(getWeekType("2026-10-25"), "A");
});

test("week parity alternates on each following week", () => {
  assert.equal(getWeekType("2026-10-26"), "B");
  assert.equal(getWeekType("2026-11-02"), "A");
  assert.equal(getWeekType("2026-11-09"), "B");
});

test("validDateString accepts real ISO calendar dates", () => {
  assert.equal(validDateString("2026-11-06"), true);
  assert.equal(validDateString("2024-02-29"), true);
});

test("validDateString rejects malformed and impossible dates", () => {
  for (const value of ["", "2026-2-06", "06-11-2026", "2026-02-29", "2026-13-01", "2026-04-31", null, 20261106]) {
    assert.equal(validDateString(value), false, String(value));
  }
});
