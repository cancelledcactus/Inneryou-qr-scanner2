import { json } from "./_middleware";
import { getNYParts, getActivePeriod } from "./_time";

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(()=>({}));
  const { action } = body;
  const { event_day, hhmm } = getNYParts();

  if (action === "scan") {
    const room = (await env.DB.prepare("SELECT room_id FROM rooms ORDER BY RANDOM() LIMIT 1").first())?.room_id || "Room 101";
    const { period_id } = await getActivePeriod(env.DB, hhmm, true);
    await env.DB.prepare("INSERT INTO scans (scan_id, event_day, period_id, room_id, student_id, source_role) VALUES (?,?,?,?,?,'TEST')").bind(crypto.randomUUID(), event_day, period_id, room, "123456789").run();
    await env.DB.prepare("INSERT OR IGNORE INTO room_period_summary (event_day, period_id, room_id) VALUES (?,?,?)").bind(event_day, period_id, room).run();
    await env.DB.prepare("UPDATE room_period_summary SET ok_count=ok_count+1, last_ts=datetime('now'), last_status='ok' WHERE event_day=? AND period_id=? AND room_id=?").bind(event_day, period_id, room).run();
    return json({ ok:true, msg:`Simulated scan in ${room}` });
  }

  if (action === "device") {
    const room = (await env.DB.prepare("SELECT room_id FROM rooms ORDER BY RANDOM() LIMIT 1").first())?.room_id || "Room 101";
    await env.DB.prepare("INSERT OR IGNORE INTO room_device_status (room_id, scanner_enabled) VALUES (?,1)").bind(room).run();
    await env.DB.prepare("UPDATE room_device_status SET online=1, battery_pct=88, last_seen_ts=datetime('now') WHERE room_id=?").bind(room).run();
    return json({ ok:true, msg:`Simulated device in ${room}` });
  }
  
  if (action === "support") {
    const room = (await env.DB.prepare("SELECT room_id FROM rooms ORDER BY RANDOM() LIMIT 1").first())?.room_id || "Room 101";
    await env.DB.prepare("INSERT INTO support_requests (req_id, event_day, period_id, room_id, support_type, status, created_ts) VALUES (?,?,'TEST',?,'GENERAL','OPEN',datetime('now'))").bind(crypto.randomUUID(), event_day, room).run();
    return json({ ok:true, msg:`Simulated ticket in ${room}` });
  }

  return json({ ok:false }, 400);
}
