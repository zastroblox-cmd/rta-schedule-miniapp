const express = require("express");
const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.disable("x-powered-by");
// Render sits behind one trusted reverse proxy; use its client IP for login throttling.
app.set("trust proxy", 1);
app.use(express.json({ limit: "32kb" }));

const PORT = Number(process.env.PORT || 3000);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

// Small security defaults that do not interfere with Telegram's embedded Mini App.
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

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

function verifyTelegramInitData(initData, requireOwner = true) {
  if (!TELEGRAM_BOT_TOKEN || (requireOwner && !OWNER_TELEGRAM_ID) || typeof initData !== "string" || !initData) return null;
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
  if (!user || !/^[0-9]{1,24}$/.test(String(user.id)) || (requireOwner && String(user.id) !== OWNER_TELEGRAM_ID)) return null;
  return { id: String(user.id), first_name: String(user.first_name || "") };
}

app.post("/api/analytics/track", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const user = verifyTelegramInitData(req.body && req.body.initData, false);
  if (!user) return res.status(403).json({ error: "Valid Telegram Mini App data required" });
  if (!supabase || !ANALYTICS_SECRET) return res.status(503).json({ error: "Analytics is not configured" });
  const { error } = await supabase.rpc("track_app_user", {
    p_user_id: user.id,
    p_secret: ANALYTICS_SECRET
  });
  if (error) {
    console.error("Analytics tracking failed:", error.message);
    return res.status(503).json({ error: "Unable to record activity" });
  }
  return res.json({ ok: true });
});

app.post("/api/owner/analytics", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const owner = verifyTelegramInitData(req.body && req.body.initData);
  if (!owner) return res.status(403).json({ authorized: false, error: "Owner access denied" });
  if (!supabase || !ANALYTICS_SECRET) return res.status(503).json({ error: "Analytics is not configured" });
  const { data, error } = await supabase.rpc("get_app_user_stats", { p_secret: ANALYTICS_SECRET });
  if (error) {
    console.error("Analytics stats query failed:", error.message);
    return res.status(503).json({ error: "Unable to load analytics" });
  }
  return res.json({ authorized: true, ...data });
});

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
    .select("id,group_code,display_name,course_id,courses(course_number,faculty_id,direction,faculties(name,slug))")
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

  // Both reads are independent; run them concurrently to reduce schedule-load latency.
  const [overrideResult, recurringResult] = await Promise.all([
    supabase.from("schedule_entries").select(fields)
      .eq("group_id", groupId).eq("entry_kind", "date_override")
      .eq("schedule_date", dateString).order("starts_at"),
    supabase.from("schedule_entries").select(fields)
      .eq("group_id", groupId).eq("entry_kind", "recurring")
      .eq("weekday", weekday).or(`week_type.is.null,week_type.eq.${weekType}`)
      .order("starts_at")
  ]);
  if (overrideResult.error || recurringResult.error) {
    console.error("Schedule query failed:", overrideResult.error?.message || recurringResult.error?.message);
    return res.status(500).json({ error: "Unable to load schedule" });
  }
  const overrides = overrideResult.data || [];
  const recurring = recurringResult.data || [];

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


