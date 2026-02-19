import { json } from "./_middleware";
import { getNYParts } from "./_time";

export async function onRequestGet({ request, env }) {
  const { err } = await requireAdmin(request, env);
  if (err) return json({ ok:false, error: err }, 401);

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (!q) return json({ ok:true, results: [] });

  const { event_day } = getNYParts();

  // Search by ID or Name for TODAY'S scans
  const rows = await env.DB.prepare(`
    SELECT student_id, name, grade, room_id, period_id, ts
    FROM scans
    WHERE event_day = ? AND (student_id LIKE ? OR name LIKE ?)
    ORDER BY student_id ASC, ts ASC
  `).bind(event_day, `%${q}%`, `%${q}%`).all().catch(()=>({results:[]}));

  // Group the scans by student so we can show their path
  const studentsMap = {};
  for (const r of rows.results || []) {
    if (!studentsMap[r.student_id]) {
      studentsMap[r.student_id] = {
        student_id: r.student_id,
        name: r.name || "Unknown",
        grade: r.grade || "?",
        scans: []
      };
    }
    if (r.name && studentsMap[r.student_id].name === "Unknown") studentsMap[r.student_id].name = r.name;
    if (r.grade && studentsMap[r.student_id].grade === "?") studentsMap[r.student_id].grade = r.grade;

    studentsMap[r.student_id].scans.push({
      room_id: r.room_id,
      period_id: r.period_id,
      ts: r.ts
    });
  }

  return json({ ok:true, results: Object.values(studentsMap) });
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
