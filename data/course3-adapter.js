/**
 * Адаптер расписания 3-го курса (предварительный, не подключён к приложению).
 * Правило недели: 12–18.10.2026 = Б; 19–25.10.2026 = А; далее чередуется.
 *
 * Использование в Node:
 * const { getLessonsForDate } = require("./course3-adapter");
 * getLessonsForDate("Ю601/О-2401", new Date(2026, 9, 19));
 */
const fs = require("fs");
const path = require("path");
const draft = JSON.parse(
  fs.readFileSync(path.join(__dirname, "course3-review-draft.json"), "utf8")
);

const ANCHOR_MONDAY = new Date(2026, 9, 12);
const TERM_START = new Date(2026, 8, 21);
const GROUPS = new Set([
  "Ю601/О-2401", "Ю602/О-2402", "Ю603/О-2403", "Ю604/О-2404"
]);

function dayOnly(value) {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dateStamp(date) {
  return String(date.getDate()).padStart(2, "0") + "." +
    String(date.getMonth() + 1).padStart(2, "0");
}

function mondayOf(date) {
  const monday = dayOnly(date);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

function parityForDate(date) {
  const targetMonday = mondayOf(date);
  const anchorMonday = mondayOf(ANCHOR_MONDAY);
  const weekIndex = Math.round((targetMonday - anchorMonday) / (7 * 86400000));
  // Якорная неделя 12–18 октября — Б; следующая — А.
  return ((weekIndex % 2) + 2) % 2 === 0 ? "чётная неделя" : "нечётная неделя";
}

function inTermRange(lesson, date) {
  const stamp = dateStamp(date);
  if (lesson.dates_from && stamp < lesson.dates_from) return false;
  if (lesson.dates_until && stamp > lesson.dates_until) return false;
  if (!lesson.dates_from && lesson.dates_until && date < TERM_START) return false;
  return true;
}

function matchesDate(lesson, date) {
  const stamp = dateStamp(date);
  if (Array.isArray(lesson.dates) && !lesson.dates.includes(stamp)) return false;
  if (Array.isArray(lesson.excluded_dates) && lesson.excluded_dates.includes(stamp)) return false;
  if (!inTermRange(lesson, date)) return false;
  if (lesson.parity && lesson.parity !== parityForDate(date)) return false;
  return true;
}

/**
 * Возвращает копии занятий конкретной группы на календарную дату.
 * Записи group=ALL намеренно не включаются: состав групп для общих лекций
 * должен быть подтверждён по оригиналу PDF, иначе возможен показ лишних пар.
 */
function getLessonsForDate(group, value) {
  if (!GROUPS.has(group)) throw new Error("Неизвестная группа третьего курса: " + group);
  const date = dayOnly(value);
  const weekday = (date.getDay() + 6) % 7;
  if (weekday > 5) return [];

  return draft.lessons
    .filter(lesson =>
      lesson.group === group &&
      lesson.day === weekday &&
      matchesDate(lesson, date)
    )
    .map(lesson => {
      const copy = { ...lesson };
      if (!copy.room && copy.room_by_parity) {
        copy.room = copy.room_by_parity[parityForDate(date)] || "";
      }
      return copy;
    })
    .sort((a, b) => a.start.localeCompare(b.start));
}

module.exports = { getLessonsForDate, parityForDate, dateStamp, GROUPS };
