import { json } from "./_middleware";

export async function onRequestGet({ request, env }) {
  const { err } = await requireAdmin(request, env);
  if (err) return json({ ok:false, error: err }, 401);

  const rows = await env.DB.prepare(
    "SELECT room_id, active, sort_order FROM rooms ORDER BY sort_order ASC, room_id ASC"
  ).all();

  return json({ ok:true, rooms: rows.results || [] });
}

export async function onRequestPost({ request, env }) {
  const { err } = await requireAdmin(request, env);
  if (err) return json({ ok:false, error: err }, 401);

  const body = await request.json().catch(()=> ({}));
  const action = String(body.action || "");

  if (action === "upsert") {
    const room_id = String(body.room_id || "").trim();
    const active = Number(body.active ?? 1) ? 1 : 0;
    if (!room_id) return json({ ok:false, error:"Missing room_id" }, 400);

    const existing = await env.DB.prepare("SELECT sort_order FROM rooms WHERE room_id=?").bind(room_id).first();
    const sort_order = existing?.sort_order ?? 0;

    await env.DB.prepare(
      "INSERT OR REPLACE INTO rooms(room_id, active, sort_order) VALUES (?,?,?)"
    ).bind(room_id, active, sort_order).run();

    return json({ ok:true });
  }

  if (action === "bulkUpsert") {
    const rooms = Array.isArray(body.rooms) ? body.rooms : [];
    if (rooms.length < 1) return json({ ok:false, error:"No rooms" }, 400);

    const stmts = rooms.map(r => {
      const room_id = String(r.room_id || "").trim();
      const active = Number(r.active ?? 1) ? 1 : 0;
      const sort_order = Number(r.sort_order ?? 0);
      if (!room_id) throw new Error("Room missing room_id");
      return env.DB.prepare("INSERT OR REPLACE INTO rooms(room_id, active, sort_order) VALUES (?,?,?)")
        .bind(room_id, active, sort_order);
    });

    await env.DB.batch(stmts);
    return json({ ok:true, count: rooms.length });
  }

  if (action === "delete") {
    const room_id = String(body.room_id || "").trim();
    if (!room_id) return json({ ok:false, error:"Missing room_id" }, 400);
    await env.DB.prepare("DELETE FROM rooms WHERE room_id=?").bind(room_id).run();
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
