const test = require("node:test");
const assert = require("node:assert/strict");
const { SCHEDULE_REPORT_TYPES, isValidLessonTime, summarizeScheduleReports, isCancellationAlertThresholdReached } = require("../lib/schedule-reports");

test("accepts only supported report categories", () => {
  assert.equal(SCHEDULE_REPORT_TYPES.has("cancelled"), true);
  assert.equal(SCHEDULE_REPORT_TYPES.has("rumor"), false);
});

test("validates 24-hour lesson times", () => {
  for (const value of ["00:00", "08:30", "23:59"]) assert.equal(isValidLessonTime(value), true, value);
  for (const value of ["24:00", "12:60", "8:30", "noon", "", null]) assert.equal(isValidLessonTime(value), false, String(value));
});

test("aggregates reports by lesson start without exposing reporter identifiers", () => {
  const result = summarizeScheduleReports([
    { starts_at: "10:10:00", report_type: "cancelled", updated_at: "2026-11-06T10:00:00Z" },
    { starts_at: "10:10:00", report_type: "cancelled", updated_at: "2026-11-06T10:01:00Z" },
    { starts_at: "12:20:00", report_type: "room", updated_at: "2026-11-06T10:02:00Z" }
  ]);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], {
    starts_at: "10:10",
    report_count: 2,
    report_types: ["cancelled"],
    report_type_counts: { cancelled: 2 },
    cancelled_count: 2,
    latest_at: "2026-11-06T10:01:00Z"
  });
  assert.equal("reporter_hash" in result[0], false);
});

test("ignores malformed report rows and returns stable chronological order", () => {
  const result = summarizeScheduleReports([
    { starts_at: "14:00:00", report_type: "room", updated_at: "2026-11-06T10:00:00Z" },
    { starts_at: "", report_type: "other", updated_at: "2026-11-06T10:00:00Z" },
    { starts_at: "08:30:00", report_type: "moved", updated_at: "2026-11-06T10:00:00Z" }
  ]);
  assert.deepEqual(result.map(row => row.starts_at), ["08:30", "14:00"]);
});

test("only three cancellation reports trigger a possible-cancellation alert", () => {
  assert.equal(isCancellationAlertThresholdReached({ cancelled_count: 2, report_count: 5 }), false);
  assert.equal(isCancellationAlertThresholdReached({ cancelled_count: 3, report_count: 3 }), true);
  assert.equal(isCancellationAlertThresholdReached({ cancelled_count: 1, report_count: 8 }), false);
  assert.equal(isCancellationAlertThresholdReached(null), false);
});
