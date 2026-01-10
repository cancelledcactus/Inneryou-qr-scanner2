import { json } from "./_middleware";

export async function onRequestGet({ env }) {
  const rows = await env.DB.prepare("SELECT key, value FROM settings").all();
  const map = {};
  for (const r of rows.results || []) map[r.key] = r.value;

  // only return safe settings
  return json({
    ok: true,
    settings: {
      batchSize: map.batchSize || "5",
      flushIntervalMs: map.flushIntervalMs || "12000",
      testingAllowNoPeriod: map.testingAllowNoPeriod || "true",
    }
  });
}
