import { json } from "./_middleware";

export async function onRequestGet({ request, env }) {
  const { user, err } = await requireAuth(request, env);
  if (err) return json({ ok: false, error: err }, 401);
  if (user.role !== "TECH" && user.role !== "ADMIN") return json({ ok: false, error: "Forbidden" }, 403);

  const settings = await getSettings(env.DB);
  const allowNoPeriod = String(settings.testingAllowNoPeriod || "true") === "true";
  const event_day = new Date().toISOString().slice(0, 10);
  const period_id = await getCurrentPeriodId(env.DB, allowNoPeriod);

  const rooms = await env.DB.prepare(
    "SELECT room_id, active, sort_order FROM rooms WHERE active=1 ORDER BY sort_order ASC, room_id ASC"
  ).all();

  // Join summaries (may not exist yet)
  const summary = await env.DB.prepare(
    `SELECT room_id, ok_count, dup_count, err_count, last_ts, last_student_id, help_flag, last_heartbeat
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
      help_flag: (s?.help_flag || 0) ? 1 : 0,
      last_heartbeat: s?.last_heartbeat || null
    };
  });

  return json({ ok: true, event_day, period_id, rooms: out });
}

async function getSettings(db) {
  const rows = await db.prepare("SELECT key, value FROM settings").all();
  const out = {};
  for (const r of rows.results || []) out[r.key] = r.value;
  return out;
}
async function getCurrentPeriodId(db, allowNoPeriod) {
  const rows = await db.prepare("SELECT period_id, start_time, end_time FROM periods WHERE active=1 ORDER BY sort_order").all();
  const now = new Date();
  const cur = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
  for (const p of rows.results || []) if (p.start_time <= cur && cur < p.end_time) return p.period_id;
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
