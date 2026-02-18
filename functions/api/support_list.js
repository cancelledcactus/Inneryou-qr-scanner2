import { json } from "./_middleware";
import { getNYParts, getActivePeriod } from "./_time";

export async function onRequestGet({ request, env }) {
  const { err, user } = await requireTechOrAdmin(request, env);
  if (err) return json({ ok:false, error:err }, 401);

  const url = new URL(request.url);
  const status = String(url.searchParams.get("status") || "OPEN").toUpperCase();
  if (status !== "OPEN" && status !== "RESOLVED") return json({ ok:false, error:"bad_status" }, 400);

  const settings = await loadSettings(env.DB);
  const allowNoPeriod = String(settings.testingAllowNoPeriod || "true") === "true";

  const { event_day, hhmm } = getNYParts();
  const { period_id } = await getActivePeriod(env.DB, hhmm, allowNoPeriod);

  const rows = await env.DB.prepare(`
    SELECT req_id, room_id, support_type, note, status, created_ts, resolved_ts, resolved_by
    FROM support_requests
    WHERE event_day=? AND period_id=? AND status=?
    ORDER BY created_ts DESC
    LIMIT 200
  `).bind(event_day, period_id, status).all().catch(() => ({ results: [] }));

  return json({ ok:true, event_day, period_id, items: rows.results || [] });
}

async function loadSettings(DB) {
  try {
    const rows = await DB.prepare("SELECT key, value FROM settings").all();
    const out = {};
    for (const r of rows.results || []) out[r.key] = r.value;
    return out;
  } catch { return {}; }
}

async function requireTechOrAdmin(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const user = await verifyToken(env, token);
  if (!user) return { err:"Not logged in", user:null };
  if (user.role !== "TECH" && user.role !== "ADMIN") return { err:"Forbidden", user:null };
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
