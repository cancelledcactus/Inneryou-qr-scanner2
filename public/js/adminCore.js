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
  roomsList: document.getElementById("roomsList"),
  periodsList: document.getElementById("periodsList"),
  usersList: document.getElementById("usersList"),
  suppList: document.getElementById("supportList"),
  rafResult: document.getElementById("raffleResult")
};

// --- AUTH ---
document.getElementById("loginBtn").addEventListener("click", async () => {
  const id = document.getElementById("idInput").value.trim();
  if (!/^\d{9}$/.test(id)) return alert("Invalid ID");
  const res = await api("/api/login", { method:"POST", body: JSON.stringify({ id }) });
  if (res?.ok && res.role === "ADMIN") {
    setToken(res.token, res.role, res.idleTimeoutMs);
    ui.whoPill.textContent = `Logged in: ADMIN • ${res.name || ""}`;
    showMain();
  } else alert("Access Denied");
});

document.getElementById("logoutBtn").addEventListener("click", () => { clearToken(); location.reload(); });
document.getElementById("openScannerBtn").addEventListener("click", () => window.open("/scanner.html?mode=admin", "_blank"));

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

  if (tabId === "rooms") refreshRooms();
  if (tabId === "periods") refreshPeriods();
  if (tabId === "users") refreshUsers();
  if (tabId === "support") refreshSupport();
  if (tabId === "settings") loadSettings();
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

  const testTag = res.is_testing ? ` <span class="text-warn" style="font-weight:800">(TESTING_MODE)</span>` : "";
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

// --- 2. ROOMS ---
async function refreshRooms() {
  const res = await api("/api/admin_rooms");
  if (!res?.ok) return;
  ui.roomsList.innerHTML = (res.rooms || []).map(r => `
    <div class="listItem">
      <div>${esc(r.room_id)}</div>
      <div class="row">
        <button class="ghost" onclick="toggleRoom('${r.room_id}', ${r.active})">${r.active ? "Disable" : "Enable"}</button>
        <button class="danger" onclick="deleteRoom('${r.room_id}')">Delete</button>
      </div>
    </div>
  `).join("");
}
document.getElementById("addRoomBtn").addEventListener("click", async () => {
  await api("/api/admin_rooms", { method:"POST", body:JSON.stringify({ action:"upsert", room_id:document.getElementById("roomName").value, active:1 }) });
  refreshRooms();
});
document.getElementById("genRoomsBtn").addEventListener("click", async () => {
  const prefix = document.getElementById("roomPrefix").value;
  const start = parseInt(document.getElementById("roomStart").value);
  const end = parseInt(document.getElementById("roomEnd").value);
  if (!prefix || isNaN(start)) return;
  const rooms = [];
  let order = 0;
  for (let i = start; i <= end; i++) rooms.push({ room_id: `${prefix}${i}`, active: 1, sort_order: order++ });
  await api("/api/admin_rooms", { method:"POST", body:JSON.stringify({ action:"bulkUpsert", rooms }) });
  refreshRooms();
});
window.toggleRoom = async (id, act) => { await api("/api/admin_rooms", { method:"POST", body:JSON.stringify({ action:"upsert", room_id:id, active: act?0:1 }) }); refreshRooms(); };
window.deleteRoom = async (id) => { if(confirm("Del?")) await api("/api/admin_rooms", { method:"POST", body:JSON.stringify({ action:"delete", room_id:id }) }); refreshRooms(); };

