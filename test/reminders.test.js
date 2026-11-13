const test = require("node:test");
const assert = require("node:assert/strict");
const { moscowMinuteWindow, isEntryActiveOnDate, lessonsForCandidate, sameStartMinute, hasScheduleData } = require("../lib/reminders");

test("builds the reminder window in Moscow time across midnight", () => {
  const now = new Date("2026-11-07T20:30:00.000Z"); // 23:30 in Moscow
  const window = moscowMinuteWindow(now, 29, 31);
  assert.deepEqual(window.map(item => [item.date, item.starts_at]), [
    ["2026-11-07", "23:59"],
    ["2026-11-08", "00:00"],
    ["2026-11-08", "00:01"]
  ]);
  assert.equal(window[1].weekday, 7);
});

test("recurring schedule respects weekday, week parity, validity and excluded dates", () => {
  const candidate = { date: "2026-10-19", weekday: 1, week_type: "A" };
  assert.equal(isEntryActiveOnDate({entry_kind:"recurring",weekday:1,week_type:"A"}, candidate), true);
  assert.equal(isEntryActiveOnDate({entry_kind:"recurring",weekday:1,week_type:"B"}, candidate), false);
  assert.equal(isEntryActiveOnDate({entry_kind:"recurring",weekday:2}, candidate), false);
  assert.equal(isEntryActiveOnDate({entry_kind:"recurring",weekday:1,valid_from:"2026-10-20"}, candidate), false);
  assert.equal(isEntryActiveOnDate({entry_kind:"recurring",weekday:1,excluded_dates:["2026-10-19"]}, candidate), false);
});

test("date-specific entries replace recurring entries in the same time slot", () => {
  const candidate = { date: "2026-10-19", weekday: 1, week_type: "A" };
  const entries = [
    {id:1,entry_kind:"recurring",weekday:1,week_type:"A",starts_at:"10:10:00",ends_at:"11:40:00",subject:"Экология"},
    {id:2,entry_kind:"recurring",weekday:1,week_type:"A",starts_at:"12:20:00",ends_at:"13:50:00",subject:"Право"},
    {id:3,entry_kind:"date_override",schedule_date:"2026-10-19",starts_at:"10:10:00",ends_at:"11:40:00",subject:"Зачёт"}
  ];
  const active = lessonsForCandidate(entries, candidate);
  assert.deepEqual(active.map(entry => entry.subject), ["Право", "Зачёт"]);
  assert.equal(sameStartMinute(active[1], {starts_at:"10:10"}), true);
});

test("a recurring course hour reserves its slot unless a dated override replaces it", () => {
  const candidate = { date: "2026-10-19", weekday: 1, week_type: "A" };
  const entries = [
    {id:1,entry_kind:"recurring",weekday:1,starts_at:"10:10:00",ends_at:"11:40:00",subject:"Курсовой час"},
    {id:2,entry_kind:"recurring",weekday:1,starts_at:"10:10:00",ends_at:"11:40:00",subject:"Обычная пара"}
  ];
  assert.deepEqual(lessonsForCandidate(entries, candidate).map(entry => entry.subject), ["Курсовой час"]);
});


test("reminders accept sparse but existing schedules and reject only empty or invalid counts", () => {
  assert.equal(hasScheduleData(0), false);
  assert.equal(hasScheduleData(1), true);
  assert.equal(hasScheduleData(6), true);
  assert.equal(hasScheduleData(24), true);
  assert.equal(hasScheduleData(25), true);
  assert.equal(hasScheduleData(null), false);
  assert.equal(hasScheduleData(-1), false);
});
