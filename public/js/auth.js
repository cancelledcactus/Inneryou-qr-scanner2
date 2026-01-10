const TOKEN_KEY = "auth_token_v1";
const ROLE_KEY = "auth_role_v1";
const IDLE_KEY = "auth_idle_ms_v1";
const LAST_KEY = "auth_last_activity_v1";

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY) || "";
}
export function setToken(token, role, idleMs) {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(ROLE_KEY, role);
  sessionStorage.setItem(IDLE_KEY, String(idleMs || 300000));
  touchActivity();
}
export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(ROLE_KEY);
  sessionStorage.removeItem(IDLE_KEY);
  sessionStorage.removeItem(LAST_KEY);
}

export function touchActivity() {
  sessionStorage.setItem(LAST_KEY, String(Date.now()));
}

export function startIdleWatcher(onLogout) {
  setInterval(() => {
    const token = getToken();
    if (!token) return;
    const idleMs = Number(sessionStorage.getItem(IDLE_KEY) || "300000");
    const last = Number(sessionStorage.getItem(LAST_KEY) || "0");
    if (!last) return;
    if (Date.now() - last > idleMs) {
      clearToken();
      onLogout?.();
    }
  }, 1000);
}

export async function api(url, options = {}) {
  touchActivity();
  const token = getToken();
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(url, { ...options, headers });
  return await res.json().catch(() => null);
}
