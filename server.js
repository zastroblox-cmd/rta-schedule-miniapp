const express = require("express");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const scryptAsync = promisify(crypto.scrypt);
const { createClient } = require("@supabase/supabase-js");
const { getWeekType, validDateString } = require("./lib/schedule-utils");
const { dispatchReminders } = require("./lib/reminder-dispatch");
const { hasScheduleData } = require("./lib/reminders");
const REMINDER_CRON_SECRET = String(process.env.REMINDER_CRON_SECRET || "");
const REMINDER_SCHEDULER_ENABLED = process.env.REMINDER_SCHEDULER_ENABLED === "true";

const app = express();
app.disable("x-powered-by");
// Render sits behind one trusted reverse proxy; use its client IP for login throttling.
app.set("trust proxy", 1);
app.use(express.json({ limit: "32kb" }));

const PORT = Number(process.env.PORT || 3000);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
// Privileged SECURITY DEFINER RPCs must use a server-only Supabase key.
// Accept common variable names, but never fall back to a public/publishable key.
const SUPABASE_SERVER_KEY = process.env.SUPABASE_SERVER_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_SECRET_KEY;

const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;
const supabaseRpc = SUPABASE_URL && SUPABASE_SERVER_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVER_KEY, {
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
  if (!supabase || !supabaseRpc || !ANALYTICS_SECRET) return res.status(503).json({ error: "Analytics is not configured" });
  const { error } = await supabaseRpc.rpc("track_app_user", {
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
  if (!supabase || !supabaseRpc || !ANALYTICS_SECRET) return res.status(503).json({ error: "Analytics is not configured" });
  const { data, error } = await supabaseRpc.rpc("get_app_user_stats", { p_secret: ANALYTICS_SECRET });
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
  res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
  if (!supabase) return res.status(503).json({ error: "Database is not configured" });
  const { data, error } = await supabase.from("faculties")
    .select("id,name,slug").order("name");
  if (error) return res.status(500).json({ error: "Unable to load faculties" });
  res.json({ data });
});

app.get("/api/groups", async (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
  if (!supabase) return res.status(503).json({ error: "Database is not configured" });
  const { data, error } = await supabase.from("student_groups")
    .select("id,group_code,display_name,course_id,courses(course_number,faculty_id,direction,faculties(name,slug))")
    .order("display_name");
  if (error) return res.status(500).json({ error: "Unable to load groups" });
  res.json({ data });
});

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
  const fields = "id,group_id,entry_kind,weekday,week_type,schedule_date,starts_at,ends_at,subject,teacher,room,lesson_type,notes,excluded_dates,valid_from,valid_to,source_label";

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
// Student-submitted schedule change reports. Reports are aggregated publicly;
 // raw reporter identifiers never leave the server and are stored only as keyed hashes.
const { SCHEDULE_REPORT_TYPES, isValidLessonTime, summarizeScheduleReports, isCancellationAlertThresholdReached } = require("./lib/schedule-reports");

app.get("/api/schedule-reports", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!supabase || !supabaseRpc) return res.status(503).json({ error: "Reports are not configured" });
  const groupCode = String(req.query.group_code || "").trim();
  const dateString = String(req.query.date || "");
  if (!groupCode || groupCode.length > 80 || !validDateString(dateString)) {
    return res.status(400).json({ error: "group_code and a valid date are required" });
  }
  const { data: group, error: groupError } = await supabase
    .from("student_groups").select("id").eq("group_code", groupCode).maybeSingle();
  if (groupError) return res.status(500).json({ error: "Unable to resolve group" });
  if (!group) return res.status(404).json({ error: "Group not found" });
  const { data, error } = await supabaseRpc.from("schedule_change_reports")
    .select("starts_at,report_type,updated_at")
    .eq("group_id", group.id).eq("schedule_date", dateString)
    .order("starts_at").limit(500);
  if (error) {
    console.error("Schedule report summary failed:", error.message);
    return res.status(503).json({ error: "Unable to load reports" });
  }
  return res.json({ date: dateString, data: summarizeScheduleReports(data) });
});

async function maybeSendScheduleCancellationAlert({ groupId, groupCode, dateString, startsAt, subject, summary }) {
  if (!isCancellationAlertThresholdReached(summary)) return;
  if (!TELEGRAM_BOT_TOKEN || !OWNER_TELEGRAM_ID || !supabaseRpc) {
    console.error("Schedule cancellation alert not sent: Telegram owner notification is not configured");
    return;
  }

  // The unique lesson key claims the alert before sending, preventing duplicate
  // notifications when several students submit reports at nearly the same time.
  const claim = await supabaseRpc.from("schedule_report_alerts").insert({
    group_id: groupId,
    schedule_date: dateString,
    starts_at: startsAt,
    cancelled_count: summary.cancelled_count
  }).select("id").maybeSingle();

  if (claim.error) {
    if (claim.error.code === "23505") return; // Already alerted for this lesson.
    console.error("Schedule cancellation alert claim failed:", claim.error.message);
    return;
  }
  if (!claim.data) return;

  const message = [
    "⚠️ Возможно, пара отменена",
    "Группа: " + groupCode,
    "Дата: " + dateString,
    "Время: " + startsAt,
    "Предмет: " + (String(subject || "").trim().slice(0, 160) || "не указан"),
    "Сообщений об отмене от разных пользователей: " + summary.cancelled_count,
    "",
    "Это неподтверждённый сигнал. Проверь информацию перед изменением расписания."
  ].join("\n");

  try {
    await telegramApi("sendMessage", {
      chat_id: OWNER_TELEGRAM_ID,
      text: message,
      disable_web_page_preview: true
    });
    const { error: markError } = await supabaseRpc.from("schedule_report_alerts")
      .update({ sent_at: new Date().toISOString(), cancelled_count: summary.cancelled_count })
      .eq("group_id", groupId).eq("schedule_date", dateString).eq("starts_at", startsAt);
    if (markError) console.error("Schedule cancellation alert sent but status update failed:", markError.message);
  } catch (error) {
    console.error("Schedule cancellation alert delivery failed:", error.message);
    const { error: cleanupError } = await supabaseRpc.from("schedule_report_alerts")
      .delete().eq("group_id", groupId).eq("schedule_date", dateString).eq("starts_at", startsAt);
    if (cleanupError) console.error("Schedule cancellation alert claim cleanup failed:", cleanupError.message);
  }
}

