const API_URL = String(process.env.REMINDER_API_URL || "https://rta-schedule-api.onrender.com").replace(/\/+$/, "");
const SECRET = String(process.env.REMINDER_CRON_SECRET || "");

async function main() {
  if (!SECRET) throw new Error("REMINDER_CRON_SECRET is required");
  const response = await fetch(API_URL + "/api/reminders/dispatch", {
    method: "POST",
    headers: { "Authorization": "Bearer " + SECRET, "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(45_000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("Reminder dispatch failed (" + response.status + "): " + String(body.error || "unknown error"));
  process.stdout.write(JSON.stringify(body) + "\n");
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
