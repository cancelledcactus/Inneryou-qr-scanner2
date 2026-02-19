import { json } from "./_middleware";

export async function onRequestGet({ request, env }) {
  if (!await isAdmin(request, env)) return json({ ok:false, error:"Unauthorized" }, 401);
  
  const rows = await env.DB.prepare(
    "SELECT room_id, active, sort_order FROM rooms ORDER BY sort_order ASC, room_id ASC"
  ).all();

  return json({ ok:true, rooms: rows.results || [] });
}

export async function onRequestPost({ request, env }) {
  if (!await isAdmin(request, env)) return json({ ok:false, error:"Unauthorized" }, 401);

  const body = await request.json().catch(()=>({}));
  const { action } = body;

  if (action === "upsert") {
    const { room_id, active } = body;
    if (!room_id) return json({ ok:false, error:"Missing room_id" }, 400);

    // Keep existing sort_order if updating, else default 0
    const exist = await env.DB.prepare("SELECT sort_order FROM rooms WHERE room_id=?").bind(room_id).first();
    const sort = exist?.sort_order ?? 0;

    await env.DB.prepare(
      "INSERT OR REPLACE INTO rooms(room_id, active, sort_order) VALUES (?,?,?)"
    ).bind(room_id, active?1:0, sort).run();
  } 

  else if (action === "bulkUpsert") {
    const rooms = body.rooms || [];
    if (!rooms.length) return json({ ok:false }, 400);

    const stmts = rooms.map(r => 
      env.DB.prepare("INSERT OR REPLACE INTO rooms(room_id, active, sort_order) VALUES (?,?,?)")
      .bind(r.room_id, r.active?1:0, r.sort_order||0)
    );
    await env.DB.batch(stmts);
  } 

  else if (action === "delete") {
    await env.DB.prepare("DELETE FROM rooms WHERE room_id=?").bind(body.room_id).run();
  }

  return json({ ok:true });
}

// Auth Helper
async function isAdmin(req, env) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace("Bearer ", "");
  if (!token.includes(".")) return false;
  
  const [data, sig] = token.split(".");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.AUTH_SECRET), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]);
  const valid = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data))))).replace(/=+$/,"");
  
  return sig === valid; 
}
