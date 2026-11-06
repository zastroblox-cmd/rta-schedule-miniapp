const { moscowMinuteWindow, lessonsForCandidate, sameStartMinute } = require("./reminders");

async function dispatchReminders({ supabaseRpc, botToken, now = new Date(), sendMessage }) {
  if (!supabaseRpc || !botToken) throw new Error("Reminder dispatch is not configured");
  const sender = sendMessage || (async (chatId, text) => {
    const response = await fetch("https://api.telegram.org/bot" + botToken + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok !== true) throw new Error(String(body.description || "Telegram delivery failed").slice(0, 240));
    return body;
  });

  const { data: subscriptions, error: subscriptionError } = await supabaseRpc
    .from("reminder_subscriptions")
    .select("id,telegram_user_id,group_id,student_groups(group_code)")
    .eq("enabled", true);
  if (subscriptionError) throw new Error("Unable to load reminder subscriptions: " + subscriptionError.message);
  if (!subscriptions || !subscriptions.length) return { checked: 0, sent: 0, failed: 0 };

  const groupIds = [...new Set(subscriptions.map(item => Number(item.group_id)).filter(Number.isSafeInteger))];
  const { data: entries, error: entriesError } = await supabaseRpc
    .from("schedule_entries")
    .select("id,group_id,entry_kind,weekday,week_type,schedule_date,starts_at,ends_at,subject,teacher,room,notes,excluded_dates,valid_from,valid_to")
    .in("group_id", groupIds);
  if (entriesError) throw new Error("Unable to load reminder schedule: " + entriesError.message);

  const entriesByGroup = new Map();
  for (const entry of entries || []) {
    const key = String(entry.group_id);
    if (!entriesByGroup.has(key)) entriesByGroup.set(key, []);
    entriesByGroup.get(key).push(entry);
  }

  let sent = 0;
  let failed = 0;
  let checked = 0;
  const candidates = moscowMinuteWindow(now, 29, 31);
  for (const subscription of subscriptions) {
    const groupEntries = entriesByGroup.get(String(subscription.group_id)) || [];
    for (const candidate of candidates) {
      const lessons = lessonsForCandidate(groupEntries, candidate).filter(item => sameStartMinute(item, candidate));
      for (const lesson of lessons) {
        checked += 1;
        const entryId = Number(lesson.id);
        if (!Number.isSafeInteger(entryId) || entryId < 1) continue;
        const lookup = await supabaseRpc.from("reminder_deliveries")
          .select("id,status,attempts")
          .eq("subscription_id", subscription.id)
          .eq("schedule_entry_id", entryId)
          .eq("schedule_date", candidate.date)
          .maybeSingle();
        if (lookup.error) { failed += 1; continue; }
        if (lookup.data && lookup.data.status === "sent") continue;

        const attempts = Number(lookup.data && lookup.data.attempts || 0) + 1;
        const { data: delivery, error: deliveryError } = await supabaseRpc.from("reminder_deliveries")
          .upsert({
            subscription_id: subscription.id,
            schedule_entry_id: entryId,
            schedule_date: candidate.date,
            starts_at: String(lesson.starts_at).slice(0, 8),
            status: "pending",
            attempts,
            last_error: null,
            updated_at: new Date().toISOString()
          }, { onConflict: "subscription_id,schedule_entry_id,schedule_date" })
          .select("id").single();
        if (deliveryError || !delivery) { failed += 1; continue; }

        const groupCode = subscription.student_groups && subscription.student_groups.group_code
          ? subscription.student_groups.group_code : "твоя группа";
        const start = String(lesson.starts_at || "").slice(0, 5);
        const end = String(lesson.ends_at || "").slice(0, 5);
        const subject = String(lesson.subject || "Пара");
        const room = String(lesson.room || "").trim();
        const message = [
          "⏰ Через 30 минут начнётся пара",
          subject,
          "Время: " + start + (end ? "–" + end : ""),
          "Группа: " + groupCode,
          room ? "Аудитория: " + room : "",
          "Напоминание по расписанию приложения."
        ].filter(Boolean).join("\n");

        try {
          await sender(subscription.telegram_user_id, message);
          const { error: updateError } = await supabaseRpc.from("reminder_deliveries")
            .update({ status: "sent", sent_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() })
            .eq("id", delivery.id);
          if (updateError) throw new Error("Message sent but delivery status could not be saved");
          sent += 1;
        } catch (error) {
          await supabaseRpc.from("reminder_deliveries")
            .update({ status: "failed", last_error: String(error.message || "Telegram delivery failed").slice(0, 240), updated_at: new Date().toISOString() })
            .eq("id", delivery.id);
          failed += 1;
        }
      }
    }
  }
  return { checked, sent, failed };
}

module.exports = { dispatchReminders };
