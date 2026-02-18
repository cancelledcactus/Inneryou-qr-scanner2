// Shared NYC time + period logic (Cloudflare runtime is UTC by default)
export function getNYParts() {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]));
  return {
    event_day: `${parts.year}-${parts.month}-${parts.day}`,
    hhmm: `${parts.hour}:${parts.minute}`
  };
}

// Returns { period_id, scan_enabled } where period_id is group_id if present.
// Falls back gracefully if columns don't exist yet.
export async function getActivePeriod(DB, hhmm, allowNoPeriod = true) {
  // Try with group_id + scan_enabled columns
  let rows;
  try {
    rows = await DB.prepare(`
      SELECT period_id, start_time, end_time, group_id, scan_enabled
      FROM periods
      WHERE active=1
      ORDER BY sort_order ASC
    `).all();
  } catch {
    rows = await DB.prepare(`
      SELECT period_id, start_time, end_time
      FROM periods
      WHERE active=1
      ORDER BY sort_order ASC
    `).all();
  }

  for (const p of rows.results || []) {
    if (p.start_time <= hhmm && hhmm < p.end_time) {
      const pid = p.group_id || p.period_id;
      const scan_enabled = (typeof p.scan_enabled === "number") ? (p.scan_enabled ? 1 : 0) : 1;
      return { period_id: pid, scan_enabled };
    }
  }
  return { period_id: allowNoPeriod ? "NO_PERIOD" : null, scan_enabled: 0 };
}