// Public, read-only overlay for changes made by class representatives.
// The base timetable can stay on its verified local source while dated edits
// from Supabase are reflected immediately in the regular schedule.
app.get("/api/schedule-changes", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!supabase) return res.status(503).json({ error: "Database is not configured" });
  const groupCode = String(req.query.group_code || "").trim();
  const dateString = String(req.query.date || "");
  if (!groupCode || groupCode.length > 80 || !validDateString(dateString)) {
    return res.status(400).json({ error: "group_code and a valid date are required" });
  }
  const { data: group, error: groupError } = await supabase
    .from("student_groups").select("id,group_code").eq("group_code", groupCode).maybeSingle();
  if (groupError) return res.status(500).json({ error: "Unable to resolve group" });
  if (!group) return res.status(404).json({ error: "Group not found" });
  const date = new Date(dateString + "T12:00:00Z");
  const weekday = date.getUTCDay() || 7;
  const [overrideResult, recurringResult] = await Promise.all([
    supabase.from("schedule_entries")
      .select("id,starts_at,ends_at,subject,teacher,room,lesson_type,notes,entry_kind,schedule_date")
      .eq("group_id", group.id).eq("entry_kind", "date_override")
      .eq("schedule_date", dateString).order("starts_at"),
    supabase.from("schedule_entries")
      .select("id,starts_at,ends_at,excluded_dates,valid_from,valid_to,week_type")
      .eq("group_id", group.id).eq("entry_kind", "recurring").eq("weekday", weekday)
      .or("week_type.is.null,week_type.eq." + getWeekType(dateString)).order("starts_at")
  ]);
  if (overrideResult.error || recurringResult.error) {
    return res.status(500).json({ error: "Unable to load schedule changes" });
  }
  const excluded = (recurringResult.data || []).filter(row =>
    (!row.valid_from || row.valid_from <= dateString) &&
    (!row.valid_to || row.valid_to >= dateString) &&
    (row.excluded_dates || []).includes(dateString)
  ).map(row => ({ starts_at: row.starts_at, ends_at: row.ends_at }));
  return res.json({
    group_code: group.group_code,
    date: dateString,
    excluded,
    overrides: overrideResult.data || []
  });
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
    type: row.lesson_type || "Тип уточняется",
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


async function exportCourseSchedule(courseNumber, res, facultySlug = "law", direction = null) {
  if (!supabase) return res.status(503).json({ error: "Database is not configured" });

  // Resolve faculty -> course -> groups in separate queries. Nested PostgREST
  // filters on courses.faculties.slug can silently yield no groups in some schemas.
  const { data: faculty, error: facultyError } = await supabase
    .from("faculties")
    .select("id,slug")
    .eq("slug", facultySlug)
    .maybeSingle();
  if (facultyError) {
    console.error("Schedule API faculty lookup failed:", facultyError.message);
    return res.status(500).json({ error: "Unable to load faculty", detail: facultyError.message });
  }
  if (!faculty) return res.status(404).json({ error: "Faculty not found: " + facultySlug });

  let coursesQuery = supabase
    .from("courses")
    .select("id,course_number,faculty_id,direction")
    .eq("faculty_id", faculty.id);
  if (courseNumber != null) coursesQuery = coursesQuery.eq("course_number", courseNumber);
  if (Array.isArray(direction)) coursesQuery = coursesQuery.in("direction", direction);
  else if (direction) coursesQuery = coursesQuery.eq("direction", direction);
  const { data: courses, error: coursesError } = await coursesQuery;
  if (coursesError) {
    console.error("Schedule API course lookup failed:", coursesError.message);
    return res.status(500).json({ error: "Unable to load course", detail: coursesError.message });
  }
  if (!courses || courses.length === 0) {
    return res.status(404).json({ error: "No course found for faculty " + facultySlug + (courseNumber == null ? "" : ", course " + courseNumber) });
  }

  const courseIds = courses.map(course => course.id);
  const { data: groups, error: groupsError } = await supabase
    .from("student_groups")
    .select("id,group_code,display_name,course_id")
    .in("course_id", courseIds)
    .order("group_code");
  if (groupsError) {
    console.error("Schedule API group lookup failed:", groupsError.message);
    return res.status(500).json({ error: "Unable to load course groups", detail: groupsError.message });
  }
  if (!groups || groups.length === 0) {
    return res.status(404).json({ error: "No groups found for faculty " + facultySlug + ", course " + courseNumber });
  }

  const ids = groups.map(group => group.id);
  const { data: entries, error: entriesError } = await supabase
    .from("schedule_entries")
    .select("group_id,entry_kind,weekday,week_type,schedule_date,starts_at,ends_at,subject,teacher,room,lesson_type,notes,excluded_dates,valid_from,valid_to")
    .in("group_id", ids)
    .order("starts_at");
  if (entriesError) return res.status(500).json({ error: "Unable to load course schedule" });

  const groupById = new Map(groups.map(group => [group.id, group]));
  let lessons = (entries || []).map(row => toMiniAppLesson({
    ...row,
    group_code: groupById.get(row.group_id)?.group_code
  }));

  // Economics adapter uses explicit A/B week labels, unlike the legacy law adapter.
  if (facultySlug === "economics") {
    lessons = lessons.map(lesson => {
      const result = { ...lesson };
      if (result.parity === "нечётная неделя") result.week = "Б";
      if (result.parity === "чётная неделя") result.week = "А";
      delete result.parity;
      return result;
    });
  }

  // Расписание меняется редко; короткий HTTP-кэш снижает повторные запросы к Supabase.
  // Обновления расписания появятся после истечения кэша максимум через минуту.
  res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
  return res.json({
    _status: "CONNECTED_TO_SUPABASE",
    _source: "Supabase schedule_entries",
    _course: courseNumber == null ? "all" : courseNumber,
    _groups: groups.map(group => group.group_code),
    _rules: {
      weekA: "чётная неделя",
      weekB: "нечётная неделя",
      anchor: "12–18.10.2026 — неделя Б; 19–25.10.2026 — неделя А"
    },
    lessons
  });
}

