import { json } from "./_middleware";

export async function onRequestGet({ request, env }) {
  const { user, err } = await requireAdmin(request, env);
  if (err) return json({ ok:false, error: err }, 401);

  const settings = await getSettings(env.DB);
  return json({ ok:true, settings });
}

export async function onRequestPost({ request, env }) {
  const { user, err } = await requireAdmin(request, env);
  if (err) return json({ ok:false, error: err }, 401);

  const body = await request.json().catch(()=> ({}));
  const updates = {
    idleTimeoutMs: String(body.idleTimeoutMs ?? ""),
    testingAllowNoPeriod: String(body.testingAllowNoPeriod ?? ""),
    batchSize: String(body.batchSize ?? ""),
    flushIntervalMs: String(body.flushIntervalMs ?? "")
  };

  // minimal validation
  if (!/^\d+$/.test(updates.idleTimeoutMs)) return json({ ok:false, error:"Bad idleTimeoutMs" }, 400);
  if (!["true","false"].includes(updates.testingAllowNoPeriod)) return json({ ok:false, error:"Bad testingAllowNoPeriod" }, 400);
  if (!/^\d+$/.test(updates.batchSize)) return json({ ok:false, error:"Bad batchSize" }, 400);
  if (!/^\d+$/.test(updates.flushIntervalMs)) return json({ ok:false, error:"Bad flushIntervalMs" }, 400);

  await env.DB.batch([
    env.DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES ('idleTimeoutMs', ?)").bind(updates.idleTimeoutMs),
    env.DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES ('testingAllowNoPeriod', ?)").bind(updates.testingAllowNoPeriod),
    env.DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES ('batchSize', ?)").bind(updates.batchSize),
    env.DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES ('flushIntervalMs', ?)").bind(updates.flushIntervalMs),
  ]);

  return json({ ok:true });
}

async function getSettings(db) {
  const rows = await db.prepare("SELECT key, value FROM settings").all();
  const out = {};
  for (const r of rows.results || []) out[r.key] = r.value;
  return out;
}

async function requireAdmin(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const user = await verifyToken(env, token);
  if (!user) return { user:null, err:"Not logged in" };
  if (user.role !== "ADMIN") return { user, err:"Forbidden" };
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
