import { json } from "./_middleware";

export async function onRequestPost({ request, env }) {
  const { err, user } = await requireTechOrAdmin(request, env);
  if (err) return json({ ok:false, error: err }, 401);

  const body = await request.json().catch(()=>({}));
  const req_id = body.req_id;
  if (!req_id) return json({ ok:false }, 400);

  const row = await env.DB.prepare("SELECT event_day, room_id FROM support_requests WHERE req_id=?").bind(req_id).first();
  if (!row) return json({ ok:false }, 404);

  await env.DB.prepare(`
    UPDATE support_requests SET status='RESOLVED', resolved_ts=datetime('now'), resolved_by=? WHERE req_id=?
  `).bind(user.id, req_id).run();

  // If no open requests left, clear the room's help flag
  const openLeft = await env.DB.prepare("SELECT COUNT(*) as c FROM support_requests WHERE event_day=? AND room_id=? AND status='OPEN'").bind(row.event_day, row.room_id).first();
  if (openLeft?.c === 0) {
    await env.DB.prepare("UPDATE room_period_summary SET help_flag=0, support_type=NULL WHERE event_day=? AND room_id=?").bind(row.event_day, row.room_id).run();
  }

  return json({ ok:true });
}

async function requireTechOrAdmin(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const user = await verifyToken(env, token);
  if (!user) return { err:"Not logged in", user:null };
  if (user.role !== "ADMIN" && user.role !== "TECH") return { err:"Forbidden", user:null };
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
