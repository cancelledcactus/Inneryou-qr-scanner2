import { api, setToken, clearToken, startIdleWatcher, touchActivity } from "./auth.js";

const loginBox = document.getElementById("loginBox");
const idInput = document.getElementById("idInput");
const loginBtn = document.getElementById("loginBtn");
const scanLoginBtn = document.getElementById("scanLoginBtn");

const main = document.getElementById("main");
const whoPill = document.getElementById("whoPill");
const openScannerBtn = document.getElementById("openScannerBtn");
const logoutBtn = document.getElementById("logoutBtn");

const tabBtns = [...document.querySelectorAll(".tabBtn")];
const panes = {
  live: document.getElementById("tab-live"),
  rooms: document.getElementById("tab-rooms"),
  periods: document.getElementById("tab-periods"),
  users: document.getElementById("tab-users"),
  settings: document.getElementById("tab-settings"),
  export: document.getElementById("tab-export"),
  testing: document.getElementById("tab-testing"),
  support: document.getElementById("tab-support"),
  raffle: document.getElementById("tab-raffle"),
  announce: document.getElementById("tab-announce"),
};

// Live
const grid = document.getElementById("grid");
const periodPill = document.getElementById("periodPill");
const dayPill = document.getElementById("dayPill");

// Support
const supportOpenBtn = document.getElementById("supportOpenBtn");
const supportResolvedBtn = document.getElementById("supportResolvedBtn");
const supportList = document.getElementById("supportList");
let supportMode = "OPEN";

// Raffle
const raffleMinPeriods = document.getElementById("raffleMinPeriods");
const raffleSaveCfg = document.getElementById("raffleSaveCfg");
const raffleGrade = document.getElementById("raffleGrade");
const raffleCount = document.getElementById("raffleCount");
const raffleDrawBtn = document.getElementById("raffleDrawBtn");
const raffleListBtn = document.getElementById("raffleListBtn");
const raffleOut = document.getElementById("raffleOut");

// Announcements
const annLevel = document.getElementById("annLevel");
const annMsg = document.getElementById("annMsg");
const annSendBtn = document.getElementById("annSendBtn");
const annClearBtn = document.getElementById("annClearBtn");
const annStatus = document.getElementById("annStatus");

// Modal
const roomModal = document.getElementById("roomModal");
const rmTitle = document.getElementById("rmTitle");
const rmBody = document.getElementById("rmBody");
const rmClose = document.getElementById("rmClose");

// Rooms
const roomName = document.getElementById("roomName");
const addRoomBtn = document.getElementById("addRoomBtn");
const roomPrefix = document.getElementById("roomPrefix");
const roomStart = document.getElementById("roomStart");
const roomEnd = document.getElementById("roomEnd");
const genRoomsBtn = document.getElementById("genRoomsBtn");
const roomsList = document.getElementById("roomsList");

// Periods
const periodId = document.getElementById("periodId");
const periodName = document.getElementById("periodName");
const periodStart = document.getElementById("periodStart");
const periodEnd = document.getElementById("periodEnd");
const addPeriodBtn = document.getElementById("addPeriodBtn");
const pPrefix = document.getElementById("pPrefix");
const pNamePrefix = document.getElementById("pNamePrefix");
const pStartTime = document.getElementById("pStartTime");
const pCount = document.getElementById("pCount");
const pDuration = document.getElementById("pDuration");
const pGap = document.getElementById("pGap");
const genPeriodsBtn = document.getElementById("genPeriodsBtn");
const periodsList = document.getElementById("periodsList");

// Users
const userId = document.getElementById("userId");
const userRole = document.getElementById("userRole");
const userName = document.getElementById("userName");
const addUserBtn = document.getElementById("addUserBtn");
const usersList = document.getElementById("usersList");

// Settings
const idleSelect = document.getElementById("idleSelect");
const noPeriodSelect = document.getElementById("noPeriodSelect");
const batchSize = document.getElementById("batchSize");
const flushMs = document.getElementById("flushMs");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");
const settingsMsg = document.getElementById("settingsMsg");

// Export
const exportAllBtn = document.getElementById("exportAllBtn");
const exportSummaryBtn = document.getElementById("exportSummaryBtn");
const exportMsg = document.getElementById("exportMsg");

// Purge
const purgeBtn = document.getElementById("purgeBtn");
const purgeMsg = document.getElementById("purgeMsg");