app.post("/api/schedule-reports", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const user = verifyTelegramInitData(req.body && req.body.initData, false);
  if (!user) return res.status(403).json({ error: "Valid Telegram Mini App data required" });
  if (!supabase || !supabaseRpc || !TELEGRAM_BOT_TOKEN) {
    return res.status(503).json({ error: "Reports are not configured" });
  }

  const body = req.body || {};
  const groupCode = String(body.group_code || "").trim();
  const dateString = String(body.date || "");
  const startsAt = String(body.starts_at || "");
  const endsAt = String(body.ends_at || "");
  const subject = String(body.subject || "").trim().slice(0, 160);
  const reportType = String(body.report_type || "");
  const details = String(body.details || "").trim().slice(0, 300);
  if (!groupCode || groupCode.length > 80 || !validDateString(dateString)) {
    return res.status(400).json({ error: "Group and valid date are required" });
  }
  if (!isValidLessonTime(startsAt) || (endsAt && !isValidLessonTime(endsAt))) {
    return res.status(400).json({ error: "Invalid lesson time" });
  }
  if (!SCHEDULE_REPORT_TYPES.has(reportType)) {
    return res.status(400).json({ error: "Invalid report type" });
  }

  const { data: group, error: groupError } = await supabase
    .from("student_groups").select("id").eq("group_code", groupCode).maybeSingle();
  if (groupError) return res.status(500).json({ error: "Unable to resolve group" });
  if (!group) return res.status(404).json({ error: "Group not found" });

  // Keyed hash avoids storing Telegram IDs while still preventing repeat votes per lesson.
  const reporterHash = crypto.createHmac("sha256", TELEGRAM_BOT_TOKEN)
    .update("schedule-report:" + user.id).digest("hex");
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error: limitError } = await supabaseRpc.from("schedule_change_reports")
    .select("id", { count: "exact", head: true })
    .eq("reporter_hash", reporterHash).gte("created_at", cutoff);
  if (limitError) {
    console.error("Schedule report rate limit failed:", limitError.message);
    return res.status(503).json({ error: "Unable to submit report" });
  }
  if ((count || 0) >= 10) return res.status(429).json({ error: "Daily report limit reached" });

  const { error } = await supabaseRpc.from("schedule_change_reports").upsert({
    group_id: group.id,
    schedule_date: dateString,
    starts_at: startsAt,
    ends_at: endsAt || null,
    subject,
    report_type: reportType,
    details,
    reporter_hash: reporterHash,
    updated_at: new Date().toISOString()
  }, { onConflict: "group_id,schedule_date,starts_at,reporter_hash" });
  if (error) {
    console.error("Schedule report submission failed:", error.message);
    return res.status(503).json({ error: "Unable to submit report" });
  }

  const { data: rows, error: summaryError } = await supabaseRpc.from("schedule_change_reports")
    .select("starts_at,report_type,updated_at")
    .eq("group_id", group.id).eq("schedule_date", dateString).eq("starts_at", startsAt)
    .limit(200);
  if (summaryError) {
    console.error("Schedule report summary after submit failed:", summaryError.message);
    return res.json({ ok: true, report_count: 1, report_types: [reportType] });
  }
  const summary = summarizeScheduleReports(rows)[0] || {
    starts_at: startsAt.slice(0, 5),
    report_count: 1,
    report_types: [reportType],
    report_type_counts: { [reportType]: 1 },
    cancelled_count: reportType === "cancelled" ? 1 : 0
  };
  await maybeSendScheduleCancellationAlert({
    groupId: group.id,
    groupCode,
    dateString,
    startsAt,
    subject,
    summary
  });
  return res.json({ ok: true, ...summary });
});

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
      .select("id,starts_at,ends_at,subject,teacher,room,lesson_type,notes,excluded_dates,valid_from,valid_to,week_type,weekday,source_label")
      .eq("group_id", group.id).eq("entry_kind", "recurring").eq("weekday", weekday)
      .or("week_type.is.null,week_type.eq." + getWeekType(dateString)).order("starts_at")
  ]);
  if (overrideResult.error || recurringResult.error) {
    return res.status(500).json({ error: "Unable to load schedule changes" });
  }
  const validRecurringRows = (recurringResult.data || []).filter(row =>
    (!row.valid_from || row.valid_from <= dateString) &&
    (!row.valid_to || row.valid_to >= dateString)
  );
  const excluded = validRecurringRows.filter(row =>
    !String(row.source_label || "").startsWith("rep_all_weeks_delete") &&
    (row.excluded_dates || []).includes(dateString)
  ).map(row => ({ starts_at: row.starts_at, ends_at: row.ends_at }));
  const recurringChanges = validRecurringRows.filter(row => {
    const marker = String(row.source_label || "");
    return marker.startsWith("rep_all_weeks_delete|") ||
      (marker.startsWith("rep_all_weeks_") && !(row.excluded_dates || []).includes(dateString));
  });
  return res.json({
    group_code: group.group_code,
    date: dateString,
    excluded,
    recurring_changes: recurringChanges,
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
    .select("group_id,entry_kind,weekday,week_type,schedule_date,starts_at,ends_at,subject,teacher,room,lesson_type,notes,excluded_dates,valid_from,valid_to,source_label")
    .in("group_id", ids)
    .order("starts_at");
  if (entriesError) return res.status(500).json({ error: "Unable to load course schedule" });

  const groupById = new Map(groups.map(group => [group.id, group]));
  let lessons = (entries || []).filter(row => !String(row.source_label || "").startsWith("rep_all_weeks_delete")).map(row => toMiniAppLesson({
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

// Applied Informatics belongs to the Customs Affairs faculty. Keep the old economics URLs as
// compatibility aliases while the Mini App migrates to the correct faculty route.
app.get("/api/customs/applied-informatics/course1-schedule", (_req, res) => exportCourseSchedule(1, res, "customs", "applied-informatics"));
app.get("/api/customs/applied-informatics/course2-schedule", (_req, res) => exportCourseSchedule(2, res, "customs", "applied-informatics"));
app.get("/api/customs/applied-informatics/course3-schedule", (_req, res) => exportCourseSchedule(3, res, "customs", "applied-informatics"));
app.get("/api/customs/applied-informatics/course4-schedule", (_req, res) => exportCourseSchedule(4, res, "customs", "applied-informatics"));
app.get("/api/customs/applied-informatics/all-schedules", (_req, res) => exportCourseSchedule(null, res, "customs", "applied-informatics"));
app.get("/api/economics/applied-informatics/course1-schedule", (_req, res) => exportCourseSchedule(1, res, "customs", "applied-informatics"));
app.get("/api/economics/applied-informatics/course2-schedule", (_req, res) => exportCourseSchedule(2, res, "customs", "applied-informatics"));
app.get("/api/economics/applied-informatics/course3-schedule", (_req, res) => exportCourseSchedule(3, res, "customs", "applied-informatics"));
app.get("/api/economics/applied-informatics/course4-schedule", (_req, res) => exportCourseSchedule(4, res, "customs", "applied-informatics"));

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
app.get("/api/customs/all-schedules", (_req, res) => exportCourseSchedule(null, res, "customs", ["customs", "applied-informatics"]));

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


// Sends change notifications only to students who explicitly enabled them.
// Telegram can message a user only after they have opened the bot at least once.
async function notifyGroupScheduleChange({ groupId, event, scope, dateString, subject, excludeTelegramUserId }) {
  if (!supabaseRpc || !TELEGRAM_BOT_TOKEN) return { sent: 0, failed: 0 };
  const [groupResult, subscriptionsResult] = await Promise.all([
    supabaseRpc.from("student_groups").select("group_code").eq("id", groupId).maybeSingle(),
    supabaseRpc.from("schedule_change_subscriptions").select("telegram_user_id")
      .eq("group_id", groupId).eq("enabled", true).limit(500)
  ]);
  if (groupResult.error || subscriptionsResult.error || !groupResult.data) {
    console.error("Schedule change notification lookup failed:", groupResult.error?.message || subscriptionsResult.error?.message || "Group not found");
    return { sent: 0, failed: 0 };
  }
  const recipients = (subscriptionsResult.data || [])
    .map(row => String(row.telegram_user_id))
    .filter(id => id !== String(excludeTelegramUserId || ""));
  if (!recipients.length) return { sent: 0, failed: 0 };
  const eventText = event === "delete" ? "Староста убрал пару из расписания."
    : event === "restore" ? "Староста отменил предыдущее изменение расписания."
    : event === "add" ? "Староста добавил пару в расписание."
    : "Староста изменил расписание.";
  const scopeText = scope === "all_weeks" ? "Действует на все недели."
    : dateString ? "Дата: " + dateString : "";
  const message = [
    "🔔 Обновление расписания",
    "Группа: " + groupResult.data.group_code,
    eventText,
    subject ? "Пара: " + String(subject).slice(0, 160) : "",
    scopeText,
    "",
    "Открой «РТА – Расписание», чтобы посмотреть изменения."
  ].filter(Boolean).join("\n");
  let sent = 0;
  let failed = 0;
  await Promise.allSettled(recipients.map(async telegramUserId => {
    try {
      await telegramApi("sendMessage", { chat_id: telegramUserId, text: message, disable_web_page_preview: true });
      sent++;
    } catch (error) {
      failed++;
      const detail = String(error.message || "");
      if (/bot was blocked|chat not found|user is deactivated|can't initiate conversation/i.test(detail)) {
        const { error: disableError } = await supabaseRpc.from("schedule_change_subscriptions")
          .update({ enabled: false, updated_at: new Date().toISOString() }).eq("telegram_user_id", telegramUserId);
        if (disableError) console.error("Could not disable unreachable schedule notification recipient:", disableError.message);
      }
      console.error("Schedule change notification delivery failed for a subscriber:", detail);
    }
  }));
  return { sent, failed };
}

app.post("/api/support", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const user = verifyTelegramInitData(req.body && req.body.initData, false);
  if (!user) return res.status(403).json({ error: "Открой поддержку внутри Mini App Telegram и попробуй снова." });
  if (!supabaseRpc || !TELEGRAM_BOT_TOKEN || !OWNER_TELEGRAM_ID) {
    return res.status(503).json({ error: "Поддержка временно недоступна. Попробуй написать через чат бота." });
  }

  const body = req.body || {};
  const allowedCategories = new Set(["question", "app_bug", "schedule_bug", "suggestion", "other"]);
  const category = String(body.category || "other");
  const messageText = String(body.message || "").trim();
  const groupCode = String(body.group_code || "").trim().slice(0, 80);
  if (!allowedCategories.has(category)) return res.status(400).json({ error: "Выбери тип обращения." });
  if (messageText.length < 5 || messageText.length > 2000) {
    return res.status(400).json({ error: "Сообщение должно содержать от 5 до 2000 символов." });
  }

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await supabaseRpc.from("support_messages")
    .select("id", { count: "exact", head: true })
    .eq("telegram_user_id", user.id)
    .gte("created_at", cutoff);
  if (countError) {
    console.error("Unable to check support rate limit:", countError.message);
    return res.status(503).json({ error: "Не удалось проверить обращение. Попробуй позже." });
  }
  if ((count || 0) >= 10) return res.status(429).json({ error: "Слишком много обращений за сутки. Попробуй позже." });

  const profile = (() => {
    try { return JSON.parse(new URLSearchParams(body.initData).get("user") || "{}"); }
    catch (_) { return {}; }
  })();
  const categoryLabels = {
    question: "Вопрос",
    app_bug: "Ошибка в приложении",
    schedule_bug: "Ошибка в расписании",
    suggestion: "Предложение",
    other: "Другое"
  };
  const fullMessage = (groupCode ? "Группа: " + groupCode + "\\n\\n" : "") + messageText;
  const { data: saved, error: insertError } = await supabaseRpc.from("support_messages").insert({
    telegram_chat_id: user.id,
    telegram_user_id: user.id,
    first_name: String(profile.first_name || user.first_name || "Пользователь").slice(0, 120),
    username: profile.username ? String(profile.username).slice(0, 120) : null,
    category,
    message: fullMessage.slice(0, 4000)
  }).select("id").single();
  if (insertError) {
    console.error("Unable to save support message:", insertError.message);
    return res.status(503).json({ error: "Не удалось сохранить обращение. Попробуй ещё раз." });
  }

  try {
    await telegramApi("sendMessage", {
      chat_id: OWNER_TELEGRAM_ID,
      text: "📩 Новое обращение в поддержку\\nТип: " + categoryLabels[category] +
        "\\nОт: " + String(profile.first_name || user.first_name || "Пользователь") +
        (profile.username ? " (@" + String(profile.username).slice(0, 80) + ")" : "") +
        "\\nTelegram ID: " + user.id +
        "\\nНомер: #" + saved.id +
        "\\n\\n" + fullMessage.slice(0, 3500),
      disable_web_page_preview: true
    });
  } catch (error) {
    console.error("Support message saved but owner notification failed:", error.message);
    return res.status(202).json({ ok: true, saved: true, notified: false, message: "Обращение сохранено, но уведомление владельцу не удалось отправить. Повтори попытку позже или напиши боту." });
  }
  return res.json({ ok: true, saved: true, notified: true, message: "Обращение отправлено. Спасибо! Владелец получит сообщение в Telegram." });
});

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
  const chatId = String(message.chat.id);
  const userId = String((message.from && message.from.id) || message.chat.id);
  const firstName = String((message.from && message.from.first_name) || "").slice(0, 120);
  const username = message.from && message.from.username ? String(message.from.username).slice(0, 120) : null;
  const text = message.text.trim();
  const command = text.split(/\s+/, 1)[0].split("@", 1)[0];
  const startParam = command === "/start" ? text.split(/\s+/, 2)[1] || "" : "";

  if (command === "/start" && startParam === "support") {
    try {
      if (!supabaseRpc) throw new Error("Support inbox is not configured");
      const { error } = await supabaseRpc.from("support_sessions").upsert({
        telegram_chat_id: chatId, telegram_user_id: userId, first_name: firstName,
        username, category: "other", created_at: new Date().toISOString()
      });
      if (error) throw error;
      await telegramApi("sendMessage", {
        chat_id: chatId,
        text: "💬 Поддержка РТА — Расписание\n\nВыбери тип обращения:",
        reply_markup: {
          keyboard: [[{ text: "⚠️ Жалоба на расписание" }], [{ text: "❓ Вопрос" }, { text: "💡 Предложение" }]],
          resize_keyboard: true, one_time_keyboard: true
        }
      });
    } catch (error) {
      console.error("Unable to start support session:", error.message);
      await telegramApi("sendMessage", { chat_id: chatId, text: "Не удалось открыть поддержку. Попробуй ещё раз чуть позже." }).catch(() => {});
    }
    return;
  }

  if (command === "/start" || command === "/help") {
    const greeting = command === "/start"
      ? "🎓 Добро пожаловать в РТА – Расписание! Нажми кнопку ниже, чтобы открыть расписание."
      : "📅 Открой расписание кнопкой ниже. Для обращения в поддержку используй раздел «Профиль» в мини-приложении.";
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
    return;
  }

  if (!supabaseRpc || text.startsWith("/")) return;
  try {
    const { data: session, error: sessionError } = await supabaseRpc.from("support_sessions")
      .select("telegram_chat_id,telegram_user_id,first_name,username,category")
      .eq("telegram_chat_id", chatId).maybeSingle();
    if (sessionError) throw sessionError;
    if (!session) return;

    const categoryMap = {
      "⚠️ Жалоба на расписание": "complaint",
      "❓ Вопрос": "question",
      "💡 Предложение": "suggestion"
    };
    if (categoryMap[text]) {
      const { error } = await supabaseRpc.from("support_sessions")
        .update({ category: categoryMap[text], created_at: new Date().toISOString() })
        .eq("telegram_chat_id", chatId);
      if (error) throw error;
      await telegramApi("sendMessage", {
        chat_id: chatId,
        text: "Напиши обращение одним сообщением. Можно указать группу, дату и пару, если это важно.",
        reply_markup: { remove_keyboard: true }
      });
      return;
    }

    const category = String(session.category || "other");
    const { error: insertError } = await supabaseRpc.from("support_messages").insert({
      telegram_chat_id: chatId, telegram_user_id: String(session.telegram_user_id),
      first_name: String(session.first_name || firstName).slice(0,120),
      username: session.username || username, category,
      message: text.slice(0,4000)
    });
    if (insertError) throw insertError;

    const categoryLabel = { complaint: "Жалоба на расписание", question: "Вопрос", suggestion: "Предложение", other: "Обращение" }[category] || "Обращение";
    if (OWNER_TELEGRAM_ID) {
      await telegramApi("sendMessage", {
        chat_id: OWNER_TELEGRAM_ID,
        text: "📩 Новое обращение в поддержку\nТип: " + categoryLabel +
          "\nОт: " + (session.first_name || "Пользователь") +
          (session.username ? " (@" + session.username + ")" : "") +
          "\nTelegram ID: " + session.telegram_user_id +
          "\n\n" + text.slice(0,4000) +
          "\n\nОтветить можно в Telegram, открыв диалог с пользователем по ID: " + session.telegram_user_id
      });
    } else {
      console.error("Support message saved but OWNER_TELEGRAM_ID is not configured");
    }
    await supabaseRpc.from("support_sessions").delete().eq("telegram_chat_id", chatId);
    await telegramApi("sendMessage", {
      chat_id: chatId,
      text: "✅ Обращение отправлено. Спасибо! Если понадобится ещё помощь, снова нажми «Поддержка» в приложении.",
      reply_markup: { remove_keyboard: true }
    });
  } catch (error) {
    console.error("Unable to process support message:", error.message);
    await telegramApi("sendMessage", { chat_id: chatId, text: "Не удалось отправить обращение. Попробуй ещё раз позже." }).catch(() => {});
  }
});

async function configureTelegramProfile() {
  if (!TELEGRAM_BOT_TOKEN) return;
  try {
    await telegramApi("setMyName", { name: "РТА – Расписание" });
    console.log("Telegram bot display name configured");
  } catch (error) {
    console.error("Telegram bot display name setup failed:", error.message);
  }
}

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

// New representative passwords use salted, deliberately expensive scrypt hashes.
// Existing SHA-256 hashes remain verifiable so this can roll out without locking out
// current representatives; a password is upgraded the next time the owner changes it.
async function hashRepresentativePassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return "scrypt$" + salt.toString("hex") + "$" + derived.toString("hex");
}
async function verifyRepresentativePassword(password, storedHash) {
  if (typeof storedHash !== "string" || !storedHash) return false;
  if (storedHash.startsWith("scrypt$")) {
    const parts = storedHash.split("$");
    if (parts.length !== 3 || !/^[a-f0-9]{32}$/i.test(parts[1]) || !/^[a-f0-9]{128}$/i.test(parts[2])) return false;
    const salt = Buffer.from(parts[1], "hex");
    const expected = Buffer.from(parts[2], "hex");
    const actual = await scryptAsync(password, salt, expected.length, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }
  // Legacy format retained only for backwards compatibility until passwords are rotated.
  if (/^[a-f0-9]{64}$/i.test(storedHash)) {
    return safeStringEqual(crypto.createHash("sha256").update(password, "utf8").digest("hex"), storedHash);
  }
  return false;
}
async function getRepresentativeAccess(req, groupId) {
  const token = verifyRepresentativeToken(req);
  if (!token) return { ok: false, status: 401, error: "Сессия старосты истекла. Войди снова." };
  if (token.role === "owner") return { ok: true, actor: "Владелец", role: "owner" };
  if (token.role !== "representative" || Number(token.groupId) !== Number(groupId)) {
    return { ok: false, status: 403, error: "Этот пароль не даёт доступ к выбранной группе." };
  }
  if (!supabase || !supabaseRpc || !REPRESENTATIVE_API_SECRET) return { ok: false, status: 503, error: "Не удалось проверить актуальность доступа." };
  const { data: accessRow, error } = await supabaseRpc.rpc("representative_access_get", { p_secret: REPRESENTATIVE_API_SECRET, p_group_id: groupId });
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
  if (!supabase || !supabaseRpc || !REPRESENTATIVE_API_SECRET) return res.status(503).json({ error: "База данных не настроена." });
  const { data, error } = await supabaseRpc.rpc("representative_access_list", { p_secret: REPRESENTATIVE_API_SECRET });
  if (error || !Array.isArray(data)) {
    console.error("Owner representative access list failed:", error && error.message);
    return res.status(503).json({ error: "Не удалось загрузить настройки доступа старост. Проверь миграцию базы." });
  }
  const { data: vault, error: vaultError } = await supabaseRpc.rpc("representative_password_vault_list", { p_secret: REPRESENTATIVE_API_SECRET });
  if (vaultError || !Array.isArray(vault)) {
    console.error("Owner representative password vault read failed:", vaultError && vaultError.message);
    return res.status(503).json({ error: "Не удалось загрузить хранилище паролей старост." });
  }
  const passwordsByGroup = new Map(vault.map(item => [item.group_code, item.password]));
  const withPasswords = data.map(item => ({ ...item, password: passwordsByGroup.get(item.group_code) || null }));
  return res.json({ data: withPasswords });
});

app.post("/api/owner/representative-access", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!ownerTokenFromRequest(req)) return res.status(403).json({ error: "Доступ только владельцу." });
  if (!supabase || !supabaseRpc || !REPRESENTATIVE_API_SECRET) return res.status(503).json({ error: "База данных не настроена." });
  const groupId = Number(req.body && req.body.group_id);
  const enabled = req.body && req.body.enabled;
  const password = req.body && req.body.password != null ? String(req.body.password) : "";
  if (!Number.isSafeInteger(groupId) || groupId < 1 || typeof enabled !== "boolean") return res.status(400).json({ error: "Укажи группу и состояние доступа." });
  if (password && (password.length < 10 || password.length > 128)) return res.status(400).json({ error: "Пароль должен содержать от 10 до 128 символов." });
  const passwordHash = password ? await hashRepresentativePassword(password) : null;
  // Update the verifier hash and the owner-only password vault in one database transaction.
  // Otherwise the owner panel can show a stale password while login checks the new hash.
  const { data, error } = await supabaseRpc.rpc("representative_access_set_with_password", {
    p_secret: REPRESENTATIVE_API_SECRET,
    p_group_id: groupId,
    p_password_hash: passwordHash,
    p_enabled: enabled,
    p_password_plaintext: password || null
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
  const { data: accessRow, error: accessError } = await supabaseRpc.rpc("representative_access_get", { p_secret: REPRESENTATIVE_API_SECRET, p_group_id: group.id });
  if (accessError) return res.status(503).json({ error: "Не удалось проверить доступ старосты." });
  if (accessRow && accessRow.enabled === false) return res.status(403).json({ error: "Доступ старосты для этой группы отключён владельцем." });
  const storedHash = accessRow && accessRow.password_hash;
  const validPassword = storedHash
    ? await verifyRepresentativePassword(password, storedHash)
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
  const recurring = (recurringResult.data || []).filter(x => !String(x.source_label || "").startsWith("rep_all_weeks_delete|") && (!x.valid_from || x.valid_from <= dateString) && (!x.valid_to || x.valid_to >= dateString) && !(x.excluded_dates || []).includes(dateString) && !overrideSlots.has(x.starts_at + "|" + x.ends_at));
  return res.json({ data: [...recurring, ...overrides].sort((a,b) => String(a.starts_at).localeCompare(String(b.starts_at))), date: dateString, group_id: groupId, group_code: access.role === "representative" ? verifyRepresentativeToken(req).groupCode : undefined });
});

app.post("/api/representative/change", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!supabase || !supabaseRpc || !REPRESENTATIVE_API_SECRET) return res.status(503).json({ error: "Редактирование не настроено." });
  const body = req.body || {};
  const groupId = Number(body.group_id);
  const access = await getRepresentativeAccess(req, groupId);
  if (!access.ok) return res.status(access.status).json({ error: access.error });
  if (!validDateString(String(body.entry && body.entry.schedule_date || ""))) return res.status(400).json({ error: "Укажи корректную дату." });
  const scope = String(body.scope || "date");
  const recurringScope = scope === "all_weeks";
  const rpcName = recurringScope ? "representative_apply_recurring_change" : "representative_apply_change";
  const requestedAction = String(body.action || "save_override");
  const rpcAction = recurringScope
    ? (requestedAction === "delete_for_date" ? "delete_recurring" : "save_recurring")
    : requestedAction;
  const { data, error } = await supabaseRpc.rpc(rpcName, {
    p_secret: REPRESENTATIVE_API_SECRET,
    p_action: rpcAction,
    p_group_id: groupId,
    p_entry_id: body.entry_id == null ? null : Number(body.entry_id),
    p_entry: body.entry || {},
    p_actor: access.actor
  });
  if (error) {
    console.error("Representative change failed:", error.message);
    const message = String(error.message || "");
    if (message.includes("one_off_cannot_delete_all_weeks")) {
      return res.status(400).json({ error: "Это разовая пара. Чтобы убрать её только на выбранную дату, переключи область действия на «Только на дату»." });
    }
    return res.status(400).json({ error: "Не удалось сохранить изменение. Проверь поля и попробуй ещё раз." });
  }
  const actorUser = verifyTelegramInitData(body.initData, false);
  const event = requestedAction === "delete_for_date" ? "delete"
    : requestedAction === "save_override" && !body.entry_id ? "add" : "update";
  void notifyGroupScheduleChange({
    groupId, event, scope: recurringScope ? "all_weeks" : "date",
    dateString: String(body.entry.schedule_date || ""),
    subject: String(body.entry.subject || ""),
    excludeTelegramUserId: actorUser && actorUser.id
  }).catch(error => console.error("Schedule change notification failed:", error.message));
  return res.json({ ok: true, result: data });
});

