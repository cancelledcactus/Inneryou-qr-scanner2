import { json } from "./_middleware";

export async function onRequestPost({ request, env }) {
  const { user, err } = await requireAuth(request, env);
  if (err) return json({ ok: false, error: err }, 401);

  const body = await request.json().catch(() => ({}));
  const room_id = String(body?.room_id || "").trim();
  const items = Array.isArray(body?.items) ? body.items : [];

  if (!room_id) return json({ ok: false, error: "Missing room_id" }, 400);
  if (items.length < 1 || items.length > 5) return json({ ok: false, error: "items must be 1..5" }, 400);

  const settings = await getSettings(env.DB);
  const testingAllowNoPeriod = String(settings.testingAllowNoPeriod || "true") === "true";

  const event_day = new Date().toISOString().slice(0, 10); // yyyy-mm-dd (UTC)
  // NOTE: for exact America/New_York day boundaries, we can adjust; for event use it’s fine.
  const period_id = await getCurrentPeriodId(env.DB, testingAllowNoPeriod);

  // Prepare summary row ensure
  await ensureSummaryRow(env.DB, event_day, period_id, room_id);

  const results = [];
  const nowIso = new Date().toISOString();

  // Use a transaction for speed
  const statements = [];

  for (const raw of items) {
    const qr_text = String(raw?.qr_text || "").trim();
    const manual = !!raw?.manual;

    const parsed = parseBadge(qr_text);
    if (!parsed.student_id) {
      results.push({ ok: false, status: "error", message: "Bad QR (missing 9-digit ID)" });
      statements.push(env.DB.prepare(
        "UPDATE room_period_summary SET err_count = err_count + 1, last_ts = ?, last_student_id = NULL WHERE event_day=? AND period_id=? AND room_id=?"
      ).bind(nowIso, event_day, period_id, room_id));
      continue;
    }

    const scan_id = crypto.randomUUID();
    const student_id = parsed.student_id;
    const grade = parsed.grade ?? null;
    const name = parsed.name ?? null;

    // Insert scan (duplicate caught by unique index)
    const insertStmt = env.DB.prepare(
      `INSERT INTO scans (scan_id, event_day, period_id, room_id, student_id, grade, name, ts, source_role)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind(scan_id, event_day, period_id, room_id, student_id, grade, name, nowIso, user.role);

    // We can’t know if it will duplicate until it runs, so we’ll execute per-item with try/catch inside transaction style.
    // D1 doesn't support try/catch inside SQL, so we do sequentially but still few items.

    results.push({ ok: true, status: "pending", student_id, grade, name, manual });
    statements.push({ insertStmt, student_id });
  }

  // Execute inserts sequentially to classify duplicates correctly
  const finalResults = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (!r.ok || r.status === "error") {
      finalResults.push(r);
      continue;
    }
    const stmtObj = statements.shift();
    const insertStmt = stmtObj.insertStmt;
    const sid = stmtObj.student_id;

    try {
      await insertStmt.run();
      await env.DB.prepare(
        "UPDATE room_period_summary SET ok_count = ok_count + 1, last_ts = ?, last_student_id = ? WHERE event_day=? AND period_id=? AND room_id=?"
      ).bind(nowIso, sid, event_day, period_id, room_id).run();

      finalResults.push({ ok: true, status: "ok", student_id: sid });
    } catch (e) {
      const msg = String(e || "");
      const isDup = msg.toLowerCase().includes("unique") || msg.toLowerCase().includes("constraint");
      if (isDup) {
        await env.DB.prepare(
          "UPDATE room_period_summary SET dup_count = dup_count + 1, last_ts = ?, last_student_id = ? WHERE event_day=? AND period_id=? AND room_id=?"
        ).bind(nowIso, sid, event_day, period_id, room_id).run();

        finalResults.push({ ok: true, status: "duplicate", student_id: sid });
      } else {
        await env.DB.prepare(
          "UPDATE room_period_summary SET err_count = err_count + 1, last_ts = ?, last_student_id = ? WHERE event_day=? AND period_id=? AND room_id=?"
        ).bind(nowIso, sid, event_day, period_id, room_id).run();

        finalResults.push({ ok: false, status: "error", student_id: sid, message: "Server error" });
      }
    }
  }

  return json({ ok: true, event_day, period_id, room_id, results: finalResults });
}

function parseBadge(text) {
  // Accept: "NAME , 236821666 , 11"
  // Extract first 9-digit sequence; last 1-2 digits (grade) if present.
  const t = String(text || "").trim();
  const idMatch = t.match(/\b(\d{9})\b/);
  if (!idMatch) return { student_id: null };

  const student_id = idMatch[1];
  const before = t.slice(0, idMatch.index).replace(/[,\|]+/g, " ").trim();
  const after = t.slice(idMatch.index + student_id.length).trim();

  // grade: try last number 1-2 digits
  let grade = null;
  const gradeMatch = after.match(/\b(\d{1,2})\b(?!.*\b\d{1,2}\b)/);
  if (gradeMatch) grade = Number(gradeMatch[1]);

  const name = before ? before.toUpperCase() : null;
  return { student_id, name, grade };
}

async function getSettings(db) {
  const rows = await db.prepare("SELECT key, value FROM settings").all();
  const out = {};
  for (const r of rows.results || []) out[r.key] = r.value;
  return out;
}

async function getCurrentPeriodId(db, allowNoPeriod) {
  const rows = await db.prepare(
    "SELECT period_id, start_time, end_time FROM periods WHERE active = 1 ORDER BY sort_order ASC"
  ).all();

  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const cur = `${hh}:${mm}`;

  for (const p of rows.results || []) {
    if (p.start_time <= cur && cur < p.end_time) return p.period_id;
  }
  return allowNoPeriod ? "NO_PERIOD" : null;
}

async function ensureSummaryRow(db, event_day, period_id, room_id) {
  if (!period_id) throw new Error("No active period");
  await db.prepare(
    `INSERT OR IGNORE INTO room_period_summary (event_day, period_id, room_id)
     VALUES (?,?,?)`
  ).bind(event_day, period_id, room_id).run();
}

async function requireAuth(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const user = await verifyToken(env, token);
  if (!user) return { user: null, err: "Not logged in" };
  return { user, err: null };
}

async function verifyToken(env, token) {
  if (!token || !token.includes(".")) return null;
  const [data, sig] = token.split(".");
  if (!env.AUTH_SECRET) return null;

  const expected = await hmac(env.AUTH_SECRET, data);
  if (sig !== expected) return null;

  try { return JSON.parse(decodeURIComponent(escape(atob(data)))); } catch { return null; }
}

async function hmac(secret, data) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=+$/g, "");
}
