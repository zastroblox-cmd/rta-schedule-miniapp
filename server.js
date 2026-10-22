const express = require("express");
const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));

const PORT = Number(process.env.PORT || 3000);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowed = new Set([
    "https://zastroblox-cmd.github.io",
    "https://web.telegram.org",
    "https://telegram.org",
    "https://t.me",
    "http://localhost:3000",
    "http://127.0.0.1:3000"
  ]);
  if (origin && allowed.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

function verifyTelegramInitData(initData) {
  if (!TELEGRAM_BOT_TOKEN || !OWNER_TELEGRAM_ID || typeof initData !== "string" || !initData) return null;
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) return null;
  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => key + "=" + value)
    .join("\n");
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(TELEGRAM_BOT_TOKEN).digest();
  const calculatedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest();
  const suppliedHash = Buffer.from(receivedHash, "hex");
  if (suppliedHash.length !== calculatedHash.length || !crypto.timingSafeEqual(suppliedHash, calculatedHash)) return null;
  const authDate = Number(params.get("auth_date"));
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(authDate) || authDate > now + 60 || now - authDate > 86400) return null;
  let user;
  try { user = JSON.parse(params.get("user") || "null"); } catch { return null; }
  if (!user || String(user.id) !== OWNER_TELEGRAM_ID) return null;
  return { id: String(user.id), first_name: String(user.first_name || "") };
}

app.post("/api/owner/verify", (req, res) => {
  const owner = verifyTelegramInitData(req.body && req.body.initData);
  res.setHeader("Cache-Control", "no-store");
  if (!owner) return res.status(403).json({ authorized: false, error: "Owner access denied" });
  return res.json({ authorized: true, owner });
});

app.get("/health", (_req, res) => {
  res.status(supabase ? 200 : 503).json({
    status: supabase ? "ok" : "configuration_required",
    databaseConfigured: Boolean(supabase)
  });
});

app.get("/api/faculties", async (_req, res) => {
  if (!supabase) return res.status(503).json({ error: "Database is not configured" });
  const { data, error } = await supabase.from("faculties")
    .select("id,name,slug").order("name");
  if (error) return res.status(500).json({ error: "Unable to load faculties" });
  res.json({ data });
});

app.get("/api/groups", async (_req, res) => {
  if (!supabase) return res.status(503).json({ error: "Database is not configured" });
  const { data, error } = await supabase.from("student_groups")
    .select("id,group_code,display_name,course_id,courses(course_number,faculty_id,faculties(name,slug))")
    .order("display_name");
  if (error) return res.status(500).json({ error: "Unable to load groups" });
  res.json({ data });
});

function getWeekType(dateString) {
  // 12–18 Oct 2026 is week B (odd); 19–25 Oct is week A (even).
  const date = new Date(dateString + "T12:00:00Z");
  const monday = new Date(date);
  const day = monday.getUTCDay() || 7;
  monday.setUTCDate(monday.getUTCDate() - day + 1);
  const anchor = new Date("2026-10-19T12:00:00Z");
  const weeks = Math.round((monday - anchor) / (7 * 24 * 60 * 60 * 1000));
  return ((weeks % 2) + 2) % 2 === 0 ? "A" : "B";
}

function validDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

