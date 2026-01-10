import { json } from "./_middleware";

export async function onRequestGet({ request, env }) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const payload = await verifyToken(env, token);
  if (!payload) return json({ ok: false }, 401);
  return json({ ok: true, user: payload });
}

async function verifyToken(env, token) {
  if (!token || !token.includes(".")) return null;
  const [data, sig] = token.split(".");
  const secret = env.AUTH_SECRET;
  if (!secret) return null;

  const expected = await hmac(secret, data);
  if (sig !== expected) return null;

  try {
    return JSON.parse(decodeURIComponent(escape(atob(data))));
  } catch {
    return null;
  }
}

async function hmac(secret, data) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=+$/g, "");
}
