import { json } from "./_middleware";
import { getNYParts, getActivePeriod } from "./_time";

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  const room_id = String(body.room_id || "").trim();
  const support_type = String(body.support_type || "").trim().toUpperCase();
  const note = String(body.note || "").trim();

  if (!room_id) return json({ ok:false, error:"room_required" }, 400);
  if (support_type !== "GENERAL" && support_type !== "SCANNER") return json({ ok:false, error:"bad_support_type" }, 400);

  const settings = await loadSettings(env.DB);
  const allowNoPeriod = String(settings.testingAllowNoPeriod || "true") === "true";

  const { event_day, hhmm } = getNYParts();
  const { period_id } = await getActivePeriod(env.DB, hhmm, allowNoPeriod);

  const req_id = crypto.randomUUID();
  const created_ts = new Date().toISOString();

  // Create table if missing (safe no-op if already exists)
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS support_requests (
      req_id TEXT PRIMARY KEY,
      event_day TEXT NOT NULL,
      period_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      support_type TEXT NOT NULL,
      note TEXT,
      status TEXT NOT NULL,
      created_ts TEXT NOT NULL,
      resolved_ts TEXT,
      resolved_by TEXT
    )
  `).run();

  await env.DB.prepare(`
    INSERT INTO support_requests
    (req_id, event_day, period_id, room_id, support_type, note, status, created_ts)
    VALUES (?,?,?,?,?,?, 'OPEN', ?)
  `).bind(req_id, event_day, period_id, room_id, support_type, note || null, created_ts).run();

  // Ensure summary row exists, then set help flag + type
  await env.DB.prepare(`
    INSERT OR IGNORE INTO room_period_summary (event_day, period_id, room_id)
    VALUES (?,?,?)
  `).bind(event_day, period_id, room_id).run();

  try {
    await env.DB.prepare(`
      UPDATE room_period_summary
      SET help_flag=1, support_type=?, support_ts=datetime('now')
      WHERE event_day=? AND period_id=? AND room_id=?
    `).bind(support_type, event_day, period_id, room_id).run();
  } catch {
    await env.DB.prepare(`
      UPDATE room_period_summary
      SET help_flag=1
      WHERE event_day=? AND period_id=? AND room_id=?
    `).bind(event_day, period_id, room_id).run();
  }

  return json({ ok:true, req_id, event_day, period_id });
}

async function loadSettings(DB) {
  try {
    const rows = await DB.prepare("SELECT key, value FROM settings").all();
    const out = {};
    for (const r of rows.results || []) out[r.key] = r.value;
    return out;
  } catch { return {}; }
}
