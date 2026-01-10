import { json } from "./_middleware";

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  const id = String(body?.id || "").trim();

  if (!/^\d{9}$/.test(id)) return json({ ok: false, error: "Invalid ID" }, 400);

  const user = await env.DB.prepare(
    "SELECT id, role, active, name FROM users WHERE id = ?"
  ).bind(id).first();

  if (!user || !user.active) return json({ ok: false, error: "Access denied" }, 403);

  const settings = await getSettings(env.DB);
  const idleTimeoutMs = Number(settings.idleTimeoutMs || 300000);

  const token = await signToken(env, {
    id: user.id,
    role: user.role,
    iat: Date.now(),
  });

  return json({
    ok: true,
    token,
    role: user.role,
    name: user.name || "",
    idleTimeoutMs,
  });
}

async function getSettings(db) {
  const rows = await db.prepare("SELECT key, value FROM settings").all();
  const out = {};
  for (const r of rows.results || []) out[r.key] = r.value;
  return out;
}

// Very small JWT-like token
async function signToken(env, payload) {
  const secret = await getSecret(env);
  const data = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  const sig = await hmac(secret, data);
  return `${data}.${sig}`;
}

async function hmac(secret, data) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=+$/g, "");
}

async function getSecret(env) {
  // Set AUTH_SECRET as an environment variable in Cloudflare Pages project settings.
  if (!env.AUTH_SECRET) throw new Error("Missing AUTH_SECRET");
  return env.AUTH_SECRET;
}
