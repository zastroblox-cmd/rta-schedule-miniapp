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

// Do not guess whether A/B corresponds to even/odd week.
assert.strictEqual(parityForDate(date(2026, 10, 19)), null);
assert.strictEqual(parityForDate(date(2026, 10, 19), { А: "чётная неделя", Б: "нечётная неделя" }), "чётная неделя");

const exactDateLesson = getLessonsForDate("Ю604/О-2404", date(2026, 10, 19));
assert(
  exactDateLesson.some(x => x.title === "Международное уголовное право"),
  "Должно вернуться занятие Ю604, назначенное на 19.10"
);

const absentDateLesson = getLessonsForDate("Ю604/О-2404", date(2026, 10, 12));
assert(
  !absentDateLesson.some(x => x.title === "Международное уголовное право"),
  "Занятие с явным списком дат не должно появляться в другие даты"
);

const thursdayException = getLessonsForDate("Ю604/О-2404", date(2026, 10, 22));
assert(
  thursdayException.some(x => x.title === "Международное уголовное право" && x.start === "14:00"),
  "Должно возвращаться разовое занятие Ю604 на 22.10"
);

const excludedSaturday = getLessonsForDate("Ю602/О-2402", date(2026, 10, 17));
assert(
  !excludedSaturday.some(x => x.title === "Гражданское право" && x.start === "14:00"),
  "Исключённая дата 17.10 не должна показывать занятие по гражданскому праву в 14:00"
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
console.log("Внимание: соответствие А/Б чётной/нечётной неделе не задано намеренно.");
