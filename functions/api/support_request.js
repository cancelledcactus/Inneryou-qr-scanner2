import { json } from "./_middleware";

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  const room_id = String(body.room_id || "").trim();
  const support_type = String(body.support_type || "").trim(); // GENERAL / SCANNER
  const note = String(body.note || "").trim();

  if (!room_id) return json({ ok:false, error:"room_required" }, 400);
  if (support_type !== "GENERAL" && support_type !== "SCANNER") return json({ ok:false, error:"bad_support_type" }, 400);

  const { event_day, hhmm } = getNYParts();
  const period_id = await getCurrentPeriodId(env.DB, hhmm, true);

  const req_id = crypto.randomUUID();
  const created_ts = new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO support_requests
    (req_id, event_day, period_id, room_id, support_type, note, status, created_ts)
    VALUES (?,?,?,?,?,?, 'OPEN', ?)
  `).bind(req_id, event_day, period_id, room_id, support_type, note || null, created_ts).run();

  // mark room summary as needing help
  await env.DB.prepare(`
    INSERT OR IGNORE INTO room_period_summary (event_day, period_id, room_id)
    VALUES (?,?,?)
  `).bind(event_day, period_id, room_id).run();

  await env.DB.prepare(`
    UPDATE room_period_summary
    SET help_flag=1,
        support_type=?,
        support_ts=datetime('now')
    WHERE event_day=? AND period_id=? AND room_id=?
  `).bind(support_type, event_day, period_id, room_id).run();

  return json({ ok:true, req_id, event_day, period_id });
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
  return { event_day: `${parts.year}-${parts.month}-${parts.day}`, hhmm: `${parts.hour}:${parts.minute}` };
}

async function getCurrentPeriodId(db, ny_hhmm, allowNoPeriod) {
  const rows = await db.prepare("SELECT period_id, start_time, end_time FROM periods WHERE active=1 ORDER BY sort_order").all();
  for (const p of rows.results || []) if (p.start_time <= ny_hhmm && ny_hhmm < p.end_time) return p.period_id;
  return allowNoPeriod ? "NO_PERIOD" : null;
}
