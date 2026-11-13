const { getWeekType } = require("./schedule-utils");

const TIME_ZONE = "Europe/Moscow";

function zonedParts(date, timeZone = TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
}

function moscowMinuteWindow(now = new Date(), before = 29, after = 31) {
  const result = [];
  for (let offset = before; offset <= after; offset += 1) {
    const parts = zonedParts(new Date(now.getTime() + offset * 60_000));
    const date = parts.year + "-" + parts.month + "-" + parts.day;
    const weekdayByName = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    result.push({
      date,
      weekday: weekdayByName[parts.weekday],
      starts_at: parts.hour + ":" + parts.minute,
      week_type: getWeekType(date)
    });
  }
  return result;
}

function isEntryActiveOnDate(entry, candidate) {
  if (entry.entry_kind === "date_override") return String(entry.schedule_date || "").slice(0, 10) === candidate.date;
  if (entry.entry_kind !== "recurring" || Number(entry.weekday) !== candidate.weekday) return false;
  if (entry.week_type && entry.week_type !== candidate.week_type) return false;
  const date = candidate.date;
  if (entry.valid_from && String(entry.valid_from).slice(0, 10) > date) return false;
  if (entry.valid_to && String(entry.valid_to).slice(0, 10) < date) return false;
  const excluded = Array.isArray(entry.excluded_dates) ? entry.excluded_dates.map(value => String(value).slice(0, 10)) : [];
  return !excluded.includes(date);
}

function lessonsForCandidate(entries, candidate) {
  const dated = entries.filter(entry => entry.entry_kind === "date_override" && isEntryActiveOnDate(entry, candidate));
  const overrideSlots = new Set(dated.map(entry => String(entry.starts_at).slice(0, 8) + "|" + String(entry.ends_at).slice(0, 8)));
  const recurring = entries.filter(entry => entry.entry_kind === "recurring" && isEntryActiveOnDate(entry, candidate))
    .filter(entry => !overrideSlots.has(String(entry.starts_at).slice(0, 8) + "|" + String(entry.ends_at).slice(0, 8)));
  const all = [...recurring, ...dated];
  const courseHourSlots = new Set(all
    .filter(entry => entry.subject === "Курсовой час" && entry.entry_kind !== "date_override")
    .map(entry => String(entry.starts_at).slice(0, 8) + "|" + String(entry.ends_at).slice(0, 8)));
  return all.filter(entry => entry.entry_kind === "date_override" || entry.subject === "Курсовой час" ||
    !courseHourSlots.has(String(entry.starts_at).slice(0, 8) + "|" + String(entry.ends_at).slice(0, 8)));
}

function sameStartMinute(entry, candidate) {
  return String(entry.starts_at || "").slice(0, 5) === candidate.starts_at;
}

function hasScheduleData(entryCount) {
  return Number.isInteger(entryCount) && entryCount > 0;
}

module.exports = { TIME_ZONE, zonedParts, moscowMinuteWindow, isEntryActiveOnDate, lessonsForCandidate, sameStartMinute, hasScheduleData };