app.get("/api/schedule", async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "Database is not configured" });
  const groupId = Number(req.query.group_id);
  const dateString = String(req.query.date || "");
  if (!Number.isSafeInteger(groupId) || groupId < 1) {
    return res.status(400).json({ error: "group_id must be a positive integer" });
  }
  if (!validDateString(dateString)) {
    return res.status(400).json({ error: "date must be a valid YYYY-MM-DD date" });
  }

  const date = new Date(dateString + "T12:00:00Z");
  const weekday = date.getUTCDay() || 7;
  const weekType = getWeekType(dateString);
  const fields = "id,group_id,entry_kind,weekday,week_type,schedule_date,starts_at,ends_at,subject,teacher,room,lesson_type,notes,excluded_dates,valid_from,valid_to";

  const { data: overrides, error: overrideError } = await supabase.from("schedule_entries")
    .select(fields).eq("group_id", groupId).eq("entry_kind", "date_override")
    .eq("schedule_date", dateString).order("starts_at");
  if (overrideError) return res.status(500).json({ error: "Unable to load schedule" });

  const { data: recurring, error: recurringError } = await supabase.from("schedule_entries")
    .select(fields).eq("group_id", groupId).eq("entry_kind", "recurring")
    .eq("weekday", weekday).or(`week_type.is.null,week_type.eq.${weekType}`)
    .order("starts_at");
  if (recurringError) return res.status(500).json({ error: "Unable to load schedule" });

  const recurringForDate = (recurring || []).filter(item =>
    (!item.valid_from || item.valid_from <= dateString) &&
    (!item.valid_to || item.valid_to >= dateString) &&
    !(item.excluded_dates || []).includes(dateString)
  );
  const datedOverrides = overrides || [];
  // A date-specific lesson replaces the recurring lesson in the same time slot,
  // even when the subject differs or the recurring lesson has no week type.
  const overrideSlots = new Set(datedOverrides.map(item =>
    item.starts_at + "|" + item.ends_at
  ));
  let data = [
    ...recurringForDate.filter(item =>
      !overrideSlots.has(item.starts_at + "|" + item.ends_at)
    ),
    ...datedOverrides
  ];

  // A "Курсовой час" occupies its time slot unless an explicit dated override
  // exists for that slot; dated overrides are authoritative for their date.
  const courseHourSlots = new Set(data
    .filter(item => item.subject === "Курсовой час" && item.entry_kind !== "date_override")
    .map(item => item.starts_at + "|" + item.ends_at));
  data = data.filter(item =>
    item.entry_kind === "date_override" ||
    item.subject === "Курсовой час" ||
    !courseHourSlots.has(item.starts_at + "|" + item.ends_at)
  );

  // Avoid duplicate display when source records are identical.
  const seen = new Set();
  data = data.filter(item => {
    const key = [item.starts_at, item.ends_at, item.subject, item.lesson_type, item.teacher, item.room].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  res.json({ date: dateString, week_type: weekType, data });
});


function dateToDM(value) {
  if (!value) return "";
  const parts = String(value).slice(0, 10).split("-");
  return parts.length === 3 ? parts[2] + "." + parts[1] : "";
}

function toMiniAppLesson(row) {
  const lesson = {
    group: row.group_code,
    start: String(row.starts_at || "").slice(0, 5),
    end: String(row.ends_at || "").slice(0, 5),
    title: row.subject || "",
    type: row.lesson_type || "Занятие",
    teacher: row.teacher || "",
    room: row.room || "Уточняется накануне",
  };

  if (row.entry_kind === "date_override" && row.schedule_date) {
    lesson.day = (new Date(row.schedule_date + "T12:00:00Z").getUTCDay() + 6) % 7;
    lesson.dates = [dateToDM(row.schedule_date)];
  } else {
    lesson.day = Number(row.weekday) - 1;
    if (row.week_type === "A") lesson.parity = "чётная неделя";
    if (row.week_type === "B") lesson.parity = "нечётная неделя";
  }

  if (row.valid_from) lesson.dates_from = dateToDM(row.valid_from);
  if (row.valid_to) lesson.dates_until = dateToDM(row.valid_to);
  if (Array.isArray(row.excluded_dates) && row.excluded_dates.length) {
    lesson.excluded_dates = row.excluded_dates.map(dateToDM).filter(Boolean);
  }
  if (row.notes) lesson.note = row.notes;
  return lesson;
}


async function exportCourseSchedule(courseNumber, res) {
  if (!supabase) return res.status(503).json({ error: "Database is not configured" });

  const { data: groups, error: groupsError } = await supabase
    .from("student_groups")
    .select("id,group_code,display_name,courses!inner(course_number)")
    .eq("courses.course_number", courseNumber)
    .order("group_code");
  if (groupsError) return res.status(500).json({ error: "Unable to load course groups" });
  if (!groups || groups.length === 0) {
    return res.status(404).json({ error: "No groups found for course " + courseNumber });
  }

  const ids = groups.map(group => group.id);
  const { data: entries, error: entriesError } = await supabase
    .from("schedule_entries")
    .select("group_id,entry_kind,weekday,week_type,schedule_date,starts_at,ends_at,subject,teacher,room,lesson_type,notes,excluded_dates,valid_from,valid_to")
    .in("group_id", ids)
    .order("starts_at");
  if (entriesError) return res.status(500).json({ error: "Unable to load course schedule" });

  const groupById = new Map(groups.map(group => [group.id, group]));
  const lessons = (entries || []).map(row => toMiniAppLesson({
    ...row,
    group_code: groupById.get(row.group_id)?.group_code
  }));

  res.setHeader("Cache-Control", "no-store");
  return res.json({
    _status: "CONNECTED_TO_SUPABASE",
    _source: "Supabase schedule_entries",
    _course: courseNumber,
    _groups: groups.map(group => group.group_code),
    _rules: {
      weekA: "чётная неделя",
      weekB: "нечётная неделя",
      anchor: "12–18.10.2026 — неделя Б; 19–25.10.2026 — неделя А"
    },
    lessons
  });
}

