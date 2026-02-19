import { api, setToken, clearToken, startIdleWatcher } from "./auth.js";

let timers = { live: null };
let supportMode = "OPEN";

const ui = {
  loginView: document.getElementById("loginView"),
  mainView: document.getElementById("mainView"),
  whoPill: document.getElementById("whoPill"),
  tabs: document.querySelectorAll(".tabBtn"),
  panes: document.querySelectorAll(".tabPane"),
  liveGrid: document.getElementById("liveGrid"),
  periodPill: document.getElementById("periodPill"),
  dayPill: document.getElementById("dayPill"),
  suppList: document.getElementById("supportList")
};

// --- AUTH ---
document.getElementById("loginBtn").addEventListener("click", async () => {
  const id = document.getElementById("idInput").value.trim();
  if (!/^\d{9}$/.test(id)) return alert("Invalid ID");
  const res = await api("/api/login", { method:"POST", body: JSON.stringify({ id }) });
  
  // Allow both TECH and ADMIN to use this dashboard
  if (res?.ok && (res.role === "TECH" || res.role === "ADMIN")) {
    setToken(res.token, res.role, res.idleTimeoutMs);
    ui.whoPill.textContent = `Logged in: ${res.role} • ${res.name || ""}`;
    showMain();
  } else alert("Access Denied");
});

document.getElementById("logoutBtn").addEventListener("click", () => { clearToken(); location.reload(); });
document.getElementById("openScannerBtn").addEventListener("click", () => window.open("/scanner.html?mode=tech", "_blank"));

function showMain() {
  ui.loginView.classList.add("hidden");
  ui.mainView.classList.remove("hidden");
  startLiveLoop();
}

// --- TABS ---
ui.tabs.forEach(btn => btn.addEventListener("click", () => {
  ui.tabs.forEach(b => b.classList.remove("active"));
  ui.panes.forEach(p => p.classList.add("hidden"));
  btn.classList.add("active");
  const tabId = btn.dataset.tab;
  document.getElementById(`tab-${tabId}`).classList.remove("hidden");

  if (tabId === "support") refreshSupport();
}));

// --- 1. LIVE SYNC ---
function startLiveLoop() {
  if (timers.live) clearInterval(timers.live);
  refreshLive();
  timers.live = setInterval(refreshLive, 3000);
}

async function refreshLive() {
  const res = await api("/api/live_sync");
  if (!res?.ok) return;

  const testTag = res.is_testing ? ` <span class="text-warn" style="font-weight:800">(TESTING)</span>` : "";
  ui.periodPill.innerHTML = `Period: ${res.period_id} ${testTag}`;
  ui.dayPill.textContent = `Day: ${res.event_day}`;
  
  ui.liveGrid.innerHTML = (res.rooms || []).map(r => {
    const isOnline = r.online === 1;
    const isEnabled = r.enabled !== 0;
    let statusText = "—";
    if (r.last_status === "ok") statusText = "✅ OK";
    else if (r.last_status === "dup") statusText = "⚠️ DUP";
    else if (r.last_status === "err") statusText = "❌ ERR";

    return `
      <div class="roomBox" style="${r.help ? 'border-color:#d29922;' : ''}">
        <div class="row between">
          <div class="roomTitle">${esc(r.room_id)}</div>
          <div class="small ${isEnabled ? 'muted' : 'text-err'}">${isEnabled ? 'Enabled' : 'DISABLED'}</div>
        </div>
        <div class="small muted">Support: ${r.help ? `<span class="text-warn">REQUESTED (${esc(r.support_type)})</span>` : "No support"}</div>
        
        <div class="statRow">
          <span class="text-ok">✅ ${r.ok}</span>
          <span class="text-warn">⚠️ ${r.dup}</span>
          <span class="text-err">❌ ${r.err}</span>
        </div>

        <div class="metaLine">Student: ${esc(r.last_student || "—")}</div>
        <div class="metaLine">Status: ${statusText}</div>
        <div class="metaLine">Last Scan: ${r.last_ts ? fmtTime(r.last_ts) : "—"}</div>
        <div class="metaLine">Heartbeat: ${r.hb ? fmtTime(r.hb) : "—"}</div>
        
        <div class="deviceLine">
          Device: ${isOnline ? "Online ✅" : "Offline ❌"} • Bat: ${r.bat !== null ? r.bat + "%" : "n/a"} • Queue: ${r.queue || 0}
        </div>

        <div class="ctrlRow">
          <button class="fullBtn ghost" onclick="ctrl('${r.room_id}','forceUnlock')">Force Unlock</button>
          <button class="danger" onclick="ctrl('${r.room_id}','disable')">Disable</button>
          <button class="ghost" onclick="ctrl('${r.room_id}','enable')">Enable</button>
        </div>
      </div>
    `;
  }).join("");
}

