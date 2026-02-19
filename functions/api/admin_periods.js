import { json } from "./_middleware";

export async function onRequestGet({ request, env }) {
  const { err } = await requireAdmin(request, env);
  if (err) return json({ ok:false, error: err }, 401);

  let rows;
  try {
    // Try fetching with the new columns (Linked Periods & Lunch)
    rows = await env.DB.prepare(
      "SELECT period_id, name, start_time, end_time, active, sort_order, group_id, scan_enabled FROM periods ORDER BY sort_order ASC, period_id ASC"
    ).all();
  } catch (e) {
    // FALLBACK: If columns don't exist yet, fetch the old way so the UI doesn't break
    rows = await env.DB.prepare(
      "SELECT period_id, name, start_time, end_time, active, sort_order FROM periods ORDER BY sort_order ASC, period_id ASC"
    ).all();
  }

  return json({ ok:true, periods: rows.results || [] });
}

export async function onRequestPost({ request, env }) {
  const { err } = await requireAdmin(request, env);
  if (err) return json({ ok:false, error: err }, 401);

  const body = await request.json().catch(()=>({}));
  const { action } = body;

  // AUTO-MIGRATION: Safely try to add the new columns if they are missing before writing data
  try { await env.DB.prepare("ALTER TABLE periods ADD COLUMN group_id TEXT").run(); } catch(e) {}
  try { await env.DB.prepare("ALTER TABLE periods ADD COLUMN scan_enabled INTEGER DEFAULT 1").run(); } catch(e) {}

  if (action === "upsert") {
    const p = body.period || {};
    const gid = p.group_id || p.period_id; 
    const scan = (p.scan_enabled === undefined) ? 1 : (p.scan_enabled ? 1 : 0);
    await env.DB.prepare(`INSERT OR REPLACE INTO periods(period_id, name, start_time, end_time, active, sort_order, group_id, scan_enabled) VALUES (?,?,?,?,?,?,?,?)`).bind(p.period_id, p.name, p.start_time, p.end_time, p.active?1:0, p.sort_order||0, gid, scan).run();
  } 
  else if (action === "bulkUpsert") {
    const stmts = (body.periods || []).map(p => {
      const gid = p.group_id || p.period_id;
      const scan = (p.scan_enabled === undefined) ? 1 : (p.scan_enabled ? 1 : 0);
      return env.DB.prepare(`INSERT OR REPLACE INTO periods(period_id, name, start_time, end_time, active, sort_order, group_id, scan_enabled) VALUES (?,?,?,?,?,?,?,?)`).bind(p.period_id, p.name, p.start_time, p.end_time, p.active?1:0, p.sort_order||0, gid, scan);
    });
    await env.DB.batch(stmts);
  } 
  else if (action === "delete") {
    await env.DB.prepare("DELETE FROM periods WHERE period_id=?").bind(body.period_id).run();
  }
  else if (action === "toggle") {
    const act = body.active ? 1 : 0;
    await env.DB.prepare("UPDATE periods SET active=? WHERE period_id=?").bind(act, body.period_id).run();
  }
  return json({ ok:true });
}

// --- AUTH LOGIC ---
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