app.get("/api/course1-schedule", (_req, res) => exportCourseSchedule(1, res));
app.get("/api/course2-schedule", (_req, res) => exportCourseSchedule(2, res));
app.get("/api/course3-schedule", (_req, res) => exportCourseSchedule(3, res));

// Compatibility export for the existing course-4 adapter.
// The Mini App can prefer the database while retaining its local JSON fallback.
app.get("/api/course4-schedule", async (_req, res) => {
  if (!supabase) return res.status(503).json({ error: "Database is not configured" });

  const { data: groups, error: groupsError } = await supabase
    .from("student_groups")
    .select("id,group_code,display_name,courses!inner(course_number)")
    .eq("courses.course_number", 4)
    .order("group_code");
  if (groupsError) return res.status(500).json({ error: "Unable to load course groups" });
  if (!groups || groups.length === 0) {
    return res.status(404).json({ error: "No course-4 groups found" });
  }

  const ids = groups.map(group => group.id);
  const { data: entries, error: entriesError } = await supabase
    .from("schedule_entries")
    .select("group_id,entry_kind,weekday,week_type,schedule_date,starts_at,ends_at,subject,teacher,room,lesson_type,notes,excluded_dates,valid_from,valid_to")
    .in("group_id", ids)
    .order("starts_at");
  if (entriesError) return res.status(500).json({ error: "Unable to load course schedule" });

  const groupById = new Map(groups.map(group => [group.id, group]));
  const lessons = (entries || []).map(row => ({
    ...toMiniAppLesson({
      ...row,
      group_code: groupById.get(row.group_id)?.group_code
    })
  }));

  res.setHeader("Cache-Control", "no-store");
  res.json({
    _status: "CONNECTED_TO_SUPABASE",
    _source: "Supabase schedule_entries",
    _groups: groups.map(group => group.group_code),
    _rules: {
      weekA: "чётная неделя",
      weekB: "нечётная неделя",
      anchor: "12–18.10.2026 — неделя Б; 19–25.10.2026 — неделя А"
    },
    lessons
  });
});


const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
const OWNER_TELEGRAM_ID = String(process.env.OWNER_TELEGRAM_ID || "").trim();
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const MINI_APP_URL = "https://zastroblox-cmd.github.io/rta-schedule-miniapp/";

async function telegramApi(method, payload) {
  if (!TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    throw new Error(`Telegram ${method} failed: ${result.description || response.status}`);
  }
  return result;
}

app.post("/telegram/webhook", async (req, res) => {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_WEBHOOK_SECRET) {
    return res.status(503).json({ error: "Telegram webhook is not configured" });
  }
  if (req.get("X-Telegram-Bot-Api-Secret-Token") !== TELEGRAM_WEBHOOK_SECRET) {
    return res.sendStatus(403);
  }

  // Acknowledge the update immediately; process only the commands supported by this bot.
  res.sendStatus(200);
  const message = req.body && req.body.message;
  if (!message || !message.chat || typeof message.text !== "string") return;
  const command = message.text.trim().split(/\s+/, 1)[0].split("@", 1)[0];
  if (command !== "/start" && command !== "/help") return;

  const greeting = command === "/start"
    ? "🎓 Добро пожаловать! Это расписание РТА. Нажмите кнопку ниже, чтобы открыть расписание."
    : "📅 Откройте расписание кнопкой ниже.";
  try {
    await telegramApi("sendMessage", {
      chat_id: message.chat.id,
      text: greeting,
      reply_markup: {
        inline_keyboard: [[{
          text: "📅 Открыть расписание",
          web_app: { url: MINI_APP_URL }
        }]]
      }
    });
  } catch (error) {
    console.error("Unable to answer Telegram update:", error.message);
  }
});

async function configureTelegramWebhook() {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_WEBHOOK_SECRET) {
    console.log("Telegram webhook is not configured: set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET");
    return;
  }
  try {
    await telegramApi("setWebhook", {
      url: "https://rta-schedule-api.onrender.com/telegram/webhook",
      secret_token: TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ["message"],
      drop_pending_updates: false
    });
    await telegramApi("setChatMenuButton", {
      menu_button: {
        type: "web_app",
        text: "📅 Расписание",
        web_app: { url: MINI_APP_URL }
      }
    });
    console.log("Telegram webhook and persistent Mini App menu button configured");
  } catch (error) {
    console.error("Telegram webhook setup failed:", error.message);
  }
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`RTA schedule API listening on port ${PORT}`);
  void configureTelegramWebhook();
});