window.ctrl = async (id, action) => {
  let msg = "";
  if (action === "disable") {
    msg = prompt(`Disable scanning in ${id}?\n\nEnter an optional reason (e.g. 'See Tech', 'Fire Drill'):`);
    if (msg === null) return; // User pressed Cancel
  } else {
    if (!confirm(`${action} room ${id}?`)) return;
  }
  
  await api("/api/admin_room_control", { method:"POST", body:JSON.stringify({ room_id:id, action, message:msg }) });
  refreshLive();
};

// --- 2. SUPPORT ---
document.getElementById("suppOpenBtn").addEventListener("click", () => { supportMode="OPEN"; refreshSupport(); document.getElementById("suppOpenBtn").classList.add("active"); document.getElementById("suppResolvedBtn").classList.remove("active"); });
document.getElementById("suppResolvedBtn").addEventListener("click", () => { supportMode="RESOLVED"; refreshSupport(); document.getElementById("suppResolvedBtn").classList.add("active"); document.getElementById("suppOpenBtn").classList.remove("active"); });

async function refreshSupport() {
  const res = await api(`/api/support_list?status=${supportMode}`);
  ui.suppList.innerHTML = (res?.items || []).map(it => `
    <div class="listItem">
      <div class="row between">
        <div><b>${esc(it.room_id)}</b> <span class="supportBadge">${esc(it.support_type)}</span></div>
        <div class="small muted">${fmtTime(it.created_ts)}</div>
      </div>
      <div style="margin-top:4px;">${esc(it.note || "No details provided")}</div>
      ${supportMode === "OPEN" ? `<button class="ghost" style="margin-top:8px;" onclick="resolveSupport('${it.req_id}')">Mark Resolved</button>` : ""}
    </div>
  `).join("") || "No items";
}
window.resolveSupport = async (id) => { if(confirm("Resolve this ticket?")) await api("/api/support_resolve", { method:"POST", body:JSON.stringify({ req_id:id }) }); refreshSupport(); };

// --- 3. ANNOUNCEMENTS ---
document.getElementById("annSendBtn").addEventListener("click", async () => {
  await api("/api/admin_announcement", { method:"POST", body:JSON.stringify({ message:document.getElementById("annMsg").value, level:document.getElementById("annLevel").value, active:1 }) });
  document.getElementById("annStatus").textContent = "Sent!";
  document.getElementById("annMsg").value = "";
});
document.getElementById("annClearBtn").addEventListener("click", async () => {
  await api("/api/admin_announcement", { method:"DELETE" });
  document.getElementById("annStatus").textContent = "Cleared.";
});

// --- Utils ---
function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;"); }
function fmtTime(s) { if(!s) return ""; return new Date(s.includes("T")?s:s.replace(" ","T")+"Z").toLocaleTimeString("en-US", {timeZone:"America/New_York", hour:"2-digit", minute:"2-digit"}); }

startIdleWatcher(() => location.reload());
