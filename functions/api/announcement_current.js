import { json } from "./_middleware";
import { getNYParts } from "./_time";

export async function onRequestGet({ env }) {
  // Public endpoint: scanners/tech can fetch current announcement
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY,
      message TEXT NOT NULL,
      level TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      created_ts TEXT NOT NULL
    )
  `).run();

  const row = await env.DB.prepare(`
    SELECT id, message, level, created_ts
    FROM announcements
    WHERE active=1
    ORDER BY created_ts DESC
    LIMIT 1
  `).first().catch(() => null);

  const { event_day } = getNYParts();
  return json({ ok:true, event_day, announcement: row || null });
}