app.get("/api/representative/history", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!supabase || !supabaseRpc || !REPRESENTATIVE_API_SECRET) return res.status(503).json({ error: "История недоступна." });
  const groupId = Number(req.query.group_id);
  const access = await getRepresentativeAccess(req, groupId);
  if (!access.ok) return res.status(access.status).json({ error: access.error });
  if (!Number.isSafeInteger(groupId) || groupId < 1) return res.status(400).json({ error: "Неверная группа." });
  const { data, error } = await supabaseRpc.rpc("representative_get_history", { p_secret: REPRESENTATIVE_API_SECRET, p_group_id: groupId, p_limit: 30 });
  if (error) {
    console.error("Representative history failed:", error.message);
    return res.status(503).json({ error: "Не удалось загрузить историю." });
  }
  return res.json({ data });
});


app.post("/api/representative/restore", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!supabase || !supabaseRpc || !REPRESENTATIVE_API_SECRET) return res.status(503).json({ error: "Восстановление недоступно." });
  const body = req.body || {};
  const groupId = Number(body.group_id);
  const historyId = Number(body.history_id);
  const access = await getRepresentativeAccess(req, groupId);
  if (!access.ok) return res.status(access.status).json({ error: access.error });
  if (!Number.isSafeInteger(groupId) || groupId < 1 || !Number.isSafeInteger(historyId) || historyId < 1) return res.status(400).json({ error: "Неверная запись истории." });
  const { data, error } = await supabaseRpc.rpc("representative_restore_history", {
    p_secret: REPRESENTATIVE_API_SECRET,
    p_group_id: groupId,
    p_history_id: historyId,
    p_actor: access.actor
  });
  if (error) {
    console.error("Representative restore failed:", error.message);
    return res.status(400).json({ error: "Не удалось отменить изменение. Возможно, запись уже изменена." });
  }
  const actorUser = verifyTelegramInitData(body.initData, false);
  void notifyGroupScheduleChange({ groupId, event: "restore", scope: "date", excludeTelegramUserId: actorUser && actorUser.id })
    .catch(error => console.error("Schedule restore notification failed:", error.message));
  return res.json({ ok: true, result: data });
});


