export async function onRequestPost({ request, env }) {
  const { user, err } = await requireAuth(request, env);
  if (err) return json({ ok:false, error:err }, 401);
  if (user.role !== "ADMIN") return json({ ok:false, error:"Forbidden" }, 403);

  const body = await request.json().catch(() => ({}));
  const room_id = String(body.room_id || "").trim();
  if (!room_id) return json({ ok:false, error:"room_required" }, 400);

  const action = String(body.action || "").trim(); // forceUnlock / enable / disable

  await env.DB.prepare(`
    INSERT OR IGNORE INTO room_controls (room_id, force_unlock, scanner_enabled, updated_ts)
    VALUES (?, 0, 1, datetime('now'))
  `).bind(room_id).run();

  if (action === "forceUnlock") {
    await env.DB.prepare(`
      UPDATE room_controls SET force_unlock=1, updated_ts=datetime('now') WHERE room_id=?
    `).bind(room_id).run();
  } else if (action === "disable") {
    await env.DB.prepare(`
      UPDATE room_controls SET scanner_enabled=0, updated_ts=datetime('now') WHERE room_id=?
    `).bind(room_id).run();

    await env.DB.prepare(`
      INSERT OR IGNORE INTO room_device_status (room_id, scanner_enabled)
      VALUES (?, 0)
    `).bind(room_id).run();
    await env.DB.prepare(`
      UPDATE room_device_status SET scanner_enabled=0 WHERE room_id=?
    `).bind(room_id).run();

  } else if (action === "enable") {
    await env.DB.prepare(`
      UPDATE room_controls SET scanner_enabled=1, force_unlock=0, updated_ts=datetime('now') WHERE room_id=?
    `).bind(room_id).run();

    await env.DB.prepare(`
      INSERT OR IGNORE INTO room_device_status (room_id, scanner_enabled)
      VALUES (?, 1)
    `).bind(room_id).run();
    await env.DB.prepare(`
      UPDATE room_device_status SET scanner_enabled=1 WHERE room_id=?
    `).bind(room_id).run();

  } else {
    return json({ ok:false, error:"bad_action" }, 400);
  }

  return json({ ok:true });
}

function json(data, status=200) {
  return new Response(JSON.stringify(data), { status, headers:{ "Content-Type":"application/json" } });
}

async function requireAuth(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const user = await verifyToken(env, token);
  if (!user) return { user:null, err:"Not logged in" };
  return { user, err:null };
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