rmClose.addEventListener("click", () => roomModal.classList.add("hidden"));

logoutBtn.addEventListener("click", () => {
  clearToken();
  showLogin();
});

openScannerBtn.addEventListener("click", () => {
  window.open("/scanner.html?mode=tech", "_blank");
});

tabBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    tabBtns.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    for (const k of Object.keys(panes)) panes[k].classList.add("hidden");
    panes[tab].classList.remove("hidden");

    // lazy refresh
    if (tab === "rooms") refreshRooms();
    if (tab === "periods") refreshPeriods();
    if (tab === "users") refreshUsers();
    if (tab === "settings") refreshSettings();
  });
});

// Login (type)
loginBtn.addEventListener("click", async () => {
  const id = String(idInput.value || "").trim();
  if (!/^\d{9}$/.test(id)) return alert("Enter a 9-digit ID");
  const res = await api("/api/login", { method:"POST", body: JSON.stringify({ id }) });
  if (!res?.ok || res.role !== "ADMIN") return alert("Admin access denied");
  setToken(res.token, res.role, res.idleTimeoutMs);
  whoPill.textContent = `Logged in: ${res.role}${res.name ? " • " + res.name : ""}`;
  showMain();
});

// Login (scan)
scanLoginBtn.addEventListener("click", async () => {
  const id = await scanOneQrForId();
  if (!id) return;
  idInput.value = id;
  loginBtn.click();
});

function showLogin() {
  loginBox.classList.remove("hidden");
  main.classList.add("hidden");
}
function showMain() {
  loginBox.classList.add("hidden");
  main.classList.remove("hidden");
  startLoops();
}

let liveInterval = null;
function startLoops() {
  if (liveInterval) clearInterval(liveInterval);
  refreshLive();
  liveInterval = setInterval(refreshLive, 3000);
}

async function refreshLive() {
  touchActivity();
  const res = await api("/api/rooms_summary");
  if (!res?.ok) return;
  periodPill.textContent = `Period: ${res.period_id}`;
  dayPill.textContent = `Day: ${res.event_day}`;
  renderGrid(res.rooms || []);
}

function renderGrid(rooms) {
  grid.innerHTML = "";
  for (const r of rooms) {
    const box = document.createElement("div");
    box.className = `roomBox ${r.help_flag ? "help" : ""}`;
    box.innerHTML = `
      <div class="roomTitle">${esc(r.room_id)}</div>
      <div class="roomStats">
        <div>✅ ${r.ok_count}</div>
        <div>⚠️ ${r.dup_count}</div>
        <div>❌ ${r.err_count}</div>
      </div>
      <div class="muted small">Last: ${r.last_ts ? new Date(r.last_ts).toLocaleTimeString() : "—"}</div>
    `;
    box.addEventListener("click", () => openRoom(r));
    grid.appendChild(box);
  }
}
function openRoom(r) {
  rmTitle.textContent = r.room_id;
  rmBody.innerHTML = `
    <div>OK: ${r.ok_count}</div>
    <div>DUP: ${r.dup_count}</div>
    <div>ERR: ${r.err_count}</div>
    <div>Last Student: ${r.last_student_id || "—"}</div>
    <div>Last Scan: ${r.last_ts || "—"}</div>
    <div>Help: ${r.help_flag ? "YES" : "no"}</div>
  `;
  roomModal.classList.remove("hidden");
}

// Rooms actions
addRoomBtn.addEventListener("click", async () => {
  const name = String(roomName.value || "").trim();
  if (!name) return alert("Enter a room name");
  const res = await api("/api/admin_rooms", { method:"POST", body: JSON.stringify({ action:"upsert", room_id: name, active: 1 }) });
  if (!res?.ok) return alert("Failed");
  roomName.value = "";
  refreshRooms();
});

genRoomsBtn.addEventListener("click", async () => {
  const prefix = String(roomPrefix.value || "Room ").trim();
  const start = Number(roomStart.value || "0");
  const end = Number(roomEnd.value || "0");
  if (!prefix) return alert("Prefix required");
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= 0 || end < start) return alert("Bad range");

  const rooms = [];
  let order = 0;
  for (let n = start; n <= end; n++) rooms.push({ room_id: `${prefix}${n}`, sort_order: order++, active: 1 });

  const res = await api("/api/admin_rooms", { method:"POST", body: JSON.stringify({ action:"bulkUpsert", rooms }) });
  if (!res?.ok) return alert("Generate failed");
  refreshRooms();
});

