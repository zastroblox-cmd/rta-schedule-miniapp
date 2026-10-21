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

// Established anchor dates match ISO week parity: A = odd, B = even.
assert.strictEqual(parityForDate(date(2026, 10, 12)), "чётная неделя");
assert.strictEqual(parityForDate(date(2026, 10, 19)), "нечётная неделя");

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

// Reversed synthetic mapping is used only to isolate excluded-date filtering:
 // the actual default mapping is tested above.
const testParityMap = { А: "чётная неделя", Б: "нечётная неделя" };
const excludedSaturday = getLessonsForDate(
  "Ю602/О-2402",
  date(2026, 10, 17),
  { parityMap: testParityMap }
);
assert(
  !excludedSaturday.some(x => x.title === "Правовое регулирование нотариата в РФ" && x.start === "12:20"),
  "Занятие по нотариату с исключением 17.10 не должно показываться в исключённую дату"
);
const defaultMappedSaturday = getLessonsForDate("Ю602/О-2402", date(2026, 10, 24));
assert(
  defaultMappedSaturday.some(x => x.title === "Правовое регулирование нотариата в РФ" && x.start === "10:10"),
  "При стандартной карте неделя А должна соответствовать нечётной неделе"
);

const regularSaturday = getLessonsForDate(
  "Ю602/О-2402",
  date(2026, 10, 31),
  { parityMap: testParityMap }
);
assert(
  regularSaturday.some(x => x.title === "Правовое регулирование нотариата в РФ" && x.start === "12:20"),
  "То же занятие должно показываться 31.10 при тестовом соответствии недели Б нечётной неделе"
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

console.log("OK: проверки адаптера прошли.");
console.log("Соответствие недель: А = нечётная, Б = чётная; контрольные даты соответствуют ISO-нумерации недель.");
