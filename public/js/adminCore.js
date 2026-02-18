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

    if (tab === "rooms") refreshRooms();
    if (tab === "periods") refreshPeriods();
    if (tab === "users") refreshUsers();
    if (tab === "settings") refreshSettings();
    if (tab === "support") refreshSupport();
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

function fmtNYTime(isoOrSql) {
  if (!isoOrSql) return "—";
  const s = String(isoOrSql);
  // support sqlite datetime('now') style with space
  const d = s.includes("T") ? new Date(s) : new Date(s.replace(" ", "T") + "Z");
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone:"America/New_York", hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:true });
  return fmt.format(d);
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

    const lastStudent =
      r.last_student_id
        ? `${r.last_name ? r.last_name + " • " : ""}${r.last_student_id}${(r.last_grade || r.last_grade === 0) ? " • G" + r.last_grade : ""}`
        : "—";

    const statusText =
      r.last_status === "ok" ? "✅ OK" :
      r.last_status === "dup" ? "⚠️ DUP" :
      r.last_status === "err" ? "❌ ERR" : "—";

    const lastErr = (r.last_status === "err" && r.last_error) ? r.last_error : "";

    const hb = r.last_heartbeat ? fmtNYTime(r.last_heartbeat) : "—";

    // device health (from backend join)
    const devOnline = (r.dev_online === 0) ? "Offline ❌" : "Online ✅";
    const devBat = (typeof r.dev_battery_pct === "number" || /^\d+$/.test(String(r.dev_battery_pct||"")))
      ? `Battery ${r.dev_battery_pct}%${r.dev_charging ? " ⚡" : ""}`
      : "Battery (n/a)";
    const devQueue = `Queue ${Number(r.dev_queue_len || 0)}`;
    const devScan = r.dev_scanning ? "Scanning ✅" : "Idle";
    const enabled = (r.dev_scanner_enabled === 0) ? "DISABLED" : "ENABLED";

    const supportLine = r.help_flag
      ? `${esc(r.support_type || "SUPPORT")} • ${r.support_ts ? fmtNYTime(r.support_ts) : ""}`
      : "No support";

    box.innerHTML = `
      <div class="roomTitle">${esc(r.room_id)}</div>

      <div class="muted small">Support: ${supportLine}</div>

      <div class="roomStats">
        <div>✅ ${r.ok_count}</div>
        <div>⚠️ ${r.dup_count}</div>
        <div>❌ ${r.err_count}</div>
      </div>

      <div class="small">Student: ${esc(lastStudent)}</div>
      <div class="small">Status: ${statusText}${lastErr ? " • " + esc(lastErr) : ""}</div>
      <div class="muted small">Last Scan: ${r.last_ts ? fmtNYTime(r.last_ts) : "—"}</div>
      <div class="muted small">Heartbeat: ${hb}</div>

      <div class="muted small">Device: ${devOnline} • ${esc(devBat)} • ${esc(devQueue)} • ${esc(devScan)} • ${enabled}</div>

      <div class="row" style="margin-top:8px;">
        <button class="ghost" data-ctl="forceUnlock" data-room="${escAttr(r.room_id)}">Force Unlock</button>
        <button class="danger" data-ctl="disable" data-room="${escAttr(r.room_id)}">Disable</button>
        <button class="ghost" data-ctl="enable" data-room="${escAttr(r.room_id)}">Enable</button>
      </div>
    `;

    // keep click-to-open modal (still works)
    box.addEventListener("click", () => openRoom(r));

    // prevent the control buttons from triggering the modal click
    box.querySelectorAll("button[data-ctl]").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const room_id = btn.getAttribute("data-room");
        const action = btn.getAttribute("data-ctl");
        if (!room_id || !action) return;

        if (action === "forceUnlock" && !confirm(`Force unlock ${room_id}?`)) return;
        if (action === "disable" && !confirm(`Disable scanner in ${room_id}?`)) return;
        if (action === "enable" && !confirm(`Enable scanner in ${room_id}?`)) return;

        const res = await api("/api/admin_room_control", {
          method:"POST",
          body: JSON.stringify({ room_id, action })
        });
        if (!res?.ok) alert("Control failed");
      });
    });

    grid.appendChild(box);
  }
}

function openRoom(r) {
  rmTitle.textContent = r.room_id;

  const lastStudent =
    r.last_student_id
      ? `${r.last_name ? r.last_name + " • " : ""}${r.last_student_id}${(r.last_grade || r.last_grade === 0) ? " • G" + r.last_grade : ""}`
      : "—";

  rmBody.innerHTML = `
    <div>OK: ${r.ok_count}</div>
    <div>DUP: ${r.dup_count}</div>
    <div>ERR: ${r.err_count}</div>
    <div>Last Student: ${esc(lastStudent)}</div>
    <div>Last Status: ${esc(r.last_status || "—")}</div>
    <div>Last Error: ${esc(r.last_error || "—")}</div>
    <div>Last Scan: ${r.last_ts ? esc(fmtNYTime(r.last_ts)) : "—"}</div>
    <div>Heartbeat: ${r.last_heartbeat ? esc(fmtNYTime(r.last_heartbeat)) : "—"}</div>
    <div>Support: ${r.help_flag ? "YES" : "no"}</div>
    <div>Support Type: ${esc(r.support_type || "—")}</div>
    <div>Support Time: ${r.support_ts ? esc(fmtNYTime(r.support_ts)) : "—"}</div>
  `;
  roomModal.classList.remove("hidden");
}

/* ======== the rest of your adminCore.js stays the same from here ======== */
/* Rooms actions / Periods actions / Users / Settings / Export / Purge etc */
/* I did not remove them — keep your existing code below unchanged. */

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
  if (res?.ok) alert(`Saved min periods = ${res.min_distinct_periods}`);
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
    alert("Announcement sent");
  }
});

if (annClearBtn) annClearBtn.addEventListener("click", async () => {
  const res = await api("/api/admin_announcement", { method:"DELETE" });
  if (res?.ok) {
    if (annStatus) annStatus.textContent = "Cleared.";
    alert("Announcement cleared");
  }
});

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

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

startIdleWatcher(() => {
  alert("Logged out (idle)");
  showLogin();
});

showLogin();