// --- 3. PERIODS (Linked Logic) ---
async function refreshPeriods() {
  const res = await api("/api/admin_periods");
  if (!res?.ok) return;
  ui.periodsList.innerHTML = (res.periods || []).map(p => {
    const isLinked = p.group_id && p.group_id !== p.period_id ? ` <span class="text-warn small">(Linked)</span>` : "";
    const isLunch = p.scan_enabled === 0 ? ` <span class="text-err small">(Closed)</span>` : "";
    return `
      <div class="listItem">
        <div><b>${esc(p.period_id)}</b> ${isLinked} ${isLunch} <span class="muted small">${esc(p.start_time)}-${esc(p.end_time)}</span></div>
        <button class="danger" onclick="deletePeriod('${p.period_id}')">Delete</button>
      </div>
    `;
  }).join("");
}
document.getElementById("addPeriodBtn").addEventListener("click", async () => {
  const period = { period_id: document.getElementById("periodId").value, name: document.getElementById("periodName").value, start_time: document.getElementById("periodStart").value, end_time: document.getElementById("periodEnd").value, active: 1 };
  await api("/api/admin_periods", { method:"POST", body:JSON.stringify({ action:"upsert", period }) });
  refreshPeriods();
});
document.getElementById("genPeriodsBtn").addEventListener("click", async () => {
  const prefix = document.getElementById("pPrefix").value;
  const namePref = document.getElementById("pNamePrefix").value;
  const count = parseInt(document.getElementById("pCount").value);
  const dur = parseInt(document.getElementById("pDuration").value);
  const gap = parseInt(document.getElementById("pGap").value);
  
  const periods = [];
  let min = toMinutes(document.getElementById("pStartTime").value);
  
  for (let i = 1; i <= count; i++) {
    const st = fromMinutes(min);
    const en = fromMinutes(min + dur);
    let gid = `${prefix}${i}`;
    if (i===1 || i===2) gid = `${prefix}1_2`; // Link P1 + P2
    let scan = i===6 ? 0 : 1; // Lunch is closed
    periods.push({ period_id:`${prefix}${i}`, name:`${namePref}${i}`, start_time:st, end_time:en, active:1, sort_order:i, group_id:gid, scan_enabled:scan });
    min += (dur + gap);
  }
  await api("/api/admin_periods", { method:"POST", body:JSON.stringify({ action:"bulkUpsert", periods }) });
  refreshPeriods();
});
window.deletePeriod = async (id) => { if(confirm("Del?")) await api("/api/admin_periods", { method:"POST", body:JSON.stringify({ action:"delete", period_id:id }) }); refreshPeriods(); };

// --- 4. USERS ---
async function refreshUsers() {
  const res = await api("/api/admin_users");
  if (!res?.ok) return;
  ui.usersList.innerHTML = (res.users || []).map(u => `
    <div class="listItem">
      <div>
        <div style="font-weight:700">${esc(u.id)} — ${esc(u.role)} ${u.name ? "• " + esc(u.name) : ""}</div>
        <div class="small muted" style="margin-top:4px;">${u.active ? "active" : "inactive"}</div>
      </div>
      <div class="row">
        <button class="ghost" onclick="toggleUser('${u.id}', ${u.active})">${u.active ? "Disable" : "Enable"}</button>
        <button class="danger" onclick="deleteUser('${u.id}')">Delete</button>
      </div>
    </div>
  `).join("") || '<div class="muted small">No users.</div>';
}
document.getElementById("addUserBtn").addEventListener("click", async () => {
  await api("/api/admin_users", { method:"POST", body:JSON.stringify({ action:"upsert", user:{ id:document.getElementById("userId").value, role:document.getElementById("userRole").value, name:document.getElementById("userName").value, active:1 } }) });
  refreshUsers();
});
window.toggleUser = async (id, act) => { await api("/api/admin_users", { method:"POST", body:JSON.stringify({ action:"toggle", id, active: act?0:1 }) }); refreshUsers(); };
window.deleteUser = async (id) => { if(confirm("Del?")) await api("/api/admin_users", { method:"POST", body:JSON.stringify({ action:"delete", id }) }); refreshUsers(); };