app.post("/api/schedule-change-notifications/status", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const user = verifyTelegramInitData(req.body && req.body.initData, false);
  if (!user) return res.status(403).json({ error: "Открой приложение через Telegram, чтобы настроить уведомления." });
  if (!supabaseRpc) return res.status(503).json({ error: "Уведомления временно недоступны." });
  const { data, error } = await supabaseRpc.from("schedule_change_subscriptions")
    .select("enabled,student_groups(group_code)")
    .eq("telegram_user_id", user.id).maybeSingle();
  if (error) {
    console.error("Schedule change notification status failed:", error.message);
    return res.status(503).json({ error: "Не удалось загрузить настройки уведомлений." });
  }
  return res.json({ enabled: Boolean(data && data.enabled), group_code: data && data.student_groups ? data.student_groups.group_code : null });
});

app.post("/api/schedule-change-notifications", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const user = verifyTelegramInitData(req.body && req.body.initData, false);
  if (!user) return res.status(403).json({ error: "Открой приложение через Telegram, чтобы настроить уведомления." });
  if (!supabaseRpc || !TELEGRAM_BOT_TOKEN) return res.status(503).json({ error: "Уведомления временно недоступны." });
  const body = req.body || {};
  if (typeof body.enabled !== "boolean") return res.status(400).json({ error: "Не указано состояние уведомлений." });
  if (!body.enabled) {
    const { error } = await supabaseRpc.from("schedule_change_subscriptions")
      .update({ enabled: false, updated_at: new Date().toISOString() }).eq("telegram_user_id", user.id);
    if (error) {
      console.error("Schedule change notification opt-out failed:", error.message);
      return res.status(503).json({ error: "Не удалось отключить уведомления." });
    }
    return res.json({ ok: true, enabled: false, group_code: null });
  }
  const groupCode = String(body.group_code || "").trim();
  if (!groupCode || groupCode.length > 80) return res.status(400).json({ error: "Выбери учебную группу." });
  const { data: group, error: groupError } = await supabaseRpc.from("student_groups")
    .select("id,group_code").eq("group_code", groupCode).maybeSingle();
  if (groupError) return res.status(503).json({ error: "Не удалось проверить группу." });
  if (!group) return res.status(404).json({ error: "Группа не найдена в базе расписания." });
  const { error } = await supabaseRpc.from("schedule_change_subscriptions").upsert({
    telegram_user_id: user.id, group_id: group.id, enabled: true, updated_at: new Date().toISOString()
  }, { onConflict: "telegram_user_id" });
  if (error) {
    console.error("Schedule change notification opt-in failed:", error.message);
    return res.status(503).json({ error: "Не удалось сохранить настройки уведомлений." });
  }
  return res.json({ ok: true, enabled: true, group_code: group.group_code });
});


