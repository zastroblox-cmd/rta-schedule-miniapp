"use strict";

const SCHEDULE_REPORT_TYPES = new Set(["cancelled", "moved", "room", "teacher", "other"]);

function isValidLessonTime(value) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function summarizeScheduleReports(rows) {
  const grouped = new Map();
  for (const row of rows || []) {
    const key = String(row.starts_at || "").slice(0, 5);
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, {
      starts_at: key, report_count: 0, report_types: [], report_type_counts: {}, cancelled_count: 0, latest_at: null
    });
    const item = grouped.get(key);
    item.report_count += 1;
    const type = String(row.report_type || "other");
    item.report_type_counts[type] = (item.report_type_counts[type] || 0) + 1;
    if (type === "cancelled") item.cancelled_count += 1;
    if (!item.report_types.includes(type)) item.report_types.push(type);
    if (!item.latest_at || String(row.updated_at || "") > item.latest_at) item.latest_at = row.updated_at;
  }
  return [...grouped.values()].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

function isCancellationAlertThresholdReached(summary) {
  return Number(summary && summary.cancelled_count) >= 3;
}

module.exports = {
  SCHEDULE_REPORT_TYPES,
  isValidLessonTime,
  summarizeScheduleReports,
  isCancellationAlertThresholdReached
};
