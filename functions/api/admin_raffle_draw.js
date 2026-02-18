import { json } from "./_middleware";
import { getNYParts } from "./_time";

export async function onRequestPost({ request, env }) {
  const { err } = await requireAdmin(request, env);
  if (err) return json({ ok:false, error:err }, 401);

  const body = await request.json().catch(() => ({}));
  const n = Math.max(1, Math.min(20, Number(body.n || 1) || 1));
  const grade = body.grade;
  const gradeNum = grade !== undefined && grade !== null && /^\d{1,2}$/.test(String(grade)) ? Number(grade) : null;

  await ensureConfig(env.DB);
  const cfg = await env.DB.prepare(`SELECT min_distinct_periods FROM raffle_config WHERE id='default'`).first();
  const minp = cfg?.min_distinct_periods ?? 4;

  const { event_day } = getNYParts();

  // Use ORDER BY RANDOM() for D1
  const sql = gradeNum !== null ? `
    SELECT student_id, name, grade, COUNT(DISTINCT period_id) as periods
    FROM scans
    WHERE event_day=? AND grade=?
    GROUP BY student_id
    HAVING periods >= ?
    ORDER BY RANDOM()
    LIMIT ?
  ` : `
    SELECT student_id, name, grade, COUNT(DISTINCT period_id) as periods
    FROM scans
    WHERE event_day=?
    GROUP BY student_id
    HAVING periods >= ?
    ORDER BY RANDOM()
    LIMIT ?
  `;

  const rows = gradeNum !== null
    ? await env.DB.prepare(sql).bind(event_day, gradeNum, minp, n).all()
    : await env.DB.prepare(sql).bind(event_day, minp, n).all();

  return json({ ok:true, event_day, min_distinct_periods: minp, winners: rows.results || [] });
}

async function ensureConfig(DB) {
  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS raffle_config (
      id TEXT PRIMARY KEY,
      min_distinct_periods INTEGER DEFAULT 4
    )
  `).run();
  await DB.prepare(`INSERT OR IGNORE INTO raffle_config (id, min_distinct_periods) VALUES ('default', 4)`).run();
}

async function requireAdmin(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const user = await verifyToken(env, token);
  if (!user) return { err:"Not logged in" };
  if (user.role !== "ADMIN") return { err:"Forbidden" };
  return { err:null };
}

async function verifyToken(env, token) {
  if (!token || !token.includes(".")) return null;
  const [data, sig] = token.split(".");
  const expected = await hmac(env.AUTH_SECRET, data);
  if (sig !== expected) return null;
  try { return JSON.parse(decodeURIComponent(escape(atob(data)))); } catch { return null; }
}
async function hmac(secret, data) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=+$/g, "");
}