app.post("/api/reminders/status", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const user = verifyTelegramInitData(req.body && req.body.initData, false);
  if (!user) return res.status(403).json({ error: "Открой приложение через Telegram, чтобы настроить напоминания." });
  if (!supabaseRpc) return res.status(503).json({ error: "Напоминания временно недоступны." });
  const { data, error } = await supabaseRpc.from("reminder_subscriptions")
    .select("enabled,student_groups(group_code)")
    .eq("telegram_user_id", user.id).maybeSingle();
  if (error) {
    console.error("Reminder status lookup failed:", error.message);
    return res.status(503).json({ error: "Не удалось загрузить настройки напоминаний." });
  }
  return res.json({
    enabled: Boolean(data && data.enabled),
    group_code: data && data.student_groups ? data.student_groups.group_code : null
  });
});

app.post("/api/reminders", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const user = verifyTelegramInitData(req.body && req.body.initData, false);
  if (!user) return res.status(403).json({ error: "Открой приложение через Telegram, чтобы настроить напоминания." });
  if (!supabaseRpc || !TELEGRAM_BOT_TOKEN) return res.status(503).json({ error: "Напоминания временно недоступны." });
  const body = req.body || {};
  if (typeof body.enabled !== "boolean") return res.status(400).json({ error: "Не указано состояние напоминаний." });

  if (!body.enabled) {
    const { error } = await supabaseRpc.from("reminder_subscriptions")
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .eq("telegram_user_id", user.id);
    if (error) {
      console.error("Reminder opt-out failed:", error.message);
      return res.status(503).json({ error: "Не удалось отключить напоминания." });
    }
    return res.json({ ok: true, enabled: false, group_code: null });
  }

  const groupCode = String(body.group_code || "").trim();
  if (!groupCode || groupCode.length > 80) return res.status(400).json({ error: "Выбери учебную группу." });
  const { data: group, error: groupError } = await supabaseRpc.from("student_groups")
    .select("id,group_code").eq("group_code", groupCode).maybeSingle();
  if (groupError) return res.status(503).json({ error: "Не удалось проверить группу." });
  if (!group) return res.status(404).json({ error: "Группа не найдена в базе расписания." });

  const { count, error: countError } = await supabaseRpc.from("schedule_entries")
    .select("id", { count: "exact", head: true }).eq("group_id", group.id);
  if (countError) return res.status(503).json({ error: "Не удалось проверить полноту расписания." });
  if (!hasScheduleData(count || 0)) {
    return res.status(409).json({ error: "Напоминания для этой группы пока не включены: в базе нет записей расписания." });
  }

  const { error } = await supabaseRpc.from("reminder_subscriptions").upsert({
    telegram_user_id: user.id,
    group_id: group.id,
    enabled: true,
    updated_at: new Date().toISOString()
  }, { onConflict: "telegram_user_id" });
  if (error) {
    console.error("Reminder opt-in failed:", error.message);
    return res.status(503).json({ error: "Не удалось сохранить настройку напоминаний." });
  }
  return res.json({ ok: true, enabled: true, group_code: group.group_code });
});