async function refreshRooms() {
  const res = await api("/api/admin_rooms", { method:"GET" });
  if (!res?.ok) return;
  roomsList.innerHTML = "";
  for (const r of res.rooms || []) {
    const row = document.createElement("div");
    row.className = "listItem row between";
    row.innerHTML = `
      <div>${esc(r.room_id)} <span class="muted small">${r.active ? "" : "(inactive)"}</span></div>
      <div class="row">
        <button class="ghost" data-id="${escAttr(r.room_id)}" data-act="${r.active ? 0 : 1}">
          ${r.active ? "Disable" : "Enable"}
        </button>
        <button class="danger" data-del="${escAttr(r.room_id)}">Delete</button>
      </div>
    `;
    roomsList.appendChild(row);
  }
  roomsList.querySelectorAll("button[data-id]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      const active = Number(btn.getAttribute("data-act"));
      await api("/api/admin_rooms", { method:"POST", body: JSON.stringify({ action:"upsert", room_id: id, active }) });
      refreshRooms();
    });
  });
  roomsList.querySelectorAll("button[data-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-del");
      if (!confirm(`Delete ${id}?`)) return;
      await api("/api/admin_rooms", { method:"POST", body: JSON.stringify({ action:"delete", room_id: id }) });
      refreshRooms();
    });
  });
}

// Periods actions
addPeriodBtn.addEventListener("click", async () => {
  const pid = String(periodId.value || "").trim();
  const nm = String(periodName.value || "").trim();
  const st = String(periodStart.value || "").trim();
  const en = String(periodEnd.value || "").trim();
  if (!pid || !nm || !isTime(st) || !isTime(en)) return alert("Fill all fields (HH:MM)");

  const res = await api("/api/admin_periods", { method:"POST", body: JSON.stringify({
    action:"upsert",
    period: { period_id: pid, name: nm, start_time: st, end_time: en, active: 1, sort_order: 0 }
  })});
  if (!res?.ok) return alert("Failed");
  periodId.value = ""; periodName.value = ""; periodStart.value = ""; periodEnd.value = "";
  refreshPeriods();
});

genPeriodsBtn.addEventListener("click", async () => {
  const idPref = String(pPrefix.value || "P").trim();
  const namePref = String(pNamePrefix.value || "Period ").trim();
  const start = String(pStartTime.value || "").trim();
  const count = Number(pCount.value || "0");
  const dur = Number(pDuration.value || "45");
  const gap = Number(pGap.value || "0");

  if (!idPref || !namePref) return alert("Prefixes required");
  if (!isTime(start)) return alert("Start time must be HH:MM");
  if (!Number.isFinite(count) || count <= 0 || count > 20) return alert("Bad count");
  if (!Number.isFinite(dur) || dur < 10 || dur > 180) return alert("Bad duration");
  if (!Number.isFinite(gap) || gap < 0 || gap > 30) return alert("Bad gap");

  const periods = [];
  let cur = toMinutes(start);
  for (let i = 1; i <= count; i++) {
    const st = fromMinutes(cur);
    const en = fromMinutes(cur + dur);
    periods.push({
      period_id: `${idPref}${i}`,
      name: `${namePref}${i}`,
      start_time: st,
      end_time: en,
      active: 1,
      sort_order: i
    });
    cur = cur + dur + gap;
  }

  const res = await api("/api/admin_periods", { method:"POST", body: JSON.stringify({ action:"bulkUpsert", periods }) });
  if (!res?.ok) return alert("Generate failed");
  refreshPeriods();
});

