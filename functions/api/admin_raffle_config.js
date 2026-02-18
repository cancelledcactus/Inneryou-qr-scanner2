import { json } from "./_middleware";

export async function onRequestGet({ request, env }) {
  const { err } = await requireAdmin(request, env);
  if (err) return json({ ok:false, error:err }, 401);

  await ensureTables(env.DB);
  const row = await env.DB.prepare(`SELECT min_distinct_periods FROM raffle_config WHERE id='default'`).first();
  return json({ ok:true, min_distinct_periods: row?.min_distinct_periods ?? 4 });
}

export async function onRequestPost({ request, env }) {
  const { err } = await requireAdmin(request, env);
  if (err) return json({ ok:false, error:err }, 401);

  const body = await request.json().catch(() => ({}));
  const v = Number(body.min_distinct_periods ?? 4);
  const min_distinct_periods = Math.max(1, Math.min(10, isFinite(v) ? v : 4));

  await ensureTables(env.DB);
  await env.DB.prepare(`
    INSERT INTO raffle_config (id, min_distinct_periods)
    VALUES ('default', ?)
    ON CONFLICT(id) DO UPDATE SET min_distinct_periods=excluded.min_distinct_periods
  `).bind(min_distinct_periods).run();

  return json({ ok:true, min_distinct_periods });
}

async function ensureTables(DB) {
  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS raffle_config (
      id TEXT PRIMARY KEY,
      min_distinct_periods INTEGER DEFAULT 4
    )
  `).run();
  await DB.prepare(`
    INSERT OR IGNORE INTO raffle_config (id, min_distinct_periods)
    VALUES ('default', 4)
  `).run();
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
