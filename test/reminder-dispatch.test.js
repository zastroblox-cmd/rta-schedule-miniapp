const test = require("node:test");
const assert = require("node:assert/strict");
const { dispatchReminders } = require("../lib/reminder-dispatch");

test("reminder dispatch uses a representative recurring edit instead of the global course hour", async () => {
  const messages = [];
  const deliveryLookups = [];
  const deliveryUpserts = [];
  const updatedDeliveries = [];
  const entries = [
    {
      id: 1, group_id: 77, entry_kind: "recurring", weekday: 1, week_type: "B",
      starts_at: "10:10:00", ends_at: "11:40:00", subject: "Курсовой час",
      teacher: "", room: "ККЗ", notes: "", source_label: "Официальное расписание 2 курса",
      excluded_dates: [], valid_from: null, valid_to: null
    },
    {
      id: 2, group_id: 77, entry_kind: "recurring", weekday: 1, week_type: "B",
      starts_at: "10:10:00", ends_at: "11:40:00", subject: "Основы военной подготовки",
      teacher: "Палей В.В.", room: "217В", notes: "",
      source_label: "Изменено старостой · повторять на неделях Б",
      excluded_dates: [], valid_from: null, valid_to: null
    }
  ];

  const supabaseRpc = {
    from(table) {
      const query = {
        table,
        operation: "select",
        payload: null,
        select(columns) {
          this.columns = columns;
          if (table === "schedule_entries") {
            assert.match(columns, /source_label/, "reminder query must load source_label to recognize representative overrides");
          }
          return this;
        },
        eq() { return this; },
        in() { return this; },
        upsert(payload) {
          this.operation = "upsert";
          this.payload = payload;
          deliveryUpserts.push({ ...payload });
          return this;
        },
        update(payload) {
          this.operation = "update";
          this.payload = payload;
          return this;
        },
        maybeSingle() {
          deliveryLookups.push(this);
          return Promise.resolve({ data: null, error: null });
        },
        single() {
          return Promise.resolve({ data: { id: 900 }, error: null });
        },
        then(resolve, reject) {
          let result;
          if (table === "reminder_subscriptions" && this.operation === "select") {
            result = {
              data: [{ id: 5, telegram_user_id: "123456", group_id: 77, student_groups: { group_code: "Ю604/О-2504" } }],
              error: null
            };
          } else if (table === "schedule_entries" && this.operation === "select") {
            result = { data: entries, error: null };
          } else if (table === "reminder_deliveries" && this.operation === "update") {
            updatedDeliveries.push({ ...this.payload });
            result = { error: null };
          } else {
            result = { data: [], error: null };
          }
          return Promise.resolve(result).then(resolve, reject);
        }
      };
      return query;
    }
  };

  const result = await dispatchReminders({
    supabaseRpc,
    botToken: "test-token",
    now: new Date("2026-11-23T06:40:00.000Z"), // 09:40 in Moscow; reminder is due for 10:10
    sendMessage: async (_chatId, message) => messages.push(message)
  });

  assert.equal(result.sent, 1);
  assert.equal(result.failed, 0);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /Основы военной подготовки/);
  assert.doesNotMatch(messages[0], /Курсовой час/);
  assert.equal(deliveryLookups.length, 1);
  assert.equal(deliveryLookups[0].table, "reminder_deliveries");
  assert.equal(deliveryUpserts.length, 1);
  assert.equal(deliveryUpserts[0].schedule_entry_id, 2);
  assert.equal(updatedDeliveries.length, 1);
});
