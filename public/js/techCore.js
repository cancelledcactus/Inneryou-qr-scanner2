import { api, setToken, clearToken, startIdleWatcher, touchActivity } from "./auth.js";

const loginBox = document.getElementById("loginBox");
const idInput = document.getElementById("idInput");
const loginBtn = document.getElementById("loginBtn");
const scanLoginBtn = document.getElementById("scanLoginBtn");

const main = document.getElementById("main");
const grid = document.getElementById("grid");
const periodPill = document.getElementById("periodPill");
const nyPill = document.getElementById("nyPill");

const notif = document.getElementById("notif");

const openScannerBtn = document.getElementById("openScannerBtn");
const logoutBtn = document.getElementById("logoutBtn");

const roomModal = document.getElementById("roomModal");
const rmTitle = document.getElementById("rmTitle");
const rmBody = document.getElementById("rmBody");
const rmClose = document.getElementById("rmClose");

const supportPanel = document.getElementById("supportPanel");
const supportList = document.getElementById("supportList");
const supportTitle = document.getElementById("supportTitle");
const supportOpenBtn = document.getElementById("supportOpenBtn");
const supportResolvedBtn = document.getElementById("supportResolvedBtn");
const supportCloseBtn = document.getElementById("supportCloseBtn");

let codeReader = null;
let mediaStream = null;

let refreshTimer = null;
let supportTimer = null;

let lastSupportIds = new Set();
let currentSupportStatus = "OPEN";

function showToast(msg, type="info") {
  if (!notif) return;
  notif.textContent = msg;
  notif.className = `toast ${type}`;
  notif.style.opacity = "1";
  setTimeout(() => (notif.style.opacity = "0"), 2000);
}

loginBtn.addEventListener("click", async () => {
  const id = String(idInput.value || "").trim();
  if (!/^\d{9}$/.test(id)) return alert("Enter a 9-digit ID");
  const res = await api("/api/login", { method:"POST", body: JSON.stringify({ id }) });
  if (!res?.ok || (res.role !== "TECH" && res.role !== "ADMIN")) return alert("Access denied");
  idInput.value = "";
  setToken(res.token, res.role, res.idleTimeoutMs);
  showMain();
});

scanLoginBtn.addEventListener("click", async () => {
  const id = await scanOneQrForId();
  if (!id) return;
  idInput.value = id;
  loginBtn.click();
});

logoutBtn.addEventListener("click", () => {
  clearToken();
  showLogin();
});

openScannerBtn.addEventListener("click", () => {
  window.open("/scanner.html?mode=tech", "_blank");
});

rmClose.addEventListener("click", () => roomModal.classList.add("hidden"));

supportOpenBtn.addEventListener("click", () => {
  currentSupportStatus = "OPEN";
  supportTitle.textContent = "Support Requests (OPEN)";
  supportPanel.classList.remove("hidden");
  refreshSupport(true);
});
supportResolvedBtn.addEventListener("click", () => {
  currentSupportStatus = "RESOLVED";
  supportTitle.textContent = "Support Requests (RESOLVED)";
  supportPanel.classList.remove("hidden");
  refreshSupport(true);
});
supportCloseBtn.addEventListener("click", () => supportPanel.classList.add("hidden"));

function showLogin() {
  loginBox.classList.remove("hidden");
  main.classList.add("hidden");
  if (refreshTimer) clearInterval(refreshTimer);
  if (supportTimer) clearInterval(supportTimer);
}

function showMain() {
  loginBox.classList.add("hidden");
  main.classList.remove("hidden");
  startNYClock();
  startLoops();
}

function startLoops() {
  if (refreshTimer) clearInterval(refreshTimer);
  if (supportTimer) clearInterval(supportTimer);

  refresh();
  refreshTimer = setInterval(refresh, 3000);

  refreshSupport(true);
  supportTimer = setInterval(() => refreshSupport(false), 3500);
}

