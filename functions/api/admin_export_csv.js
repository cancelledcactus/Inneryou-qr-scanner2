import { json } from "./_middleware";

export async function onRequestGet({ request, env }) {
  const { err } = await requireAdmin(request, env);
  if (err) return json({ ok:false, error: err }, 401);

  const url = new URL(request.url);
  const type = url.searchParams.get("type") || "all";

  if (type === "summary") {
    const rows = await env.DB.prepare(
      "SELECT event_day, period_id, room_id, ok_count, dup_count, err_count, last_ts, last_student_id, help_flag, last_heartbeat FROM room_period_summary ORDER BY event_day DESC, period_id ASC, room_id ASC"
    ).all();

    return csvResponse("summary.csv", [
      ["event_day","period_id","room_id","ok_count","dup_count","err_count","last_ts","last_student_id","help_flag","last_heartbeat"],
      ...(rows.results || []).map(r => [
        r.event_day, r.period_id, r.room_id, r.ok_count, r.dup_count, r.err_count, r.last_ts, r.last_student_id, r.help_flag, r.last_heartbeat
      ])
    ]);
  }

  const rows = await env.DB.prepare(
    "SELECT event_day, period_id, room_id, student_id, grade, name, ts, source_role FROM scans ORDER BY ts ASC"
  ).all();

  return csvResponse("scans_all.csv", [
    ["event_day","period_id","room_id","student_id","grade","name","ts","source_role"],
    ...(rows.results || []).map(r => [
      r.event_day, r.period_id, r.room_id, r.student_id, r.grade ?? "", r.name ?? "", r.ts, r.source_role ?? ""
    ])
  ]);
}

function csvResponse(filename, rows) {
  const csv = rows.map(row => row.map(cell => {
    const s = String(cell ?? "");
    const needs = s.includes(",") || s.includes('"') || s.includes("\n");
    const esc = s.replace(/"/g,'""');
    return needs ? `"${esc}"` : esc;
  }).join(",")).join("\r\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`
    }
  });
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
