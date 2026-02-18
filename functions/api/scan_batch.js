import { json } from "./_middleware";
import { getNYParts, getActivePeriod } from "./_time";

export async function onRequestPost({ request, env }) {
  try {
    const DB = env.DB;
    if (!DB) return json({ ok:false, error:"DB_not_bound" }, 500);

    const body = await request.json().catch(() => null);
    if (!body || !body.room_id || !Array.isArray(body.items)) {
      return json({ ok:false, error:"bad_request" }, 400);
    }

    const room_id = String(body.room_id).trim();
    const items = body.items.slice(0, 10);

    const settings = await loadSettings(DB);
    const allowNoPeriod = String(settings.testingAllowNoPeriod || "true") === "true";

    const { event_day, hhmm } = getNYParts();
    const { period_id, scan_enabled } = await getActivePeriod(DB, hhmm, allowNoPeriod);

    // If scanning is disabled (eg lunch / after period 5), reject cleanly
    if (!scan_enabled && period_id !== "NO_PERIOD") {
      return json({ ok:false, error:"SCANNING_CLOSED", event_day, period_id }, 403);
    }

    // ensure summary row exists
    await DB.prepare(`
      INSERT OR IGNORE INTO room_period_summary (event_day, period_id, room_id)
      VALUES (?,?,?)
    `).bind(event_day, period_id, room_id).run();

    const results = [];

    for (const it of items) {
      const raw = String(it.qr_text || "").replace(/\u00A0/g, " ").trim();

      // Parse "NAME , ID , GRADE" OR allow ID-only
      let name = null;
      let student_id = null;
      let grade = null;

      const parts = raw.split(",").map(s => s.trim()).filter(s => s.length);
      if (parts.length >= 2) {
        name = parts[0] || null;
        student_id = parts[1] || null;
        if (parts[2] && /^\d{1,2}$/.test(parts[2])) grade = Number(parts[2]);
      } else {
        const m = raw.match(/\b(\d{9})\b/);
        if (m) student_id = m[1];
      }

      if (!/^\d{9}$/.test(student_id || "")) {
        results.push({ status:"error", student_id:null });
        await bumpSummary(DB, event_day, period_id, room_id, "err", null, null, null, "Invalid QR / missing 9-digit ID");
        continue;
      }

      try {
        await DB.prepare(`
          INSERT INTO scans
          (scan_id, event_day, period_id, room_id, student_id, grade, name, source_role)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'SCANNER')
        `).bind(
          crypto.randomUUID(),
          event_day, period_id, room_id,
          student_id, grade, name
        ).run();

        results.push({ status:"ok", student_id });
        await bumpSummary(DB, event_day, period_id, room_id, "ok", student_id, name, grade, null);

      } catch (e) {
        if (String(e).includes("UNIQUE")) {
          results.push({ status:"duplicate", student_id });
          await bumpSummary(DB, event_day, period_id, room_id, "dup", student_id, name, grade, "Duplicate scan");
        } else {
          results.push({ status:"error", student_id });
          await bumpSummary(DB, event_day, period_id, room_id, "err", student_id, name, grade, "DB insert error");
        }
      }
    }

    return json({ ok:true, event_day, period_id, results });

  } catch (err) {
    console.error("scan_batch error", err);
    return json({ ok:false, error:"server_error" }, 500);
  }
}

async function bumpSummary(DB, event_day, period_id, room_id, kind, studentId, name, grade, errorMsg) {
  const ok = kind === "ok" ? 1 : 0;
  const dup = kind === "dup" ? 1 : 0;
  const err = kind === "err" ? 1 : 0;

  // Try extended columns; fallback silently if not migrated yet
  try {
    await DB.prepare(`
      UPDATE room_period_summary
      SET ok_count = ok_count + ?,
          dup_count = dup_count + ?,
          err_count = err_count + ?,
          last_ts = datetime('now'),
          last_student_id = COALESCE(?, last_student_id),
          last_name = COALESCE(?, last_name),
          last_grade = COALESCE(?, last_grade),
          last_status = ?,
          last_error = ?,
          last_heartbeat = datetime('now')
      WHERE event_day=? AND period_id=? AND room_id=?
    `).bind(
      ok, dup, err,
      studentId,
      name,
      (typeof grade === "number" ? grade : null),
      kind,
      errorMsg || null,
      event_day, period_id, room_id
    ).run();
  } catch {
    await DB.prepare(`
      UPDATE room_period_summary
      SET ok_count = ok_count + ?,
          dup_count = dup_count + ?,
          err_count = err_count + ?,
          last_ts = datetime('now'),
          last_student_id = COALESCE(?, last_student_id),
          last_heartbeat = datetime('now')
      WHERE event_day=? AND period_id=? AND room_id=?
    `).bind(ok, dup, err, studentId, event_day, period_id, room_id).run();
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