async function refresh() {
  touchActivity();
  const res = await api("/api/rooms_summary");
  if (!res?.ok) return;

  periodPill.textContent = `Period: ${res.period_id}`;
  renderGrid(res.rooms || []);
}

function renderGrid(rooms) {
  grid.innerHTML = "";
  for (const r of rooms) {
    const box = document.createElement("div");
    box.className = `roomBox ${r.help_flag ? "help" : ""}`;

    // NYC last time display (don’t rely on server locale)
    const lastTime = r.last_ts ? formatNYTime(r.last_ts) : "—";

    const lastStudentLine = r.last_student_id
      ? `${r.last_name ? r.last_name + " • " : ""}${r.last_student_id}${(r.last_grade || r.last_grade === 0) ? " • G" + r.last_grade : ""}`
      : "—";

    const statusLine =
      r.last_status === "ok" ? "✅ OK" :
      r.last_status === "dup" ? "⚠️ DUP" :
      r.last_status === "err" ? "❌ ERR" :
      "—";

    const errDetail = (r.last_status === "err" && r.last_error) ? ` • ${escapeHtml(r.last_error)}` : "";

    const supportBadge = r.help_flag
      ? `<div class="supportBadge">${escapeHtml(r.support_type || "SUPPORT")} • ${r.support_ts ? formatNYTime(r.support_ts) : ""}</div>`
      : `<div class="supportBadge off">No support</div>`;

    box.innerHTML = `
      <div class="roomTitle">${escapeHtml(r.room_id)}</div>
      ${supportBadge}
      <div class="roomStats">
        <div>✅ ${r.ok_count}</div>
        <div>⚠️ ${r.dup_count}</div>
        <div>❌ ${r.err_count}</div>
      </div>
      <div class="muted small">Last: ${lastTime}</div>
      <div class="small">Student: ${escapeHtml(lastStudentLine)}</div>
      <div class="small">Status: ${statusLine}${errDetail}</div>
    `;

    box.addEventListener("click", () => openRoom(r));
    grid.appendChild(box);
  }
}

function openRoom(r) {
  rmTitle.textContent = r.room_id;

  const lastTime = r.last_ts ? formatNYTime(r.last_ts) : "—";
  const lastStudent = r.last_student_id
    ? `${r.last_name ? r.last_name + " • " : ""}${r.last_student_id}${(r.last_grade || r.last_grade === 0) ? " • G" + r.last_grade : ""}`
    : "—";

  rmBody.innerHTML = `
    <div>OK: ${r.ok_count}</div>
    <div>DUP: ${r.dup_count}</div>
    <div>ERR: ${r.err_count}</div>
    <div>Last Student: ${escapeHtml(lastStudent)}</div>
    <div>Last Scan: ${escapeHtml(lastTime)}</div>
    <div>Last Status: ${escapeHtml(r.last_status || "—")}</div>
    <div>Last Error: ${escapeHtml(r.last_error || "—")}</div>
    <div>Support: ${r.help_flag ? "YES" : "no"}</div>
    <div>Support Type: ${escapeHtml(r.support_type || "—")}</div>
    <div>Support Time: ${r.support_ts ? escapeHtml(formatNYTime(r.support_ts)) : "—"}</div>
  `;
  roomModal.classList.remove("hidden");
}

async function refreshSupport(forceToast) {
  try {
    const res = await api(`/api/support_list?status=${encodeURIComponent(currentSupportStatus)}`);
    if (!res?.ok) return;

    const items = res.items || [];
    renderSupportList(items);

    if (currentSupportStatus === "OPEN") {
      const ids = new Set(items.map(x => x.req_id));
      if (!sameSet(ids, lastSupportIds)) {
        // new/changed queue
        const newOnes = items.filter(x => !lastSupportIds.has(x.req_id));
        if (forceToast || newOnes.length) {
          showToast(newOnes.length ? `New support request (${newOnes[0].room_id})` : "Support queue updated", "warn");
        }
        lastSupportIds = ids;
      }
    }
  } catch {}
}

