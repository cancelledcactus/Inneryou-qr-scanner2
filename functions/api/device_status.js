export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));

  const room_id = String(body.room_id || "").trim();
  if (!room_id) return json({ ok:false, error:"room_required" }, 400);

  const online = body.online ? 1 : 0;
  const battery_pct = Number.isFinite(Number(body.battery_pct)) ? Math.max(0, Math.min(100, Number(body.battery_pct))) : null;
  const charging = body.charging ? 1 : 0;
  const queue_len = Number.isFinite(Number(body.queue_len)) ? Math.max(0, Number(body.queue_len)) : 0;
  const scanning = body.scanning ? 1 : 0;
  const note = String(body.note || "").slice(0, 120);

  // ensure row exists
  await env.DB.prepare(`
    INSERT OR IGNORE INTO room_device_status (room_id, scanner_enabled)
    VALUES (?, 1)
  `).bind(room_id).run();

  await env.DB.prepare(`
    UPDATE room_device_status
    SET last_seen_ts = datetime('now'),
        online = ?,
        battery_pct = ?,
        charging = ?,
        queue_len = ?,
        scanning = ?,
        last_note = ?
    WHERE room_id = ?
  `).bind(online, battery_pct, charging, queue_len, scanning, note || null, room_id).run();

  // return current controls so scanner can react without extra request
  await env.DB.prepare(`
    INSERT OR IGNORE INTO room_controls (room_id, force_unlock, scanner_enabled, updated_ts)
    VALUES (?, 0, 1, datetime('now'))
  `).bind(room_id).run();

  const ctl = await env.DB.prepare(`
    SELECT force_unlock, scanner_enabled FROM room_controls WHERE room_id=?
  `).bind(room_id).first();

  return json({ ok:true, control: ctl || { force_unlock:0, scanner_enabled:1 } });
}

function json(data, status=200) {
  return new Response(JSON.stringify(data), { status, headers:{ "Content-Type":"application/json" } });
}
