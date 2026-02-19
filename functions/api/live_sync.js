import { json } from "./_middleware";
import { getNYParts, getActivePeriod } from "./_time";

export async function onRequestGet({ request, env }) {
  const { err } = await requireTechOrAdmin(request, env);
  if (err) return json({ ok:false, error: err }, 401);

  const { hhmm, event_day } = getNYParts();
  const settings = await env.DB.prepare("SELECT key, value FROM settings").all();
  const allowNoPeriod = settings.results?.find(r=>r.key==="testingAllowNoPeriod")?.value !== "false";
  const { period_id } = await getActivePeriod(env.DB, hhmm, allowNoPeriod);

  const [rooms, summary, devices] = await Promise.all([
    env.DB.prepare("SELECT room_id, active FROM rooms WHERE active=1 ORDER BY sort_order, room_id").all().catch(()=>({results:[]})),
    env.DB.prepare(`SELECT * FROM room_period_summary WHERE event_day=? AND period_id=?`).bind(event_day, period_id).all().catch(()=>({results:[]})),
    env.DB.prepare(`SELECT * FROM room_device_status`).all().catch(()=>({results:[]}))
  ]);

  const sumMap = new Map((summary.results||[]).map(s=>[s.room_id, s]));
  const devMap = new Map((devices.results||[]).map(d=>[d.room_id, d]));

  const out = (rooms.results||[]).map(r => {
    const s = sumMap.get(r.room_id) || {};
    const d = devMap.get(r.room_id) || {};
    return {
      room_id: r.room_id,
      ok: s.ok_count||0, dup: s.dup_count||0, err: s.err_count||0,
      last_ts: s.last_ts, last_student: s.last_student_id, last_status: s.last_status,
      help: s.help_flag, support_type: s.support_type,
      hb: s.last_heartbeat, bat: d.battery_pct, online: d.online, scanning: d.scanning, 
      enabled: d.scanner_enabled, queue: d.queue_len 
    };
  });
  return json({ ok:true, period_id, event_day, is_testing: allowNoPeriod, rooms: out });
}

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(()=>({}));
  const room_id = String(body.room_id||"").trim();
  if (!room_id) return json({ ok:false }, 400);

  // Auto-create tables for safety
  try { await env.DB.prepare(`CREATE TABLE IF NOT EXISTS room_controls (room_id TEXT PRIMARY KEY, force_unlock INTEGER DEFAULT 0, scanner_enabled INTEGER DEFAULT 1, updated_ts TEXT, disable_message TEXT)`).run(); } catch(e){}
  try { await env.DB.prepare(`ALTER TABLE room_controls ADD COLUMN disable_message TEXT`).run(); } catch(e){}
  try { await env.DB.prepare(`CREATE TABLE IF NOT EXISTS room_device_status (room_id TEXT PRIMARY KEY, online INTEGER, battery_pct INTEGER, charging INTEGER, queue_len INTEGER, scanning INTEGER, scanner_enabled INTEGER DEFAULT 1, last_seen_ts TEXT, last_note TEXT)`).run(); } catch(e){}

  await env.DB.prepare("INSERT OR IGNORE INTO room_device_status (room_id, scanner_enabled) VALUES (?,1)").bind(room_id).run();
  await env.DB.prepare(`
    UPDATE room_device_status SET last_seen_ts=datetime('now'), online=?, battery_pct=?, charging=?, queue_len=?, scanning=? WHERE room_id=?
  `).bind(body.online?1:0, body.battery_pct, body.charging?1:0, body.queue_len||0, body.scanning?1:0, room_id).run();

  await env.DB.prepare(`UPDATE room_period_summary SET last_heartbeat=datetime('now') WHERE room_id=? AND event_day=(SELECT date('now','localtime'))`).bind(room_id).run().catch(()=>{});

  await env.DB.prepare(`INSERT OR IGNORE INTO room_controls (room_id) VALUES (?)`).bind(room_id).run();
  
  // FETCH the disable message to return to scanner
  const ctl = await env.DB.prepare("SELECT force_unlock, scanner_enabled, disable_message FROM room_controls WHERE room_id=?").bind(room_id).first();

  if (ctl && ctl.force_unlock === 1) {
    await env.DB.prepare("UPDATE room_controls SET force_unlock=0 WHERE room_id=?").bind(room_id).run();
  }

  return json({ ok:true, control: ctl || { force_unlock:0, scanner_enabled:1, disable_message:null } });
}

// --- AUTH LOGIC ---
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
