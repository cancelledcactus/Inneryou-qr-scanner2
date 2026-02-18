import { json } from "./_middleware";

export async function onRequestGet({ request, env }) {
  const { user, err } = await requireAuth(request, env);
  if (err) return json({ ok:false, error:err }, 401);
  if (user.role !== "TECH" && user.role !== "ADMIN") return json({ ok:false, error:"Forbidden" }, 403);

  const url = new URL(request.url);
  const status = (url.searchParams.get("status") || "OPEN").toUpperCase();

  const { event_day, hhmm } = getNYParts();
  const period_id = await getCurrentPeriodId(env.DB, hhmm, true);

  const rows = await env.DB.prepare(`
    SELECT req_id, room_id, support_type, note, status, created_ts, resolved_ts, resolved_by
    FROM support_requests
    WHERE event_day=? AND period_id=? AND status=?
    ORDER BY created_ts DESC
    LIMIT 100
  `).bind(event_day, period_id, status).all();

  return json({ ok:true, event_day, period_id, items: rows.results || [] });
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

function getNYParts() {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]));
  return { event_day: `${parts.year}-${parts.month}-${parts.day}`, hhmm: `${parts.hour}:${parts.minute}` };
}
async function getCurrentPeriodId(db, ny_hhmm, allowNoPeriod) {
  const rows = await db.prepare("SELECT period_id, start_time, end_time FROM periods WHERE active=1 ORDER BY sort_order").all();
  for (const p of rows.results || []) if (p.start_time <= ny_hhmm && ny_hhmm < p.end_time) return p.period_id;
  return allowNoPeriod ? "NO_PERIOD" : null;
}
