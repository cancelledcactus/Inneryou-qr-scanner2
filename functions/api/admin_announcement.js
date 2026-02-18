import { json } from "./_middleware";
import { getNYParts } from "./_time";

export async function onRequestPost({ request, env }) {
  const { err, user } = await requireAdmin(request, env);
  if (err) return json({ ok:false, error:err }, 401);

  const body = await request.json().catch(() => ({}));
  const message = String(body.message || "").trim();
  const level = String(body.level || "INFO").trim().toUpperCase();
  const active = body.active ? 1 : 0;

  if (!message) return json({ ok:false, error:"message_required" }, 400);
  if (level !== "INFO" && level !== "URGENT") return json({ ok:false, error:"bad_level" }, 400);

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY,
      message TEXT NOT NULL,
      level TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      created_ts TEXT NOT NULL
    )
  `).run();

  // deactivate old
  await env.DB.prepare(`UPDATE announcements SET active=0`).run();

  const id = crypto.randomUUID();
  const created_ts = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO announcements (id, message, level, active, created_ts)
    VALUES (?,?,?,?,?)
  `).bind(id, message, level, active, created_ts).run();

  const { event_day } = getNYParts();
  return json({ ok:true, event_day, id });
}

export async function onRequestDelete({ request, env }) {
  const { err } = await requireAdmin(request, env);
  if (err) return json({ ok:false, error:err }, 401);

  await env.DB.prepare(`UPDATE announcements SET active=0`).run();
  return json({ ok:true });
}

async function requireAdmin(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const user = await verifyToken(env, token);
  if (!user) return { err:"Not logged in", user:null };
  if (user.role !== "ADMIN") return { err:"Forbidden", user:null };
  return { err:null, user };
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
