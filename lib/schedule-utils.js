function getWeekType(dateString) {
  // 12–18 Oct 2026 is week B; 19–25 Oct 2026 is week A.
  const date = new Date(dateString + "T12:00:00Z");
  const monday = new Date(date);
  const day = monday.getUTCDay() || 7;
  monday.setUTCDate(monday.getUTCDate() - day + 1);
  const anchor = new Date("2026-10-19T12:00:00Z");
  const weeks = Math.round((monday - anchor) / (7 * 24 * 60 * 60 * 1000));
  return ((weeks % 2) + 2) % 2 === 0 ? "A" : "B";
}

function validDateString(value) {
  if (typeof value !== "string" || !/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

module.exports = { getWeekType, validDateString };
