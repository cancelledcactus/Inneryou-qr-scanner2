import { json } from "./_middleware";

export async function onRequestGet({ request, env }) {
  const { err } = await requireAdmin(request, env);
  if (err) return json({ ok:false, error: err }, 401);

  const rows = await env.DB.prepare(
    "SELECT id, role, active, name FROM users ORDER BY role ASC, id ASC"
  ).all();

  return json({ ok:true, users: rows.results || [] });
}

export async function onRequestPost({ request, env }) {
  const { err } = await requireAdmin(request, env);
  if (err) return json({ ok:false, error: err }, 401);

  const body = await request.json().catch(()=> ({}));
  const action = String(body.action || "");

  if (action === "upsert") {
    const u = body.user || {};
    const id = String(u.id || "").trim();
    const role = String(u.role || "").trim();
    const active = Number(u.active ?? 1) ? 1 : 0;
    const name = String(u.name || "").trim();

    if (!/^\d{9}$/.test(id)) return json({ ok:false, error:"Bad id" }, 400);
    if (!["ADMIN","TECH"].includes(role)) return json({ ok:false, error:"Bad role" }, 400);

    await env.DB.prepare(
      "INSERT OR REPLACE INTO users(id,role,active,name) VALUES (?,?,?,?)"
    ).bind(id, role, active, name).run();

    return json({ ok:true });
  }

  if (action === "toggle") {
    const id = String(body.id || "").trim();
    const active = Number(body.active ?? 1) ? 1 : 0;
    if (!/^\d{9}$/.test(id)) return json({ ok:false, error:"Bad id" }, 400);
    await env.DB.prepare("UPDATE users SET active=? WHERE id=?").bind(active, id).run();
    return json({ ok:true });
  }

  if (action === "delete") {
    const id = String(body.id || "").trim();
    if (!/^\d{9}$/.test(id)) return json({ ok:false, error:"Bad id" }, 400);
    await env.DB.prepare("DELETE FROM users WHERE id=?").bind(id).run();
    return json({ ok:true });
  }

  return json({ ok:false, error:"Unknown action" }, 400);
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
