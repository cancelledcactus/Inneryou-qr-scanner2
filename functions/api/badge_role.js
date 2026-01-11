export async function onRequestPost({ request, env }) {
  const DB = env.DB;
  if (!DB) return json({ ok:false, error:"DB_not_bound" }, 500);

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  if (!/^\d{9}$/.test(id)) return json({ ok:false, error:"bad_id" }, 400);

  const row = await DB.prepare(
    "SELECT role, active FROM users WHERE id=? LIMIT 1"
  ).bind(id).first();

  if (!row || row.active !== 1) return json({ ok:true, found:false });

  return json({ ok:true, found:true, role: row.role });
}

function json(obj, status=200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type":"application/json" }
  });
}