async function refreshPeriods() {
  const res = await api("/api/admin_periods", { method:"GET" });
  if (!res?.ok) return;
  periodsList.innerHTML = "";
  for (const p of res.periods || []) {
    const row = document.createElement("div");
    row.className = "listItem row between";
    row.innerHTML = `
      <div>
        <div><b>${esc(p.period_id)}</b> — ${esc(p.name)}</div>
        <div class="muted small">${esc(p.start_time)}–${esc(p.end_time)} ${p.active ? "" : "(inactive)"}</div>
      </div>
      <div class="row">
        <button class="ghost" data-toggle="${escAttr(p.period_id)}" data-act="${p.active ? 0 : 1}">
          ${p.active ? "Disable" : "Enable"}
        </button>
        <button class="danger" data-del="${escAttr(p.period_id)}">Delete</button>
      </div>
    `;
    periodsList.appendChild(row);
  }

  periodsList.querySelectorAll("button[data-toggle]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const pid = btn.getAttribute("data-toggle");
      const active = Number(btn.getAttribute("data-act"));
      await api("/api/admin_periods", { method:"POST", body: JSON.stringify({ action:"toggle", period_id: pid, active }) });
      refreshPeriods();
    });
  });

  periodsList.querySelectorAll("button[data-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const pid = btn.getAttribute("data-del");
      if (!confirm(`Delete ${pid}?`)) return;
      await api("/api/admin_periods", { method:"POST", body: JSON.stringify({ action:"delete", period_id: pid }) });
      refreshPeriods();
    });
  });
}

// Users actions
addUserBtn.addEventListener("click", async () => {
  const id = String(userId.value || "").trim();
  const role = String(userRole.value || "").trim();
  const name = String(userName.value || "").trim();
  if (!/^\d{9}$/.test(id)) return alert("User ID must be 9 digits");
  if (!["ADMIN","TECH"].includes(role)) return alert("Bad role");

  const res = await api("/api/admin_users", { method:"POST", body: JSON.stringify({ action:"upsert", user: { id, role, name, active: 1 } }) });
  if (!res?.ok) return alert("Failed");
  userId.value = ""; userName.value = "";
  refreshUsers();
});

async function refreshUsers() {
  const res = await api("/api/admin_users", { method:"GET" });
  if (!res?.ok) return;
  usersList.innerHTML = "";
  for (const u of res.users || []) {
    const row = document.createElement("div");
    row.className = "listItem row between";
    row.innerHTML = `
      <div>
        <div><b>${esc(u.id)}</b> — ${esc(u.role)} ${u.name ? "• " + esc(u.name) : ""}</div>
        <div class="muted small">${u.active ? "active" : "inactive"}</div>
      </div>
      <div class="row">
        <button class="ghost" data-toggle="${escAttr(u.id)}" data-act="${u.active ? 0 : 1}">
          ${u.active ? "Disable" : "Enable"}
        </button>
        <button class="danger" data-del="${escAttr(u.id)}">Delete</button>
      </div>
    `;
    usersList.appendChild(row);
  }

  usersList.querySelectorAll("button[data-toggle]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-toggle");
      const active = Number(btn.getAttribute("data-act"));
      await api("/api/admin_users", { method:"POST", body: JSON.stringify({ action:"toggle", id, active }) });
      refreshUsers();
    });
  });

  usersList.querySelectorAll("button[data-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-del");
      if (!confirm(`Delete ${id}?`)) return;
      await api("/api/admin_users", { method:"POST", body: JSON.stringify({ action:"delete", id }) });
      refreshUsers();
    });
  });
}

// Settings actions
saveSettingsBtn.addEventListener("click", async () => {
  const idle = String(idleSelect.value || "300000");
  const noP = String(noPeriodSelect.value || "true");
  const b = String(batchSize.value || "5");
  const f = String(flushMs.value || "12000");

  if (!/^\d+$/.test(idle)) return alert("Bad idle timeout");
  if (!["true","false"].includes(noP)) return alert("Bad NO_PERIOD setting");
  if (!/^\d+$/.test(b) || Number(b) < 1 || Number(b) > 10) return alert("Batch size 1..10");
  if (!/^\d+$/.test(f) || Number(f) < 2000 || Number(f) > 60000) return alert("Flush ms 2000..60000");

  const res = await api("/api/admin_settings", { method:"POST", body: JSON.stringify({
    idleTimeoutMs: idle,
    testingAllowNoPeriod: noP,
    batchSize: b,
    flushIntervalMs: f
  })});
  settingsMsg.textContent = res?.ok ? "Saved ✅" : "Save failed ❌";
});

async function refreshSettings() {
  const res = await api("/api/admin_settings", { method:"GET" });
  if (!res?.ok) return;
  idleSelect.value = String(res.settings.idleTimeoutMs || "300000");
  noPeriodSelect.value = String(res.settings.testingAllowNoPeriod || "true");
  batchSize.value = String(res.settings.batchSize || "5");
  flushMs.value = String(res.settings.flushIntervalMs || "12000");
  settingsMsg.textContent = "";
}

