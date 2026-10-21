/**
 * Smoke tests for the third-year schedule adapter.
 * Run from repository root: node data/test-course3-adapter.js
 * These tests check mechanics, not correctness of PDF transcription.
 */
const assert = require("assert");
const {
  getLessonsForDate,
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

assert.throws(
  () => getLessonsForDate("Ю999/О-2499", date(2026, 10, 19)),
  /Неизвестная группа/,
  "Неизвестная группа должна отклоняться"
);

console.log("OK: проверки адаптера прошли.");
console.log("Внимание: соответствие А/Б чётной/нечётной неделе не задано намеренно.");
