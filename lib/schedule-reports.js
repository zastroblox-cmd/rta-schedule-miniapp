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
      starts_at: key, report_count: 0, report_types: [], latest_at: null
    });
    const item = grouped.get(key);
    item.report_count += 1;
    if (!item.report_types.includes(row.report_type)) item.report_types.push(row.report_type);
    if (!item.latest_at || String(row.updated_at || "") > item.latest_at) item.latest_at = row.updated_at;
  }
  return [...grouped.values()].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

module.exports = { SCHEDULE_REPORT_TYPES, isValidLessonTime, summarizeScheduleReports };