// Export
exportAllBtn.addEventListener("click", async () => {
  exportMsg.textContent = "Preparing…";
  const url = "/api/admin_export_csv?type=all";
  download(url, `scans_all_${new Date().toISOString().slice(0,10)}.csv`);
  exportMsg.textContent = "Download started.";
});

exportSummaryBtn.addEventListener("click", async () => {
  exportMsg.textContent = "Preparing…";
  const url = "/api/admin_export_csv?type=summary";
  download(url, `summary_${new Date().toISOString().slice(0,10)}.csv`);
  exportMsg.textContent = "Download started.";
});

function download(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}

// Purge
purgeBtn.addEventListener("click", async () => {
  if (!confirm("PURGE all scans + summaries? This cannot be undone.")) return;
  purgeMsg.textContent = "Purging…";
  const res = await api("/api/admin_purge", { method:"POST", body: JSON.stringify({ confirm: true }) });
  purgeMsg.textContent = res?.ok ? "Purged ✅" : "Failed ❌";
});

// Helpers
function isTime(s) { return /^\d{2}:\d{2}$/.test(s) && toMinutes(s) >= 0 && toMinutes(s) < 24*60; }
function toMinutes(hhmm) { const [h,m] = hhmm.split(":").map(Number); return h*60+m; }
function fromMinutes(min) {
  const h = Math.floor(min/60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}
function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function escAttr(s) { return esc(s).replace(/"/g,"&quot;"); }

// QR login scan (same as tech)
async function scanOneQrForId() {
  if (!navigator.mediaDevices?.getUserMedia) { alert("Camera not supported"); return null; }
  if (!window.ZXing?.BrowserMultiFormatReader) { alert("ZXing missing"); return null; }

  const overlay = document.createElement("div");
  overlay.className = "scanOverlay";
  overlay.innerHTML = `
    <div class="scanOverlayCard">
      <h3>Scan your Admin badge</h3>
      <div id="scanVidWrap" class="videoBox" style="aspect-ratio:1/1;margin-top:10px;position:relative;"></div>
      <div class="muted small" style="margin-top:8px;">Align QR in the box</div>
      <button id="cancelScan" class="ghost" style="margin-top:10px;">Cancel</button>
    </div>
  `;
  document.body.appendChild(overlay);

  const vidWrap = overlay.querySelector("#scanVidWrap");
  const cancelBtn = overlay.querySelector("#cancelScan");

  vidWrap.innerHTML = `
    <video id="adminScannerVideo" autoplay playsinline muted style="width:100%;height:100%"></video>
    <div class="scanFrame">
      <div class="scanFrameMark">📷</div>
      <div class="scanFrameText">Scan Badge</div>
    </div>
  `;

  let done = false;
  const localReader = new ZXing.BrowserMultiFormatReader();

  function cleanup() {
    done = true;
    try { localReader.reset(); } catch {}
    overlay.remove();
  }

  cancelBtn.onclick = cleanup;

  try {
    const devices = await localReader.listVideoInputDevices();
    if (!devices || devices.length === 0) {
      alert("No camera found");
      cleanup();
      return null;
    }

    const pickBack = (list) => {
      const preferred = list.find(d => /back|rear|environment/i.test(d.label || ""));
      return preferred?.deviceId || list[0].deviceId;
    };

    const deviceId = pickBack(devices);

    return await new Promise((resolve) => {
      localReader.decodeFromVideoDevice(
        deviceId,
        "adminScannerVideo",
        (result) => {
          if (done) return;
          if (result) {
            const txt = (typeof result.getText === "function") ? result.getText() : (result.text || "");
            const m = String(txt).match(/\b(\d{9})\b/);
            if (m) {
              cleanup();
              resolve(m[1]);
            }
          }
        }
      );
    });

  } catch (e) {
    alert("Camera blocked or failed.");
    cleanup();
    return null;
  }
}

/* =========================
   SUPPORT TAB
========================= */
if (supportOpenBtn) supportOpenBtn.addEventListener("click", async () => { supportMode="OPEN"; await refreshSupport(); });
if (supportResolvedBtn) supportResolvedBtn.addEventListener("click", async () => { supportMode="RESOLVED"; await refreshSupport(); });

async function refreshSupport() {
  if (!supportList) return;
  const res = await api(`/api/support_list?status=${encodeURIComponent(supportMode)}`);
  if (!res?.ok) return;

  supportList.innerHTML = "";
  const items = res.items || [];
  if (!items.length) {
    const d=document.createElement("div"); d.className="listItem"; d.textContent="No items"; supportList.appendChild(d);
    return;
  }
  for (const it of items) {
    const d=document.createElement("div");
    d.className="listItem";
    d.innerHTML = `
      <div class="row between">
        <div><b>${escapeHtml(it.room_id)}</b> • ${escapeHtml(it.support_type)} • <span class="muted">${escapeHtml(it.created_ts || "")}</span></div>
        ${it.status==="OPEN" ? `<button class="ghost" data-resolve="${escapeHtml(it.req_id)}">Resolve</button>` : ""}
      </div>
      ${it.note ? `<div class="small muted">${escapeHtml(it.note)}</div>` : ""}
    `;
    supportList.appendChild(d);
  }
  supportList.querySelectorAll("button[data-resolve]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const req_id = btn.getAttribute("data-resolve");
      if (!req_id) return;
      if (!confirm("Resolve support request?")) return;
      const r = await api("/api/support_resolve", { method:"POST", body: JSON.stringify({ req_id }) });
      if (r?.ok) refreshSupport();
    });
  });
}

