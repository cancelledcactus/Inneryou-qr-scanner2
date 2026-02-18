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

    const event_day = new Date().toISOString().slice(0, 10);
    const period_id = await getCurrentPeriodId(DB, "America/New_York");

    // ensure summary row exists
    await DB.prepare(`
      INSERT OR IGNORE INTO room_period_summary (event_day, period_id, room_id)
      VALUES (?,?,?)
    `).bind(event_day, period_id, room_id).run();

    const results = [];

    for (const it of items) {
      const raw = String(it.qr_text || "").replace(/\u00A0/g, " ").trim();

      // Parse "NAME , ID , GRADE"
      const parts = raw.split(",").map(s => s.trim());
      let name = null;
      let student_id = null;
      let grade = null;

      if (parts.length >= 2) {
        name = parts[0] || null;
        student_id = parts[1] || null;
        if (parts[2] && /^\d{1,2}$/.test(parts[2])) grade = Number(parts[2]);
      }

      if (!/^\d{9}$/.test(student_id || "")) {
        results.push({ status:"error", student_id:null });
        await bumpSummary(DB, event_day, period_id, room_id, "err", null);
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
        await bumpSummary(DB, event_day, period_id, room_id, "ok", student_id);

      } catch (e) {
        if (String(e).includes("UNIQUE")) {
          results.push({ status:"duplicate", student_id });
          await bumpSummary(DB, event_day, period_id, room_id, "dup", student_id);
        } else {
          results.push({ status:"error", student_id });
          await bumpSummary(DB, event_day, period_id, room_id, "err", student_id);
        }
      }
    }

    return json({ ok:true, period_id, results });

  } catch (err) {
    console.error("scan_batch error", err);
    return json({ ok:false, error:"server_error" }, 500);
  }
}

async function bumpSummary(DB, event_day, period_id, room_id, kind, studentId, name, grade, errorMsg) {
  const ok = kind === "ok" ? 1 : 0;
  const dup = kind === "dup" ? 1 : 0;
  const err = kind === "err" ? 1 : 0;

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
}


// timezone-safe "HH:MM" using Intl (Cloudflare runs in UTC otherwise)
async function getCurrentPeriodId(DB, tz) {
  const rows = await DB.prepare(`
    SELECT period_id, start_time, end_time
    FROM periods
    WHERE active=1
    ORDER BY sort_order ASC
  `).all();

  const cur = getTimeHHMM(tz); // "09:12"
  for (const p of rows.results || []) {
    if (p.start_time <= cur && cur < p.end_time) return p.period_id;
  }
  return "NO_PERIOD";
}

function getTimeHHMM(tz) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit"
  });
  const parts = fmt.formatToParts(new Date());
  const hh = parts.find(p => p.type === "hour")?.value ?? "00";
  const mm = parts.find(p => p.type === "minute")?.value ?? "00";
  return `${hh}:${mm}`;
}

function json(obj, status=200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type":"application/json" }
  });
}
