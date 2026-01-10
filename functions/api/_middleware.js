export async function onRequest(context) {
  const { request } = context;

  // CORS for local testing (optional). Same-origin in production.
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request),
    });
  }

  try {
    const res = await context.next();
    const h = new Headers(res.headers);
    const c = corsHeaders(request);
    for (const [k, v] of Object.entries(c)) h.set(k, v);
    return new Response(res.body, { status: res.status, headers: h });
  } catch (err) {
    return json({ ok: false, error: String(err || "unknown") }, 500, corsHeaders(request));
  }
}

function corsHeaders(req) {
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  };
}

export function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  });
}