/* =========================
   RAFFLE TAB
========================= */
if (raffleSaveCfg) raffleSaveCfg.addEventListener("click", async () => {
  const v = Number(raffleMinPeriods?.value || 4) || 4;
  const res = await api("/api/admin_raffle_config", { method:"POST", body: JSON.stringify({ min_distinct_periods: v }) });
  if (res?.ok) showToast(`Saved min periods = ${res.min_distinct_periods}`, "ok");
});

if (raffleDrawBtn) raffleDrawBtn.addEventListener("click", async () => {
  if (!raffleOut) return;
  raffleOut.innerHTML = "";
  const n = Number(raffleCount?.value || 1) || 1;
  const g = String(raffleGrade?.value || "").trim();
  const body = g ? { n, grade: g } : { n };
  const res = await api("/api/admin_raffle_draw", { method:"POST", body: JSON.stringify(body) });
  if (!res?.ok) return;

  for (const w of (res.winners || [])) {
    const d=document.createElement("div");
    d.className="listItem";
    d.textContent = `${w.name || "—"} • ${w.student_id} • G${w.grade ?? "—"} • periods=${w.periods}`;
    raffleOut.appendChild(d);
  }
  if (!res.winners?.length) {
    const d=document.createElement("div"); d.className="listItem"; d.textContent="No eligible students"; raffleOut.appendChild(d);
  }
});

if (raffleListBtn) raffleListBtn.addEventListener("click", async () => {
  if (!raffleOut) return;
  raffleOut.innerHTML = "";
  const g = String(raffleGrade?.value || "").trim();
  const url = g ? `/api/admin_raffle_candidates?grade=${encodeURIComponent(g)}` : "/api/admin_raffle_candidates";
  const res = await api(url);
  if (!res?.ok) return;

  const top = (res.items || []).slice(0, 200);
  for (const it of top) {
    const d=document.createElement("div");
    d.className="listItem";
    d.textContent = `${it.name || "—"} • ${it.student_id} • G${it.grade ?? "—"} • periods=${it.periods}`;
    raffleOut.appendChild(d);
  }
  if (!top.length) {
    const d=document.createElement("div"); d.className="listItem"; d.textContent="No eligible students"; raffleOut.appendChild(d);
  }
});

/* =========================
   ANNOUNCEMENTS TAB
========================= */
if (annSendBtn) annSendBtn.addEventListener("click", async () => {
  const message = String(annMsg?.value || "").trim();
  const level = String(annLevel?.value || "INFO").trim();
  if (!message) return alert("Message required");
  const res = await api("/api/admin_announcement", { method:"POST", body: JSON.stringify({ message, level, active: true }) });
  if (res?.ok) {
    if (annStatus) annStatus.textContent = "Sent.";
    showToast("Announcement sent", "ok");
  }
});

if (annClearBtn) annClearBtn.addEventListener("click", async () => {
  const res = await api("/api/admin_announcement", { method:"DELETE" });
  if (res?.ok) {
    if (annStatus) annStatus.textContent = "Cleared.";
    showToast("Announcement cleared", "ok");
  }
});

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

startIdleWatcher(() => {
  alert("Logged out (idle)");
  showLogin();
});

showLogin();
