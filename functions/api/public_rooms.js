import { json } from "./_middleware";

export async function onRequestGet({ env }) {
  const rows = await env.DB.prepare(
    "SELECT room_id FROM rooms WHERE active=1 ORDER BY sort_order ASC, room_id ASC"
  ).all();

  return json({ ok: true, rooms: (rows.results || []).map(r => r.room_id) });
}
