import { json } from "./_middleware";
import { getNYParts } from "./_time";

export async function onRequestGet({ request, env }) {
  const { err } = await requireTechOrAdmin(request, env);
  if (err) return json({ ok:false, error: err }, 401);

  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "OPEN";
  const { event_day } = getNYParts();

  const rows = await env.DB.prepare(`
    SELECT req_id, room_id, support_type, note, status, created_ts, resolved_ts, resolved_by
    FROM support_requests
    WHERE event_day = ? AND status = ?
    ORDER BY created_ts DESC
  `).bind(event_day, status).all();

  return json({ ok:true, items: rows.results || [] });
}

async function requireTechOrAdmin(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const user = await verifyToken(env, token);
  if (!user) return { err:"Not logged in" };
  if (user.role !== "ADMIN" && user.role !== "TECH") return { err:"Forbidden" };
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