app.get("/api/course1-schedule", (_req, res) => exportCourseSchedule(1, res, "law"));
app.get("/api/course2-schedule", (_req, res) => exportCourseSchedule(2, res, "law"));
app.get("/api/course3-schedule", (_req, res) => exportCourseSchedule(3, res, "law"));
app.get("/api/course4-schedule", (_req, res) => exportCourseSchedule(4, res, "law"));

app.get("/api/economics/course1-schedule", (_req, res) => exportCourseSchedule(1, res, "economics", "economics"));
app.get("/api/economics/course2-schedule", (_req, res) => exportCourseSchedule(2, res, "economics", "economics"));
app.get("/api/economics/course3-schedule", (_req, res) => exportCourseSchedule(3, res, "economics", "economics"));
app.get("/api/economics/course4-schedule", (_req, res) => exportCourseSchedule(4, res, "economics", "economics"));

app.get("/api/economics/applied-informatics/course1-schedule", (_req, res) => exportCourseSchedule(1, res, "economics", "applied-informatics"));
app.get("/api/economics/applied-informatics/course2-schedule", (_req, res) => exportCourseSchedule(2, res, "economics", "applied-informatics"));
app.get("/api/economics/applied-informatics/course3-schedule", (_req, res) => exportCourseSchedule(3, res, "economics", "applied-informatics"));
app.get("/api/economics/applied-informatics/course4-schedule", (_req, res) => exportCourseSchedule(4, res, "economics", "applied-informatics"));

app.get("/api/economics/management/course1-schedule", (_req, res) => exportCourseSchedule(1, res, "economics", "management"));
app.get("/api/economics/management/course2-schedule", (_req, res) => exportCourseSchedule(2, res, "economics", "management"));
app.get("/api/economics/management/course3-schedule", (_req, res) => exportCourseSchedule(3, res, "economics", "management"));
app.get("/api/economics/management/course4-schedule", (_req, res) => exportCourseSchedule(4, res, "economics", "management"));
app.get("/api/economics/all-schedules", (_req, res) => exportCourseSchedule(null, res, "economics", ["economics", "applied-informatics", "management"]));

// Customs Affairs faculty: five separate courses.
app.get("/api/customs/course1-schedule", (_req, res) => exportCourseSchedule(1, res, "customs", "customs"));
app.get("/api/customs/course2-schedule", (_req, res) => exportCourseSchedule(2, res, "customs", "customs"));
app.get("/api/customs/course3-schedule", (_req, res) => exportCourseSchedule(3, res, "customs", "customs"));
app.get("/api/customs/course4-schedule", (_req, res) => exportCourseSchedule(4, res, "customs", "customs"));
app.get("/api/customs/course5-schedule", (_req, res) => exportCourseSchedule(5, res, "customs", "customs"));
app.get("/api/customs/all-schedules", (_req, res) => exportCourseSchedule(null, res, "customs", "customs"));

// Course 4 uses the same faculty-scoped database export as courses 1–3.

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
const OWNER_TELEGRAM_ID = String(process.env.OWNER_TELEGRAM_ID || "").trim();
const ANALYTICS_SECRET = String(process.env.ANALYTICS_SECRET || "");
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