app.post("/api/reminders/dispatch", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!REMINDER_CRON_SECRET || !supabaseRpc || !TELEGRAM_BOT_TOKEN) {
    return res.status(503).json({ error: "Reminder dispatch is not configured" });
  }
  const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const expectedBuffer = Buffer.from(REMINDER_CRON_SECRET);
  const suppliedBuffer = Buffer.from(supplied);
  if (expectedBuffer.length !== suppliedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    const result = await dispatchReminders({ supabaseRpc, botToken: TELEGRAM_BOT_TOKEN });
    return res.json({ ok: true, ...result });
  } catch (error) {
    console.error("Reminder dispatch failed:", error.message);
    return res.status(503).json({ error: "Unable to dispatch reminders" });
  }
});

let reminderDispatchRunning = false;
async function runReminderDispatch() {
  if (!REMINDER_SCHEDULER_ENABLED || reminderDispatchRunning || !supabaseRpc || !TELEGRAM_BOT_TOKEN) return;
  reminderDispatchRunning = true;
  try {
    const result = await dispatchReminders({ supabaseRpc, botToken: TELEGRAM_BOT_TOKEN });
    if (result.sent || result.failed) {
      console.log("Class reminder dispatch:", JSON.stringify(result));
    }
  } catch (error) {
    console.error("Class reminder scheduler failed:", error.message);
  } finally {
    reminderDispatchRunning = false;
  }
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`RTA schedule API listening on port ${PORT}`);
  console.log("Schedule cancellation alerts:", TELEGRAM_BOT_TOKEN && OWNER_TELEGRAM_ID && supabaseRpc ? "configured" : "disabled: missing required configuration");
  void configureTelegramProfile();
  void configureTelegramWebhook();
  if (REMINDER_SCHEDULER_ENABLED) {
    void runReminderDispatch();
    const reminderTimer = setInterval(() => { void runReminderDispatch(); }, 60_000);
    if (typeof reminderTimer.unref === "function") reminderTimer.unref();
    console.log("Class reminder scheduler enabled (60-second interval).");
  } else {
    console.log("Class reminder scheduler disabled: set REMINDER_SCHEDULER_ENABLED=true to enable.");
  }
});