function renderSupportList(items) {
  if (!supportList) return;
  supportList.innerHTML = "";

  if (!items.length) {
    const div = document.createElement("div");
    div.className = "listItem";
    div.textContent = "No items";
    supportList.appendChild(div);
    return;
  }

  for (const it of items) {
    const div = document.createElement("div");
    div.className = "listItem";

    const when = it.created_ts ? formatNYTime(it.created_ts) : "—";
    const note = it.note ? escapeHtml(it.note) : "";

    div.innerHTML = `
      <div class="row between">
        <div><b>${escapeHtml(it.room_id)}</b> • ${escapeHtml(it.support_type)} • <span class="muted">${escapeHtml(when)}</span></div>
        ${it.status === "OPEN" ? `<button class="ghost" data-resolve="${escapeHtml(it.req_id)}">Resolve</button>` : ""}
      </div>
      ${note ? `<div class="small muted">${note}</div>` : ""}
      ${it.status === "RESOLVED" ? `<div class="small">Resolved by ${escapeHtml(it.resolved_by || "—")} at ${it.resolved_ts ? escapeHtml(formatNYTime(it.resolved_ts)) : "—"}</div>` : ""}
    `;

    supportList.appendChild(div);
  }

  // resolve buttons
  supportList.querySelectorAll("button[data-resolve]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const req_id = btn.getAttribute("data-resolve");
      if (!req_id) return;
      const ok = confirm("Mark as resolved?");
      if (!ok) return;
      const res = await api("/api/support_resolve", { method:"POST", body: JSON.stringify({ req_id }) });
      if (res?.ok) {
        showToast("Resolved", "ok");
        refreshSupport(true);
        refresh();
      }
    });
  });
}

function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function startNYClock() {
  if (!nyPill) return;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  });
  setInterval(() => {
    nyPill.textContent = `NYC: ${fmt.format(new Date())}`;
  }, 1000);
}

function formatNYTime(isoOrSqlite) {
  // supports ISO or SQLite datetime('now') output
  const d = new Date(String(isoOrSqlite).replace(" ", "T") + (String(isoOrSqlite).includes("T") ? "" : "Z"));
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  });
  return fmt.format(d);
}

/* Badge scan login: keep EXACT behavior (scan -> extract 9 digits -> login) */
async function scanOneQrForId() {
  if (!navigator.mediaDevices?.getUserMedia) {
    alert("Camera not supported");
    return null;
  }
  if (!window.ZXing?.BrowserMultiFormatReader) {
    alert("ZXing missing");
    return null;
  }

  const overlay = document.createElement("div");
  overlay.className = "scanOverlay";
  overlay.innerHTML = `
    <div class="scanOverlayCard">
      <h3>Scan your ID badge</h3>
      <div id="scanVidWrap" class="videoBox" style="aspect-ratio:1/1;margin-top:10px;position:relative;"></div>
      <div class="muted small" style="margin-top:8px;">Align QR in the box</div>
      <button id="cancelScan" class="ghost" style="margin-top:10px;">Cancel</button>
    </div>
  `;
  document.body.appendChild(overlay);

  const vidWrap = overlay.querySelector("#scanVidWrap");
  const cancelBtn = overlay.querySelector("#cancelScan");

  vidWrap.innerHTML = `
    <video id="techScannerVideo" autoplay playsinline muted style="width:100%;height:100%"></video>
    <div class="scanFrame">
      <div class="scanFrameMark">📷</div>
      <div class="scanFrameText">Scan Badge</div>
    </div>
  `;

  const videoId = "techScannerVideo";

  let done = false;
  let localReader = new ZXing.BrowserMultiFormatReader();

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
        videoId,
        (result, err) => {
          if (done) return;

          if (result) {
            const txt = (typeof result.getText === "function")
              ? result.getText()
              : (result.text || "");

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
