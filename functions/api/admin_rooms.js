import { json } from "./_middleware";

export async function onRequestGet({ request, env }) {
  const { err } = await requireAdmin(request, env);
  if (err) return json({ ok:false, error: err }, 401);
  const rows = await env.DB.prepare("SELECT room_id, active, sort_order FROM rooms ORDER BY sort_order ASC, room_id ASC").all();
  return json({ ok:true, rooms: rows.results || [] });
}

export async function onRequestPost({ request, env }) {
  const { err } = await requireAdmin(request, env);
  if (err) return json({ ok:false, error: err }, 401);

  const body = await request.json().catch(()=>({}));
  const { action } = body;

  if (action === "upsert") {
    const { room_id, active } = body;
    const exist = await env.DB.prepare("SELECT sort_order FROM rooms WHERE room_id=?").bind(room_id).first();
    await env.DB.prepare("INSERT OR REPLACE INTO rooms(room_id, active, sort_order) VALUES (?,?,?)").bind(room_id, active ? 1 : 0, exist?.sort_order ?? 0).run();
  } 
  else if (action === "bulkUpsert") {
    const stmts = (body.rooms || []).map(r => env.DB.prepare("INSERT OR REPLACE INTO rooms(room_id, active, sort_order) VALUES (?,?,?)").bind(r.room_id, r.active ? 1 : 0, r.sort_order || 0));
    await env.DB.batch(stmts);
  } 
  else if (action === "delete") {
    await env.DB.prepare("DELETE FROM rooms WHERE room_id=?").bind(body.room_id).run();
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
