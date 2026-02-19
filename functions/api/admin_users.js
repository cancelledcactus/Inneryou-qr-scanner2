import { json } from "./_middleware";

export async function onRequestGet({ request, env }) {
  const { err } = await requireAdmin(request, env);
  if (err) return json({ ok:false, error: err }, 401);

  const rows = await env.DB.prepare("SELECT id, role, active, name FROM users ORDER BY role ASC, id ASC").all();
  return json({ ok:true, users: rows.results || [] });
}

export async function onRequestPost({ request, env }) {
  const { err } = await requireAdmin(request, env);
  if (err) return json({ ok:false, error: err }, 401);

  const body = await request.json().catch(()=>({}));
  const { action } = body;

  if (action === "upsert") {
    const u = body.user || {};
    if (!/^\d{9}$/.test(u.id)) return json({ ok:false, error:"Bad ID" }, 400);
    await env.DB.prepare("INSERT OR REPLACE INTO users(id, role, active, name) VALUES (?,?,?,?)").bind(u.id, u.role, u.active ? 1 : 0, u.name).run();
  }
  else if (action === "delete") {
    await env.DB.prepare("DELETE FROM users WHERE id=?").bind(body.id).run();
  }
  else if (action === "toggle") {
    const act = body.active ? 1 : 0;
    await env.DB.prepare("UPDATE users SET active=? WHERE id=?").bind(act, body.id).run();
  }
  return json({ ok:true });
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
