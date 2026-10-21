/**
 * Предварительная проверка data/course3-review-draft.json.
 * Запуск из корня репозитория: node data/validate-course3.js
 * Скрипт только проверяет структуру; он не доказывает соответствие PDF.
 */
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "course3-review-draft.json");
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const allowedGroups = new Set([
  "Ю601/О-2401", "Ю602/О-2402", "Ю603/О-2403", "Ю604/О-2404", "ALL"
]);
const errors = [];
const warnings = [];
const required = ["day", "start", "end", "group", "title", "type", "teacher", "confidence"];

if (!Array.isArray(data.lessons)) throw new Error("Поле lessons должно быть массивом.");

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const datePattern = /^\d{2}\.\d{2}$/;
const seen = new Map();

data.lessons.forEach((lesson, index) => {
  const label = `lessons[${index}] ${lesson.group || "без группы"} ${lesson.title || "без названия"}`;

  for (const field of required) {
    if (lesson[field] === undefined || lesson[field] === null || lesson[field] === "") {
      errors.push(`${label}: отсутствует обязательное поле ${field}`);
    }
  }

  if (!allowedGroups.has(lesson.group)) errors.push(`${label}: неизвестная группа ${lesson.group}`);
  if (!Number.isInteger(lesson.day) || lesson.day < 0 || lesson.day > 5) {
    errors.push(`${label}: day должен быть числом 0–5 (пн–сб)`);
  }
  if (lesson.start && !timePattern.test(lesson.start)) errors.push(`${label}: неверное start ${lesson.start}`);
  if (lesson.end && !timePattern.test(lesson.end)) errors.push(`${label}: неверное end ${lesson.end}`);
  if (lesson.start && lesson.end && lesson.start >= lesson.end) errors.push(`${label}: время окончания не позже начала`);
  if (lesson.parity && !allowedParities.has(lesson.parity)) {
    errors.push(`${label}: неизвестное значение parity ${lesson.parity}`);
  }

  for (const field of ["dates", "excluded_dates"]) {
    if (lesson[field] !== undefined && !Array.isArray(lesson[field])) {
      errors.push(`${label}: ${field} должен быть массивом`);
    } else if (Array.isArray(lesson[field])) {
      lesson[field].forEach(date => {
        if (!validDayMonth(date)) errors.push(`${label}: дата ${date} в ${field} некорректна, ожидается существующая дата ДД.ММ`);
      });
    }
  }

  for (const field of ["dates_from", "dates_until"]) {
    if (lesson[field] && !validDayMonth(lesson[field])) {
      errors.push(`${label}: ${field} должен содержать существующую дату ДД.ММ`);
    }
  }

  if (!lesson.room && !lesson.room_by_parity) warnings.push(`${label}: не указана аудитория`);
  if (lesson.confidence !== "high") warnings.push(`${label}: confidence=${lesson.confidence || "не задана"} — требуется сверка`);
  if (lesson.group === "ALL") warnings.push(`${label}: общую запись нельзя показывать всем группам без подтверждения состава`);

  if (lesson.dates_from && lesson.dates_until &&
      dayMonthKey(lesson.dates_from) > dayMonthKey(lesson.dates_until)) {
    errors.push(`${label}: dates_from позже dates_until`);
  }

  // Ловим только полностью совпадающие ключи. Пересечения разных диапазонов дат
  // и недель требуют отдельной предметной проверки и автоматически не исправляются.
  const key = [
    lesson.group, lesson.day, lesson.start, lesson.end, lesson.parity || "",
    JSON.stringify(lesson.dates || []), JSON.stringify(lesson.excluded_dates || []),
    lesson.dates_from || "", lesson.dates_until || ""
  ].join("|");
  if (seen.has(key)) {
    warnings.push(`${label}: возможный дубликат с lessons[${seen.get(key)}]`);
  } else {
    seen.set(key, index);
  }
});

console.log(`Занятий: ${data.lessons.length}`);
console.log(`Ошибок структуры: ${errors.length}`);
console.log(`Предупреждений: ${warnings.length}`);
if (errors.length) {
  console.error("\nОШИБКИ:");
  errors.forEach(message => console.error("- " + message));
}
if (warnings.length) {
  console.log("\nПРЕДУПРЕЖДЕНИЯ (первые 40):");
  warnings.slice(0, 40).forEach(message => console.log("- " + message));
  if (warnings.length > 40) console.log(`…ещё ${warnings.length - 40}`);
}
if (errors.length) process.exitCode = 1;