const REPRESENTATIVE_API_SECRET = String(process.env.REPRESENTATIVE_API_SECRET || "");
const REPRESENTATIVE_SESSION_SECRET = String(process.env.REPRESENTATIVE_SESSION_SECRET || "");
let REPRESENTATIVE_PASSWORDS = {};
try { REPRESENTATIVE_PASSWORDS = JSON.parse(process.env.REPRESENTATIVE_PASSWORDS_JSON || "{}"); } catch { REPRESENTATIVE_PASSWORDS = {}; }
const representativeAttempts = new Map();

function signRepresentativeToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", REPRESENTATIVE_SESSION_SECRET).update(body).digest("base64url");
  return body + "." + sig;
}
function verifyRepresentativeToken(req) {
  if (!REPRESENTATIVE_SESSION_SECRET) return null;
  const raw = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const parts = raw.split(".");
  if (parts.length !== 2) return null;
  const expected = crypto.createHmac("sha256", REPRESENTATIVE_SESSION_SECRET).update(parts[0]).digest();
  let supplied;
  try { supplied = Buffer.from(parts[1], "base64url"); } catch { return null; }
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch { return null; }
  if (!payload || !Number.isFinite(payload.exp) || payload.exp < Date.now()) return null;
  return payload;
}
function safeStringEqual(a, b) {
  const aa = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb);
}
async function getRepresentativeAccess(req, groupId) {
  const token = verifyRepresentativeToken(req);
  if (!token) return { ok: false, status: 401, error: "Сессия старосты истекла. Войди снова." };
  if (token.role === "owner") return { ok: true, actor: "Владелец", role: "owner" };
  if (token.role !== "representative" || Number(token.groupId) !== Number(groupId)) {
    return { ok: false, status: 403, error: "Этот пароль не даёт доступ к выбранной группе." };
  }
  if (!supabase || !REPRESENTATIVE_API_SECRET) return { ok: false, status: 503, error: "Не удалось проверить актуальность доступа." };
  const { data: accessRow, error } = await supabase.rpc("representative_access_get", { p_secret: REPRESENTATIVE_API_SECRET, p_group_id: groupId });
  if (error) return { ok: false, status: 503, error: "Не удалось проверить актуальность доступа." };
  if (accessRow && accessRow.enabled === false) return { ok: false, status: 403, error: "Доступ старосты отключён владельцем." };
  if (accessRow && accessRow.updated_at && (!Number.isFinite(Number(token.iat)) || Number(token.iat) < new Date(accessRow.updated_at).getTime())) {
    return { ok: false, status: 401, error: "Настройки доступа изменились. Войди заново с новым паролем." };
  }
  return { ok: true, actor: "Староста " + String(token.groupCode || ""), role: "representative" };
}

function ownerTokenFromRequest(req) {
  const token = verifyRepresentativeToken(req);
  return token && token.role === "owner" ? token : null;
}

app.get("/api/owner/representative-access", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!ownerTokenFromRequest(req)) return res.status(403).json({ error: "Доступ только владельцу." });
  if (!supabase || !REPRESENTATIVE_API_SECRET) return res.status(503).json({ error: "База данных не настроена." });
  const { data, error } = await supabase.rpc("representative_access_list", { p_secret: REPRESENTATIVE_API_SECRET });
  if (error || !Array.isArray(data)) {
    console.error("Owner representative access list failed:", error && error.message);
    return res.status(503).json({ error: "Не удалось загрузить настройки доступа старост. Проверь миграцию базы." });
  }
  return res.json({ data });
});

app.post("/api/owner/representative-access", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!ownerTokenFromRequest(req)) return res.status(403).json({ error: "Доступ только владельцу." });
  if (!supabase || !REPRESENTATIVE_API_SECRET) return res.status(503).json({ error: "База данных не настроена." });
  const groupId = Number(req.body && req.body.group_id);
  const enabled = req.body && req.body.enabled;
  const password = req.body && req.body.password != null ? String(req.body.password) : "";
  if (!Number.isSafeInteger(groupId) || groupId < 1 || typeof enabled !== "boolean") return res.status(400).json({ error: "Укажи группу и состояние доступа." });
  if (password && (password.length < 10 || password.length > 128)) return res.status(400).json({ error: "Пароль должен содержать от 10 до 128 символов." });
  const passwordHash = password ? crypto.createHash("sha256").update(password, "utf8").digest("hex") : null;
  const { data, error } = await supabase.rpc("representative_access_set", {
    p_secret: REPRESENTATIVE_API_SECRET, p_group_id: groupId, p_password_hash: passwordHash, p_enabled: enabled
  });
  if (error || !data) {
    console.error("Owner representative access update failed:", error && error.message);
    return res.status(503).json({ error: "Не удалось сохранить настройки доступа." });
  }
  return res.json({ ok: true, group_code: data.group_code, enabled: data.enabled, password_changed: Boolean(password) });
});

