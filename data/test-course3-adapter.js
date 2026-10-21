/**
 * Smoke tests for the third-year schedule adapter.
 * Run from repository root: node data/test-course3-adapter.js
 * These tests check mechanics, not correctness of PDF transcription.
 */
const assert = require("assert");
const {
  getLessonsForDate,
  parityForDate,
  weekLabelForDate
} = require("./course3-adapter");

function date(y, m, d) {
  return new Date(y, m - 1, d);
}

assert.strictEqual(weekLabelForDate(date(2026, 10, 12)), "Б");
assert.strictEqual(weekLabelForDate(date(2026, 10, 18)), "Б");
assert.strictEqual(weekLabelForDate(date(2026, 10, 19)), "А");
assert.strictEqual(weekLabelForDate(date(2026, 10, 25)), "А");
assert.strictEqual(weekLabelForDate(date(2026, 10, 26)), "Б");

// The PDF's parity markers and explicit 17.10 exceptions establish A = even, B = odd.
assert.strictEqual(parityForDate(date(2026, 10, 12)), "нечётная неделя");
assert.strictEqual(parityForDate(date(2026, 10, 19)), "чётная неделя");

const exactDateLesson = getLessonsForDate("Ю604/О-2404", date(2026, 10, 22));
assert(
  exactDateLesson.some(x => x.title === "Международное уголовное право" && x.start === "14:00"),
  "Должно вернуться разовое занятие Ю604, назначенное на 22.10"
);

const courseHour = getLessonsForDate("Ю602/О-2402", date(2026, 10, 19));
assert(
  courseHour.some(x => x.title === "Курсовой час" && x.room === "ККЗ" && x.group === "Ю602/О-2402"),
  "Курсовой час должен отображаться у всех групп в точные даты из PDF"
);
assert(
  !courseHour.some(x => x.title === "Международное право" && x.start === "10:10"),
  "Общий курсовой час должен иметь приоритет над обычной парой в тот же слот"
);

const municipalExtraDate = getLessonsForDate("Ю601/О-2401", date(2026, 12, 14))
  .filter(x => x.title === "Муниципальное право" && x.start === "10:10");
assert.strictEqual(
  municipalExtraDate.length,
  1,
  "Дополнительная дата 14.12 должна показывать ровно одну пару муниципального права"
);

const absentDateLesson = getLessonsForDate("Ю604/О-2404", date(2026, 10, 15));
assert(
  !absentDateLesson.some(x => x.title === "Международное уголовное право" && x.start === "14:00"),
  "Занятие с явным списком дат не должно появляться в другие даты"
);

// ISO date-only strings must preserve the requested calendar day.
const isoDateLesson = getLessonsForDate("Ю604/О-2404", "2026-10-22");
assert(
  isoDateLesson.some(x => x.title === "Международное уголовное право" && x.start === "14:00"),
  "ISO-дата должна обрабатываться без смещения календарного дня"
);

const thursdayException = getLessonsForDate("Ю604/О-2404", date(2026, 10, 22));
assert(
  thursdayException.some(x => x.title === "Международное уголовное право" && x.start === "14:00"),
  "Должно возвращаться разовое занятие Ю604 на 22.10"
);

// The actual mapping must match the official parity markers: A = even, B = odd.
const excludedSaturday = getLessonsForDate("Ю602/О-2402", date(2026, 10, 17));
assert(
  !excludedSaturday.some(x => x.title === "Правовое регулирование нотариата в РФ" && x.start === "10:10"),
  "Нотариат не должен показываться 17.10: дата исключена в PDF"
);
const regularSaturday = getLessonsForDate("Ю602/О-2402", date(2026, 10, 31));
assert(
  regularSaturday.some(x => x.title === "Правовое регулирование нотариата в РФ" && x.start === "10:10"),
  "Нотариат должен показываться на неделе Б после исключённой даты"
);
assert(
  regularSaturday.some(x => x.title === "Правовое регулирование нотариата в РФ" && x.start === "12:20"),
  "Практическая пара по нотариату в 12:20 должна также учитываться"
);

const saturday = getLessonsForDate("Ю603/О-2403", date(2026, 12, 19));
assert(
  saturday.some(x => x.title === "Гражданское право" && x.start === "16:00"),
  "Должно вернуться занятие Ю603, назначенное на 19.12"
);

assert.deepStrictEqual(
  getLessonsForDate("Ю603/О-2403", date(2026, 10, 25)),
  [],
  "Воскресенье должно возвращать пустой список"
);

assert(
  !getLessonsForDate("Ю601/О-2401", date(2026, 10, 19)).some(x => x.group === "ALL"),
  "Общие занятия ALL не должны подключаться до подтверждения состава групп"
);

assert.throws(
  () => getLessonsForDate("Ю999/О-2499", date(2026, 10, 19)),
  /Неизвестная группа/,
  "Неизвестная группа должна отклоняться"
);

// Scan the full timetable period for two lessons assigned to the same group and slot.
const courseGroups = ["Ю601/О-2401", "Ю602/О-2402", "Ю603/О-2403", "Ю604/О-2404"];
for (let current = date(2026, 9, 21); current <= date(2026, 12, 26); current.setDate(current.getDate() + 1)) {
  const weekday = (current.getDay() + 6) % 7;
  if (weekday > 5) continue;
  for (const group of courseGroups) {
    const lessons = getLessonsForDate(group, current);
    const slots = new Map();
    for (const lesson of lessons) {
      const key = lesson.start + "-" + lesson.end;
      slots.set(key, (slots.get(key) || 0) + 1);
    }
    for (const [slot, count] of slots) {
      assert(count <= 1, `Пересечение пар ${group} ${current.toLocaleDateString("ru-RU")} ${slot}`);
    }
  }
}

// Verify that the same adapter loads in a browser-like context without Node globals.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const adapterSource = fs.readFileSync(path.join(__dirname, "course3-adapter.js"), "utf8");
const browserContext = { window: {} };
vm.runInNewContext(adapterSource, browserContext, { filename: "course3-adapter.js" });
const browserApi = browserContext.window.Course3Schedule;
assert(browserApi, "Браузерная версия адаптера должна публиковать window.Course3Schedule");
assert.throws(
  () => browserApi.getLessonsForDate("Ю604/О-2404", "2026-10-22"),
  /не загружены/,
  "Браузерный адаптер должен явно требовать загрузки JSON"
);
browserApi.setDraft(JSON.parse(fs.readFileSync(path.join(__dirname, "course3-review-draft.json"), "utf8")));
assert(
  browserApi.getLessonsForDate("Ю604/О-2404", "2026-10-22")
    .some(x => x.title === "Международное уголовное право" && x.start === "14:00"),
  "Браузерный адаптер должен возвращать занятия после setDraft"
);

console.log("OK: проверки адаптера прошли.");
console.log("Соответствие недель: А = чётная, Б = нечётная; подтверждено по парности и исключению 17.10 в PDF.");
