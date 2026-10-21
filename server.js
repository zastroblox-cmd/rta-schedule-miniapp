const express = require("express");
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
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/health", (_req, res) => {
  res.status(supabase ? 200 : 503).json({
    status: supabase ? "ok" : "configuration_required",
    databaseConfigured: Boolean(supabase)
  });
});

app.get("/api/faculties", async (_req, res) => {
  if (!supabase) return res.status(503).json({ error: "Database is not configured" });
  const { data, error } = await supabase
    .from("faculties")
    .select("id,name,slug")
    .order("name");
  if (error) return res.status(500).json({ error: "Unable to load faculties" });
  res.json({ data });
});

app.get("/api/groups", async (_req, res) => {
  if (!supabase) return res.status(503).json({ error: "Database is not configured" });
  const { data, error } = await supabase
    .from("student_groups")
    .select("id,group_code,display_name,course_id,courses(course_number,faculty_id,faculties(name,slug))")
    .order("display_name");
  if (error) return res.status(500).json({ error: "Unable to load groups" });
  res.json({ data });
});

function getWeekType(dateString) {
  // Schedule rule: 12–18 Oct 2026 is week B; 19–25 Oct 2026 is week A.
  const date = new Date(dateString + "T12:00:00Z");
  const monday = new Date(date);
  const day = monday.getUTCDay() || 7;
  monday.setUTCDate(monday.getUTCDate() - day + 1);
  const anchor = new Date("2026-10-19T12:00:00Z");
  const weeks = Math.round((monday - anchor) / (7 * 24 * 60 * 60 * 1000));
  return ((weeks % 2) + 2) % 2 === 0 ? "A" : "B";
}

app.get("/api/schedule", async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "Database is not configured" });

  const groupId = Number(req.query.group_id);
  const dateString = String(req.query.date || "");
  if (!Number.isInteger(groupId) || groupId < 1) {
    return res.status(400).json({ error: "group_id must be a positive integer" });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString) ||
      Number.isNaN(Date.parse(dateString + "T00:00:00Z"))) {
    return res.status(400).json({ error: "date must use YYYY-MM-DD format" });
  }

  const date = new Date(dateString + "T12:00:00Z");
  const weekday = date.getUTCDay() || 7;
  const weekType = getWeekType(dateString);

  const { data: overrides, error: overrideError } = await supabase
    .from("schedule_entries")
    .select("id,group_id,entry_kind,weekday,week_type,schedule_date,starts_at,ends_at,subject,teacher,room,lesson_type,notes")
    .eq("group_id", groupId)
    .eq("entry_kind", "date_override")
    .eq("schedule_date", dateString)
    .order("starts_at");

  if (overrideError) return res.status(500).json({ error: "Unable to load schedule" });

  if (overrides && overrides.length > 0) {
    return res.json({ date: dateString, week_type: weekType, source: "date_override", data: overrides });
  }

  const { data, error } = await supabase
    .from("schedule_entries")
    .select("id,group_id,entry_kind,weekday,week_type,schedule_date,starts_at,ends_at,subject,teacher,room,lesson_type,notes")
    .eq("group_id", groupId)
    .eq("entry_kind", "recurring")
    .eq("weekday", weekday)
    .or(`week_type.is.null,week_type.eq.${weekType}`)
    .or(`valid_from.is.null,valid_from.lte.${dateString}`)
    .or(`valid_to.is.null,valid_to.gte.${dateString}`)
    .order("starts_at");

  if (error) return res.status(500).json({ error: "Unable to load schedule" });
  res.json({ date: dateString, week_type: weekType, source: "recurring", data: data || [] });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`RTA schedule API listening on port ${PORT}`);
});