import { json } from "./_middleware";

export async function onRequestGet({ request, env }) {
  if (!await isAdmin(request, env)) return json({ ok:false, error:"Unauthorized" }, 401);

  // Fetch all fields including group_id and scan_enabled
  const rows = await env.DB.prepare(
    "SELECT period_id, name, start_time, end_time, active, sort_order, group_id, scan_enabled FROM periods ORDER BY sort_order ASC, period_id ASC"
  ).all();

  return json({ ok:true, periods: rows.results || [] });
}

export async function onRequestPost({ request, env }) {
  if (!await isAdmin(request, env)) return json({ ok:false, error:"Unauthorized" }, 401);

  const body = await request.json().catch(()=>({}));
  const { action } = body;

  if (action === "upsert") {
    const p = body.period || {};
    if (!p.period_id) return json({ ok:false, error:"Missing ID" }, 400);

    // Default group_id to self if not provided
    const gid = p.group_id || p.period_id;
    // Default scan_enabled to 1 (true) if not provided
    const scan = (p.scan_enabled === undefined) ? 1 : (p.scan_enabled ? 1 : 0);

    await env.DB.prepare(
      `INSERT OR REPLACE INTO periods(period_id, name, start_time, end_time, active, sort_order, group_id, scan_enabled) 
       VALUES (?,?,?,?,?,?,?,?)`
    ).bind(p.period_id, p.name, p.start_time, p.end_time, p.active?1:0, p.sort_order||0, gid, scan).run();
  } 

  else if (action === "bulkUpsert") {
    const periods = body.periods || [];
    if (!periods.length) return json({ ok:false }, 400);

    const stmts = periods.map(p => {
      const gid = p.group_id || p.period_id;
      const scan = (p.scan_enabled === undefined) ? 1 : (p.scan_enabled ? 1 : 0);
      
      return env.DB.prepare(
        `INSERT OR REPLACE INTO periods(period_id, name, start_time, end_time, active, sort_order, group_id, scan_enabled) 
         VALUES (?,?,?,?,?,?,?,?)`
      ).bind(p.period_id, p.name, p.start_time, p.end_time, p.active?1:0, p.sort_order||0, gid, scan);
    });
    await env.DB.batch(stmts);
  } 

  else if (action === "delete") {
    await env.DB.prepare("DELETE FROM periods WHERE period_id=?").bind(body.period_id).run();
  }

  return json({ ok:true });
}

async function isAdmin(req, env) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace("Bearer ", "");
  if (!token.includes(".")) return false;
  
  const [data, sig] = token.split(".");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.AUTH_SECRET), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]);
  const valid = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data))))).replace(/=+$/,"");
  
  return sig === valid; 
}
