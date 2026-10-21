/* First-year schedule adapter. Source exceptions are kept guarded; no guessed dates are activated. */
(function (root) {
  "use strict";
  let draft = null;
  const GROUPS = ["Ю600/О-2601", "Ю600/О-2602", "Ю600/О-2603", "Ю600/О-2604"];
  const unresolved = new Set(["19.12*"]);
  function pad(n) { return String(n).padStart(2, "0"); }
  function dm(date) { return pad(date.getDate()) + "." + pad(date.getMonth() + 1); }
  function iso(date) { return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()); }
  function weekParity(date) {
    const anchor = new Date(2026, 9, 12);
    const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const weeks = Math.round((monday - anchor) / 604800000);
    return ((weeks % 2) + 2) % 2 === 0 ? "нечётная неделя" : "чётная неделя";
  }
  function appliesToGroup(item, group) {
    if (item.group === group) return true;
    return item.group === "ALL" && Array.isArray(item.groups) && item.groups.includes(group);
  }
  function getLessonsForDate(group, dateString) {
    if (!draft || !GROUPS.includes(group)) return [];
    const date = new Date(dateString + "T12:00:00");
    if (Number.isNaN(date.getTime())) return [];
    // This PDF describes the autumn 2026 term; do not repeat weekly classes into future terms.
    if (date.getFullYear() !== 2026 || date < new Date(2026, 8, 1) || date > new Date(2026, 11, 31)) return [];
    const day = (date.getDay() + 6) % 7;
    const dayMonth = dm(date);
    const parity = weekParity(date);
    let matches = draft.lessons.filter(item => {
      if (!appliesToGroup(item, group) || Number(item.day) !== day) return false;
      if (Array.isArray(item.source_dates_unresolved) && item.source_dates_unresolved.some(d => unresolved.has(d))) return false;
      if (Array.isArray(item.dates) && item.dates.length) return item.dates.includes(dayMonth);
      if (item.dates_until) {
        const [d, m] = item.dates_until.split(".").map(Number);
        const until = new Date(date.getFullYear(), m - 1, d);
        if (date > until) return false;
      }
      if (item.parity && item.parity !== parity) return false;
      if (Array.isArray(item.excluded_dates) && item.excluded_dates.includes(dayMonth)) return false;
      return true;
    }).map(item => ({
      start: item.start, end: item.end, title: item.title, type: item.type || "Занятие",
      room: item.room || "Уточняется накануне", teacher: item.teacher || "",
      dates: Array.isArray(item.dates) ? item.dates.join(", ") : "",
      color: (item.type || "").includes("Физкультура") ? "green" : "blue",
      note: item.note || ""
    }));
    const overrideSlots = new Set(matches.filter(x => x.title === "Курсовой час").map(x => x.start));
    matches = matches.filter(x => x.title === "Курсовой час" || !overrideSlots.has(x.start));
    return matches.sort((a, b) => a.start.localeCompare(b.start));
  }
  root.Course1Schedule = {
    groups: GROUPS.slice(),
    setDraft(data) { draft = data; },
    getLessonsForDate,
    getWeekParity(dateString) { return weekParity(new Date(dateString + "T12:00:00")); },
    get loaded() { return Boolean(draft && Array.isArray(draft.lessons)); }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = root.Course1Schedule;
})(typeof window !== "undefined" ? window : globalThis);