app.post("/api/representative/login", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!supabase || !REPRESENTATIVE_SESSION_SECRET || !REPRESENTATIVE_API_SECRET) {
    return res.status(503).json({ error: "Режим старосты ещё не настроен на сервере." });
  }
  const ip = String(req.ip || req.socket.remoteAddress || "unknown");
  const now = Date.now();
  // Bound memory use if many distinct addresses hit the login endpoint.
  if (representativeAttempts.size > 10000) {
    for (const [key, value] of representativeAttempts) {
      if (value.until <= now && value.count === 0) representativeAttempts.delete(key);
    }
    while (representativeAttempts.size > 10000) representativeAttempts.delete(representativeAttempts.keys().next().value);
  }
  const attempt = representativeAttempts.get(ip) || { count: 0, until: 0 };
  if (attempt.until > now) return res.status(429).json({ error: "Слишком много попыток. Попробуй через несколько минут." });
  if (req.body && req.body.initData) {
    const owner = verifyTelegramInitData(req.body.initData);
    if (owner) return res.json({ token: signRepresentativeToken({ role: "owner", exp: now + 8 * 60 * 60 * 1000 }), role: "owner", expiresIn: 28800 });
  }
  const groupCode = String(req.body && req.body.group_code || "").trim();
  const password = String(req.body && req.body.password || "");
  if (!groupCode || !password) return res.status(400).json({ error: "Укажи группу и пароль." });
  const { data: group, error: groupError } = await supabase.from("student_groups").select("id,group_code").eq("group_code", groupCode).maybeSingle();
  if (groupError || !group) return res.status(403).json({ error: "Неверный пароль для этой группы." });
  const { data: accessRow, error: accessError } = await supabase.rpc("representative_access_get", { p_secret: REPRESENTATIVE_API_SECRET, p_group_id: group.id });
  if (accessError) return res.status(503).json({ error: "Не удалось проверить доступ старосты." });
  if (accessRow && accessRow.enabled === false) return res.status(403).json({ error: "Доступ старосты для этой группы отключён владельцем." });
  const storedHash = accessRow && accessRow.password_hash;
  const validPassword = storedHash
    ? safeStringEqual(crypto.createHash("sha256").update(password, "utf8").digest("hex"), storedHash)
    : safeStringEqual(password, REPRESENTATIVE_PASSWORDS[groupCode]);
  if (!validPassword) {
    attempt.count += 1;
    if (attempt.count >= 6) { attempt.count = 0; attempt.until = now + 10 * 60 * 1000; }
    representativeAttempts.set(ip, attempt);
    return res.status(403).json({ error: "Неверный пароль для этой группы." });
  }
  representativeAttempts.delete(ip);
  return res.json({
    token: signRepresentativeToken({ role: "representative", groupId: group.id, groupCode: group.group_code, iat: now, exp: now + 8 * 60 * 60 * 1000 }),
    role: "representative", groupId: group.id, groupCode: group.group_code, expiresIn: 28800
  });
});

