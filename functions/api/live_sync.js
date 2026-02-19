import { json } from "./_middleware";
import { getNYParts, getActivePeriod } from "./_time";

export async function onRequestGet({ request, env }) {
  const auth = request.headers.get("Authorization")||"";
  // In prod, check auth here.
  const { hhmm, event_day } = getNYParts();
  
  const settings = await env.DB.prepare("SELECT key, value FROM settings").all();
  const allowNoPeriod = settings.results?.find(r=>r.key==="testingAllowNoPeriod")?.value !== "false";
  const { period_id } = await getActivePeriod(env.DB, hhmm, allowNoPeriod);

  const [rooms, summary, devices] = await Promise.all([
    env.DB.prepare("SELECT room_id FROM rooms WHERE active=1 ORDER BY sort_order, room_id").all(),
    env.DB.prepare(`SELECT * FROM room_period_summary WHERE event_day=? AND period_id=?`).bind(event_day, period_id).all(),
    env.DB.prepare(`SELECT * FROM room_device_status`).all()
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
      hb: s.last_heartbeat, bat: d.battery_pct, online: d.online, scanning: d.scanning, enabled: d.scanner_enabled
    };
  });
  return json({ ok:true, period_id, event_day, is_testing: allowNoPeriod, rooms: out });
}

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(()=>({}));
  const room_id = String(body.room_id||"").trim();
  if (!room_id) return json({ ok:false }, 400);

  await env.DB.prepare("INSERT OR IGNORE INTO room_device_status (room_id, scanner_enabled) VALUES (?,1)").bind(room_id).run();
  await env.DB.prepare(`
    UPDATE room_device_status SET last_seen_ts=datetime('now'), online=?, battery_pct=?, charging=?, queue_len=?, scanning=? WHERE room_id=?
  `).bind(body.online?1:0, body.battery_pct, body.charging?1:0, body.queue_len||0, body.scanning?1:0, room_id).run();

  await env.DB.prepare(`UPDATE room_period_summary SET last_heartbeat=datetime('now') WHERE room_id=? AND event_day=(SELECT date('now','localtime'))`).bind(room_id).run().catch(()=>{});

  const ctl = await env.DB.prepare("SELECT force_unlock, scanner_enabled FROM room_controls WHERE room_id=?").bind(room_id).first();
  return json({ ok:true, control: ctl || { force_unlock:0, scanner_enabled:1 } });
}
