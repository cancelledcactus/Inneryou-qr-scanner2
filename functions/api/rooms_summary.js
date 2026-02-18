import { json } from "./_middleware";
import { getNYParts, getActivePeriod } from "./_time";

export async function onRequestGet({ request, env }) {
  const { err, user } = await requireTechOrAdmin(request, env);
  if (err) return json({ ok:false, error: err }, 401);

  const settings = await loadSettings(env.DB);
  const allowNoPeriod = String(settings.testingAllowNoPeriod || "true") === "true";

  const { event_day, hhmm } = getNYParts();
  const { period_id } = await getActivePeriod(env.DB, hhmm, allowNoPeriod);

  const rooms = await env.DB.prepare(`
    SELECT room_id
    FROM rooms
    WHERE active=1
    ORDER BY sort_order ASC, room_id ASC
  `).all();

  // Attempt to read extended summary fields; fallback if columns don't exist yet
  let summary;
  try {
    summary = await env.DB.prepare(`
      SELECT room_id, ok_count, dup_count, err_count,
             last_ts, last_student_id, last_name, last_grade, last_status, last_error,
             help_flag, support_type, support_ts, last_heartbeat
      FROM room_period_summary
      WHERE event_day=? AND period_id=?
    `).bind(event_day, period_id).all();
  } catch {
    summary = await env.DB.prepare(`
      SELECT room_id, ok_count, dup_count, err_count,
             last_ts, last_student_id,
             help_flag, last_heartbeat
      FROM room_period_summary
      WHERE event_day=? AND period_id=?
    `).bind(event_day, period_id).all();
  }

  const map = new Map();
  for (const s of summary.results || []) map.set(s.room_id, s);

  const out = (rooms.results || []).map(r => {
    const s = map.get(r.room_id) || {};
    return {
      room_id: r.room_id,
      ok_count: s.ok_count || 0,
      dup_count: s.dup_count || 0,
      err_count: s.err_count || 0,
      last_ts: s.last_ts || null,
      last_student_id: s.last_student_id || null,
      last_name: s.last_name || null,
      last_grade: (typeof s.last_grade === "number") ? s.last_grade : null,
      last_status: s.last_status || null,
      last_error: s.last_error || null,
      help_flag: (s.help_flag || 0) ? 1 : 0,
      support_type: s.support_type || null,
      support_ts: s.support_ts || null,
      last_heartbeat: s.last_heartbeat || null,
    };
  });

  return json({ ok:true, event_day, period_id, ny_hhmm: hhmm, rooms: out });
}

async function loadSettings(DB) {
  try {
    const rows = await DB.prepare("SELECT key, value FROM settings").all();
    const out = {};
    for (const r of rows.results || []) out[r.key] = r.value;
    return out;
  } catch {
    return {};
  }
}

async function requireTechOrAdmin(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const user = await verifyToken(env, token);
  if (!user) return { err:"Not logged in", user:null };
  if (user.role !== "TECH" && user.role !== "ADMIN") return { err:"Forbidden", user:null };
  return { err:null, user };
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
