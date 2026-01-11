export async function onRequestPost({ request, env }) {
  try {
    const DB = env.DB;
    if (!DB) {
      return json({ ok:false, error:"DB not bound" }, 500);
    }

    const body = await request.json().catch(() => null);
    if (!body || !body.room_id || !Array.isArray(body.items)) {
      return json({ ok:false, error:"bad_request" }, 400);
    }

    const room_id = String(body.room_id);
    const items = body.items.slice(0, 10); // hard safety cap

    // event day (NY time safe enough for events)
    const now = new Date();
    const event_day = now.toISOString().slice(0,10);

    // Resolve active period (or NO_PERIOD)
    let period_id = "NO_PERIOD";
    const period = await DB.prepare(`
      SELECT period_id
      FROM periods
      WHERE active=1
        AND time('now','localtime') BETWEEN start_time AND end_time
      ORDER BY sort_order
      LIMIT 1
    `).first();

    if (period?.period_id) period_id = period.period_id;

    const results = [];

    for (const it of items) {
      const raw = String(it.qr_text || "").trim();

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
        continue;
      }

      try {
        await DB.prepare(`
          INSERT INTO scans
          (scan_id, event_day, period_id, room_id, student_id, grade, name, source_role)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'SCANNER')
        `).bind(
          crypto.randomUUID(),
          event_day,
          period_id,
          room_id,
          student_id,
          grade,
          name
        ).run();

        results.push({ status:"ok", student_id });

      } catch (e) {
        // Duplicate (unique index)
        if (String(e).includes("UNIQUE")) {
          results.push({ status:"duplicate", student_id });
        } else {
          results.push({ status:"error", student_id });
        }
      }
    }

    return json({
      ok: true,
      period_id,
      results
    });

  } catch (err) {
    console.error("scan_batch error", err);
    return json({ ok:false, error:"server_error" }, 500);
  }
}

function json(obj, status=200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type":"application/json" }
  });
}
