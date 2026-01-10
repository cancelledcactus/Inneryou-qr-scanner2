import { json } from "./_middleware";

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  const room_id = String(body.room_id || "").trim();
  if (!room_id) return json({ ok:false, error:"Missing room_id" }, 400);

  const event_day = new Date().toISOString().slice(0, 10);

  // period_id is best-effort (NO_PERIOD allowed if none)
  const period_id = await getCurrentPeriodId(env.DB);

  await env.DB.prepare(
    `INSERT OR IGNORE INTO room_period_summary (event_day, period_id, room_id)
     VALUES (?,?,?)`
  ).bind(event_day, period_id, room_id).run();

  await env.DB.prepare(
    `UPDATE room_period_summary
     SET last_heartbeat = datetime('now')
     WHERE event_day=? AND period_id=? AND room_id=?`
  ).bind(event_day, period_id, room_id).run();

  return json({ ok:true, event_day, period_id });
}

async function getCurrentPeriodId(db) {
  const rows = await db.prepare(
    "SELECT period_id, start_time, end_time FROM periods WHERE active=1 ORDER BY sort_order ASC"
  ).all();

  const now = new Date();
  const cur = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;

  for (const p of rows.results || []) {
    if (p.start_time <= cur && cur < p.end_time) return p.period_id;
  }
  return "NO_PERIOD";
}