// --- 5. EXPORT ---
window.downloadCsv = (type) => {
  const a = document.createElement("a");
  a.href = `/api/admin_export_csv?type=${type}`;
  a.download = `export_${type}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
};

// --- 6. SUPPORT ---
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
window.resolveSupport = async (id) => { if(confirm("Resolve?")) await api("/api/support_resolve", { method:"POST", body:JSON.stringify({ req_id:id }) }); refreshSupport(); };

// --- 7. RAFFLE ---
document.getElementById("rafDrawBtn").addEventListener("click", async () => {
  const n = document.getElementById("rafCount").value;
  const grade = document.getElementById("rafGrade").value;
  const res = await api("/api/admin_raffle_draw", { method:"POST", body:JSON.stringify({ n, grade }) });
  ui.rafResult.innerHTML = (res?.winners||[]).map(w => `<div class="roomBox" style="text-align:center; border-color:#238636"><h3 class="text-ok">WINNER</h3>${esc(w.name)} (${w.student_id})</div>`).join("") || "No winners";
});
document.getElementById("rafListBtn").addEventListener("click", async () => {
  const grade = document.getElementById("rafGrade").value;
  const res = await api(`/api/admin_raffle_candidates?grade=${grade}`);
  ui.rafResult.innerHTML = (res?.items||[]).map(s => `<div class="listItem"><div><b>${esc(s.name)}</b> (${s.student_id})</div><div class="small muted">${s.periods} Distinct Periods</div></div>`).join("") || "No eligible students";
});
document.getElementById("rafSaveBtn").addEventListener("click", async () => {
  await api("/api/admin_raffle_config", { method:"POST", body:JSON.stringify({ min_distinct_periods: document.getElementById("rafMin").value }) });
  alert("Saved");
});

// --- 8. ANNOUNCEMENTS ---
document.getElementById("annSendBtn").addEventListener("click", async () => {
  await api("/api/admin_announcement", { method:"POST", body:JSON.stringify({ message:document.getElementById("annMsg").value, level:document.getElementById("annLevel").value, active:1 }) });
  document.getElementById("annStatus").textContent = "Sent!";
  document.getElementById("annMsg").value = "";
});
document.getElementById("annClearBtn").addEventListener("click", async () => {
  await api("/api/admin_announcement", { method:"DELETE" });
  document.getElementById("annStatus").textContent = "Cleared.";
});

// --- 9. SETTINGS & TESTING ---
async function loadSettings() {
  const res = await api("/api/admin_settings");
  if (!res?.ok) return;
  document.getElementById("setIdle").value = res.settings.idleTimeoutMs || "300000";
  document.getElementById("setTestMode").value = res.settings.testingAllowNoPeriod || "true";
  document.getElementById("setBatch").value = res.settings.batchSize || "5";
  document.getElementById("setFlush").value = res.settings.flushIntervalMs || "12000";
}
document.getElementById("saveSettingsBtn").addEventListener("click", async () => {
  await api("/api/admin_settings", { method:"POST", body:JSON.stringify({ idleTimeoutMs:document.getElementById("setIdle").value, testingAllowNoPeriod:document.getElementById("setTestMode").value, batchSize:document.getElementById("setBatch").value, flushIntervalMs:document.getElementById("setFlush").value }) });
  document.getElementById("saveMsg").style.opacity="1"; setTimeout(()=>document.getElementById("saveMsg").style.opacity="0", 2000);
});
window.sim = async (action) => {
  const res = await api("/api/admin_test_simulate", { method:"POST", body:JSON.stringify({ action }) });
  document.getElementById("simMsg").textContent = res?.ok ? `✅ ${res.msg}` : "❌ Failed";
  refreshLive();
};
document.getElementById("purgeBtn").addEventListener("click", async () => {
  if (confirm("Permanently delete ALL DATA?")) await api("/api/admin_purge", { method:"POST", body:JSON.stringify({ confirm:true }) });
  location.reload();
});

// --- Utils ---
function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;"); }
function fmtTime(s) { if(!s) return ""; return new Date(s.includes("T")?s:s.replace(" ","T")+"Z").toLocaleTimeString("en-US", {timeZone:"America/New_York", hour:"2-digit", minute:"2-digit"}); }
function toMinutes(s) { const [h,m] = s.split(":").map(Number); return h*60+m; }
function fromMinutes(m) { const hh=Math.floor(m/60)%24, mm=m%60; return `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}`; }

startIdleWatcher(() => location.reload());
