import { json } from "./_middleware";
import { getNYParts, getActivePeriod } from "./_time";

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    const room_id = String(body.room_id || "").trim();
    if (!room_id) return json({ ok:false, error:"room_required" }, 400);

    const settings = await loadSettings(env.DB);
    const allowNoPeriod = String(settings.testingAllowNoPeriod || "true") === "true";

    const { event_day, hhmm } = getNYParts();
    const { period_id } = await getActivePeriod(env.DB, hhmm, allowNoPeriod);

    // ensure summary row exists
    await env.DB.prepare(`
      INSERT OR IGNORE INTO room_period_summary (event_day, period_id, room_id)
      VALUES (?,?,?)
    `).bind(event_day, period_id, room_id).run();

    await env.DB.prepare(`
      UPDATE room_period_summary
      SET last_heartbeat = datetime('now')
      WHERE event_day=? AND period_id=? AND room_id=?
    `).bind(event_day, period_id, room_id).run();

    return json({ ok:true, event_day, period_id });

  } catch (e) {
    console.error("heartbeat error", e);
    return json({ ok:false, error:"server_error" }, 500);
  }
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