app.get("/api/representative/schedule", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!supabase) return res.status(503).json({ error: "База данных не настроена." });
  const groupId = Number(req.query.group_id);
  const dateString = String(req.query.date || "");
  const access = await getRepresentativeAccess(req, groupId);
  if (!access.ok) return res.status(access.status).json({ error: access.error });
  if (!Number.isSafeInteger(groupId) || groupId < 1 || !validDateString(dateString)) return res.status(400).json({ error: "Неверная группа или дата." });
  const date = new Date(dateString + "T12:00:00Z");
  const weekday = date.getUTCDay() || 7;
  const weekType = getWeekType(dateString);
  const fields = "id,group_id,entry_kind,weekday,week_type,schedule_date,starts_at,ends_at,subject,teacher,room,lesson_type,notes,excluded_dates,valid_from,valid_to";
  const [overridesResult, recurringResult] = await Promise.all([
    supabase.from("schedule_entries").select(fields).eq("group_id", groupId).eq("entry_kind", "date_override").eq("schedule_date", dateString).order("starts_at"),
    supabase.from("schedule_entries").select(fields).eq("group_id", groupId).eq("entry_kind", "recurring").eq("weekday", weekday).or("week_type.is.null,week_type.eq." + weekType).order("starts_at")
  ]);
  if (overridesResult.error || recurringResult.error) return res.status(503).json({ error: "Не удалось загрузить пары." });
  const overrides = overridesResult.data || [];
  const overrideSlots = new Set(overrides.map(x => x.starts_at + "|" + x.ends_at));
  const recurring = (recurringResult.data || []).filter(x => (!x.valid_from || x.valid_from <= dateString) && (!x.valid_to || x.valid_to >= dateString) && !(x.excluded_dates || []).includes(dateString) && !overrideSlots.has(x.starts_at + "|" + x.ends_at));
  return res.json({ data: [...recurring, ...overrides].sort((a,b) => String(a.starts_at).localeCompare(String(b.starts_at))), date: dateString, group_id: groupId, group_code: access.role === "representative" ? verifyRepresentativeToken(req).groupCode : undefined });
});

app.post("/api/representative/change", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!supabase || !REPRESENTATIVE_API_SECRET) return res.status(503).json({ error: "Редактирование не настроено." });
  const body = req.body || {};
  const groupId = Number(body.group_id);
  const access = await getRepresentativeAccess(req, groupId);
  if (!access.ok) return res.status(access.status).json({ error: access.error });
  if (!validDateString(String(body.entry && body.entry.schedule_date || ""))) return res.status(400).json({ error: "Укажи корректную дату." });
  const { data, error } = await supabase.rpc("representative_apply_change", {
    p_secret: REPRESENTATIVE_API_SECRET,
    p_action: String(body.action || "save_override"),
    p_group_id: groupId,
    p_entry_id: body.entry_id == null ? null : Number(body.entry_id),
    p_entry: body.entry || {},
    p_actor: access.actor
  });
  if (error) {
    console.error("Representative change failed:", error.message);
    return res.status(400).json({ error: "Не удалось сохранить изменение. Проверь поля и попробуй ещё раз." });
  }
  return res.json({ ok: true, result: data });
});

app.get("/api/representative/history", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!supabase || !REPRESENTATIVE_API_SECRET) return res.status(503).json({ error: "История недоступна." });
  const groupId = Number(req.query.group_id);
  const access = await getRepresentativeAccess(req, groupId);
  if (!access.ok) return res.status(access.status).json({ error: access.error });
  if (!Number.isSafeInteger(groupId) || groupId < 1) return res.status(400).json({ error: "Неверная группа." });
  const { data, error } = await supabase.rpc("representative_get_history", { p_secret: REPRESENTATIVE_API_SECRET, p_group_id: groupId, p_limit: 30 });
  if (error) {
    console.error("Representative history failed:", error.message);
    return res.status(503).json({ error: "Не удалось загрузить историю." });
  }
  return res.json({ data });
});


app.post("/api/representative/restore", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!supabase || !REPRESENTATIVE_API_SECRET) return res.status(503).json({ error: "Восстановление недоступно." });
  const body = req.body || {};
  const groupId = Number(body.group_id);
  const historyId = Number(body.history_id);
  const access = await getRepresentativeAccess(req, groupId);
  if (!access.ok) return res.status(access.status).json({ error: access.error });
  if (!Number.isSafeInteger(groupId) || groupId < 1 || !Number.isSafeInteger(historyId) || historyId < 1) return res.status(400).json({ error: "Неверная запись истории." });
  const { data, error } = await supabase.rpc("representative_restore_history", {
    p_secret: REPRESENTATIVE_API_SECRET,
    p_group_id: groupId,
    p_history_id: historyId,
    p_actor: access.actor
  });
  if (error) {
    console.error("Representative restore failed:", error.message);
    return res.status(400).json({ error: "Не удалось отменить изменение. Возможно, запись уже изменена." });
  }
  return res.json({ ok: true, result: data });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`RTA schedule API listening on port ${PORT}`);
  void configureTelegramWebhook();
});