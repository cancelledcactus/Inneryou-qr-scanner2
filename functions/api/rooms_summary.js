import { json } from "./_middleware";

export async function onRequestGet({ request, env }) {
  const { user, err } = await requireAuth(request, env);
  if (err) return json({ ok: false, error: err }, 401);
  if (user.role !== "TECH" && user.role !== "ADMIN") return json({ ok: false, error: "Forbidden" }, 403);

  const settings = await getSettings(env.DB);
  const allowNoPeriod = String(settings.testingAllowNoPeriod || "true") === "true";

  const { event_day, hhmm } = getNYParts();
  const period_id = await getCurrentPeriodId(env.DB, hhmm, allowNoPeriod);

  const rooms = await env.DB.prepare(
    "SELECT room_id, active, sort_order FROM rooms WHERE active=1 ORDER BY sort_order ASC, room_id ASC"
  ).all();

  const summary = await env.DB.prepare(
    `SELECT room_id, ok_count, dup_count, err_count,
            last_ts, last_student_id, last_name, last_grade, last_status, last_error,
            help_flag, support_type, support_ts, last_heartbeat
     FROM room_period_summary
     WHERE event_day=? AND period_id=?`
  ).bind(event_day, period_id).all();

  const map = new Map();
  for (const s of summary.results || []) map.set(s.room_id, s);

  const out = (rooms.results || []).map(r => {
    const s = map.get(r.room_id);
    return {
      room_id: r.room_id,
      ok_count: s?.ok_count || 0,
      dup_count: s?.dup_count || 0,
      err_count: s?.err_count || 0,
      last_ts: s?.last_ts || null,
      last_student_id: s?.last_student_id || null,
      last_name: s?.last_name || null,
      last_grade: s?.last_grade ?? null,
      last_status: s?.last_status || null,
      last_error: s?.last_error || null,
      help_flag: (s?.help_flag || 0) ? 1 : 0,
      support_type: s?.support_type || null,
      support_ts: s?.support_ts || null,
      last_heartbeat: s?.last_heartbeat || null
    };
  });

  return json({ ok: true, event_day, period_id, ny_hhmm: hhmm, rooms: out });
}

function getNYParts() {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]));
  const event_day = `${parts.year}-${parts.month}-${parts.day}`;
  const hhmm = `${parts.hour}:${parts.minute}`;
  return { event_day, hhmm };
}

async function getSettings(db) {
  const rows = await db.prepare("SELECT key, value FROM settings").all();
  const out = {};
  for (const r of rows.results || []) out[r.key] = r.value;
  return out;
}

async function getCurrentPeriodId(db, ny_hhmm, allowNoPeriod) {
  const rows = await db.prepare("SELECT period_id, start_time, end_time FROM periods WHERE active=1 ORDER BY sort_order").all();
  for (const p of rows.results || []) {
    if (p.start_time <= ny_hhmm && ny_hhmm < p.end_time) return p.period_id;
  }
  return allowNoPeriod ? "NO_PERIOD" : null;
}

async function requireAuth(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const user = await verifyToken(env, token);
  if (!user) return { user: null, err: "Not logged in" };
  return { user, err: null };
}

async function verifyToken(env, token) {
  if (!token || !token.includes(".")) return null;
  const [data, sig] = token.split(".");
  const expected = await hmac(env.AUTH_SECRET, data);
  if (sig !== expected) return null;
  try { return JSON.parse(decodeURIComponent(escape(atob(data)))); } catch { return null; }
}

async function hmac(secret, data) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=+$/g, "");
}
