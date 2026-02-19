import { json } from "./_middleware";

export async function onRequestGet({ request, env }) {
  const { err } = await requireAdmin(request, env);
  if (err) return json({ ok:false, error: err }, 401);

  const url = new URL(request.url);
  const type = url.searchParams.get("type") || "scans";

  let sql = "";
  if (type === "scans") sql = "SELECT * FROM scans ORDER BY ts DESC LIMIT 10000";
  else if (type === "summary") sql = "SELECT * FROM room_period_summary ORDER BY event_day DESC";
  else if (type === "users") sql = "SELECT * FROM users";
  else if (type === "rooms") sql = "SELECT * FROM rooms";
  else if (type === "periods") sql = "SELECT * FROM periods";
  else return json({ ok:false, error:"Bad type" }, 400);
  
  const rows = await env.DB.prepare(sql).all();
  const data = rows.results || [];
  if (!data.length) return csvResponse(type+".csv", [["No Data Found"]]);

  const headers = Object.keys(data[0]);
  const csvRows = [headers, ...data.map(row => headers.map(h => row[h]))];
  return csvResponse(type+".csv", csvRows);
}

function csvResponse(filename, rows) {
  const csv = rows.map(row => row.map(cell => {
    const s = String(cell ?? "").replace(/"/g,'""');
    return /[,"\n]/.test(s) ? `"${s}"` : s;
  }).join(",")).join("\r\n");
  return new Response(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="${filename}"` }});
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
