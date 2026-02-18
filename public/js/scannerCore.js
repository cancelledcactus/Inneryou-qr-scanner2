import { api, getToken } from "./auth.js";

const roomSelect = document.getElementById("roomSelect");
const lockBtn = document.getElementById("lockBtn");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const videoBox = document.getElementById("videoBox");
const toast = document.getElementById("toast");
const localList = document.getElementById("localList");
const periodLabel = document.getElementById("periodLabel");

const queuePill = document.getElementById("queuePill");
const sentPill  = document.getElementById("sentPill");
const errPill   = document.getElementById("errPill");

const modal = document.getElementById("modal");
const manualBtn = document.getElementById("manualBtn");
const mName = document.getElementById("mName");
const mId = document.getElementById("mId");
const mGrade = document.getElementById("mGrade");
const mSave = document.getElementById("mSave");
const mCancel = document.getElementById("mCancel");

let codeReader = null;
let scanning = false;
let devices = [];
let currentDeviceId = null;

const STORAGE_KEY = "scanner_room_lock_v1";
const QUEUE_KEY = "scanner_queue_v1";
const LOCAL_LIST_KEY = "scanner_local_list_v1";
const PERIOD_KEY = "scanner_period_v1";

let lockedRoom = "";
let isLocked = false;

let queue = loadJson(QUEUE_KEY, []);
let localPeriodList = loadJson(LOCAL_LIST_KEY, []);
let sentCount = 0;
let errCount = 0;

const BATCH_SIZE_DEFAULT = 5;
let BATCH_SIZE = BATCH_SIZE_DEFAULT;
let FLUSH_MS = 12000;

let heartbeatTimer = null;

function loadJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "") ?? fallback; } catch { return fallback; }
}
function saveJson(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

function showToast(msg, type="info") {
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  toast.style.opacity = "1";
  setTimeout(() => (toast.style.opacity = "0"), 1200);
}

/* ------------------ NEW: QR DISPLAY PARSER ------------------ */
function parseDisplayFromQrText(qrText) {
  const raw = String(qrText || "").replace(/\u00A0/g, " ").trim();
  const parts = raw.split(",").map(s => s.trim());

  if (parts.length >= 2) {
    return {
      name: parts[0] || "",
      id: parts[1] || "",
      grade: parts[2] || ""
    };
  }
  return { name: "", id: raw, grade: "" };
}

/* ------------------ UPDATED LOCAL LIST RENDER ------------------ */
function renderLocalList() {
  localList.innerHTML = "";
  for (let i = localPeriodList.length - 1; i >= 0; i--) {
    const s = localPeriodList[i];
    const div = document.createElement("div");
    div.className = "listItem";

    const who = s.name ? `${s.name} (${s.student_id})` : `${s.student_id}`;
    const gradeText = s.grade ? ` • G${s.grade}` : "";

    div.textContent =
      `${who}${gradeText} ${
        s.status === "duplicate"
          ? "⚠️ DUP"
          : s.status === "ok"
          ? "✅"
          : "❌"
      }`;

    localList.appendChild(div);
  }
}

function updatePills() {
  queuePill.textContent = `Queue: ${queue.length}`;
  sentPill.textContent = `Sent: ${sentCount}`;
  errPill.textContent = `Errors: ${errCount}`;
}

async function loadConfig() {
  const res = await fetch("/api/public_settings")
    .then(r => r.json())
    .catch(() => null);

  if (!res?.ok) return;

  const s = res.settings || {};
  const bs = Number(s.batchSize || BATCH_SIZE_DEFAULT);
  const fm = Number(s.flushIntervalMs || 12000);

  BATCH_SIZE = Math.max(1, Math.min(10, bs));
  FLUSH_MS = Math.max(2000, Math.min(60000, fm));
}

async function loadRooms() {
  const res = await fetch("/api/public_rooms")
    .then(r => r.json())
    .catch(() => null);

  const rooms = res?.rooms || [];

  roomSelect.innerHTML = "";
  const opt0 = new Option("Select Room…", "");
  opt0.disabled = true; opt0.selected = true;
  roomSelect.add(opt0);

  for (const r of rooms) roomSelect.add(new Option(r, r));
}

function getLockState() {
  const st = loadJson(STORAGE_KEY, { lockedRoom:"", isLocked:false });
  lockedRoom = st.lockedRoom || "";
  isLocked = !!st.isLocked;
}

function setLockState(room, locked) {
  saveJson(STORAGE_KEY, { lockedRoom: room, isLocked: locked });
  lockedRoom = room;
  isLocked = locked;
}

function applyLockUi() {
  roomSelect.disabled = isLocked;
  lockBtn.textContent = isLocked ? "Locked" : "Lock";
  if (lockedRoom) roomSelect.value = lockedRoom;
}

function setPeriodLabel(p) {
  const val = p || "…";
  periodLabel.textContent = `Period: ${val}`;
  saveJson(PERIOD_KEY, val);
}

/* ------------------ HEARTBEAT ------------------ */
async function sendHeartbeat() {
  if (!isLocked || !lockedRoom) return;
  try {
    const res = await fetch("/api/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room_id: lockedRoom }),
    }).then(r => r.json());

    if (res?.ok && res.period_id) {
      setPeriodLabel(res.period_id);
    }
  } catch {}
}

function startHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(sendHeartbeat, 15000);
  sendHeartbeat();
}

/* ------------------ CAMERA FRAME FEEDBACK ------------------ */
function showFrameFeedback(mark, msg) {
  const frame = document.querySelector(".scanFrame");
  if (!frame) return;

  const markEl = document.getElementById("scanFrameMark");
  const textEl = document.getElementById("scanFrameText");

  if (markEl) markEl.textContent = mark;
  if (textEl) textEl.textContent = msg;

  frame.classList.add("show");
}

function hideFrameFeedback() {
  const frame = document.querySelector(".scanFrame");
  if (frame) frame.classList.remove("show");
}

function pauseCameraThenResume(ms) {
  stopCamera();
  setTimeout(async () => {
    hideFrameFeedback();
    if (isLocked) await startCamera();
  }, ms);
}

/* ------------------ NYC CLOCK (UI ONLY) ------------------ */
function startNYClock() {
  const el = document.getElementById("nyTime");
  if (!el) return;

  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  });

  setInterval(() => {
    el.textContent = `NYC: ${fmt.format(new Date())}`;
  }, 1000);
}

/* ------------------ LOCK BUTTON ------------------ */
lockBtn.addEventListener("click", async () => {
  if (!roomSelect.value) return showToast("Pick a room", "warn");
  setLockState(roomSelect.value, true);
  applyLockUi();
  showToast(`Locked: ${roomSelect.value}`, "ok");
  startHeartbeat();
});

/* ------------------ MANUAL ENTRY ------------------ */
manualBtn.addEventListener("click", () => {
  if (!isLocked) return showToast("Lock room first", "warn");
  mName.value = ""; mId.value = ""; mGrade.value = "";
  modal.classList.remove("hidden");
});
mCancel.addEventListener("click", () => modal.classList.add("hidden"));

mSave.addEventListener("click", () => {
  const sid = String(mId.value || "").trim();
  if (!/^\d{9}$/.test(sid)) return showToast("Student ID must be 9 digits", "warn");

  const nm = String(mName.value || "").trim();
  if (!nm.includes(" ")) return showToast("Enter first AND last name", "warn");

  const gr = String(mGrade.value || "").trim();
  if (!/^\d{1,2}$/.test(gr)) return showToast("Grade required", "warn");

  const grade = Number(gr);

  queue.push({
    qr_text: `${nm} , ${sid} , ${grade}`.trim(),
    manual: true,
    client_ts: Date.now()
  });

  saveJson(QUEUE_KEY, queue);
  updatePills();
  showToast("Queued manual entry", "ok");
  modal.classList.add("hidden");
  maybeFlush(true);
});

/* ------------------ CAMERA START/STOP ------------------ */
startBtn.addEventListener("click", async () => {
  if (!isLocked) return showToast("Lock room first", "warn");
  await startCamera();
});
stopBtn.addEventListener("click", () => stopCamera());

async function startCamera() {
  if (scanning) return;
  if (!window.ZXing?.BrowserMultiFormatReader) return showToast("ZXing not loaded", "err");

  videoBox.innerHTML = `
    <video id="scannerVideo" autoplay playsinline muted style="width:100%;height:100%"></video>
  `;

  try {
    if (!codeReader) codeReader = new ZXing.BrowserMultiFormatReader();
    try { codeReader.reset(); } catch {}

    devices = await codeReader.listVideoInputDevices();
    if (!devices || devices.length === 0) {
      showToast("No camera found", "err");
      return;
    }

    const pickBack = (list) => {
      const preferred = list.find(d => /back|rear|environment/i.test(d.label || ""));
      return preferred?.deviceId || list[0].deviceId;
    };

    if (!currentDeviceId) currentDeviceId = pickBack(devices);

    scanning = true;
    showToast("Scanning…", "info");

    codeReader.decodeFromVideoDevice(
      currentDeviceId,
      "scannerVideo",
      (result, err) => {
        if (!scanning) return;

        if (result) {
          const text = (typeof result.getText === "function") ? result.getText() : (result.text || "");
          onScan(String(text || "").trim());
        }
      }
    );

  } catch (e) {
    console.error(e);
    scanning = false;
    showToast("Camera failed. Check Safari camera permission.", "err");
  }
}

function stopCamera() {
  scanning = false;
  try { codeReader?.reset(); } catch {}
  showToast("Camera stopped", "info");
}

/* ------------------ SCAN LOGIC (UNTOUCHED) ------------------ */
let lastScanText = "";
let lastScanAt = 0;
const SCAN_COOLDOWN_MS = 2000;
let scanCooldownUntil = 0;

function onScan(text) {
  const now = Date.now();
  const t = String(text || "").replace(/\u00A0/g, " ").trim();

  if (now < scanCooldownUntil) return;
  if (t === lastScanText && (now - lastScanAt) < SCAN_COOLDOWN_MS) return;

  lastScanText = t;
  lastScanAt = now;
  scanCooldownUntil = now + SCAN_COOLDOWN_MS;

  const possibleIdMatch = t.match(/\b(\d{9})\b/);
  if (possibleIdMatch) {
    const scannedId = possibleIdMatch[1];

    fetch("/api/badge_role", {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ id: scannedId })
    })
    .then(r => r.json())
    .then(res => {
      if (res?.ok && res.found && (res.role === "ADMIN" || res.role === "TECH")) {
        setLockState("", false);
        applyLockUi();
        showToast(`${res.role} badge accepted — room unlocked`, "ok");
        scanCooldownUntil = Date.now() + 800;
      } else {
        queue.push({ qr_text: t, manual: false, client_ts: now });
        saveJson(QUEUE_KEY, queue);
        updatePills();
        showToast("Queued", "info");
        maybeFlush(false);
      }
    })
    .catch(() => {
      queue.push({ qr_text: t, manual: false, client_ts: now });
      saveJson(QUEUE_KEY, queue);
      updatePills();
      showToast("Queued", "info");
      maybeFlush(false);
    });

    return;
  }

  queue.push({ qr_text: t, manual: false, client_ts: now });
  saveJson(QUEUE_KEY, queue);
  updatePills();
  showToast("Queued", "info");
  maybeFlush(false);
}

/* ------------------ FLUSH ------------------ */
async function maybeFlush(force) {
  if (!isLocked) return;
  if (force || queue.length >= BATCH_SIZE) flushQueue();
}

let flushing = false;

async function flushQueue() {
  if (flushing) return;
  if (queue.length === 0) return;
  flushing = true;

  const room_id = lockedRoom;
  const batch = queue.slice(0, BATCH_SIZE);

  try {
    const res = await api("/api/scan_batch", {
      method: "POST",
      body: JSON.stringify({ room_id, items: batch }),
    });

    if (!res?.ok) {
      errCount++;
      showToast("Upload failed (will retry)", "warn");
      updatePills();
      flushing = false;
      return;
    }

    if (res.period_id) setPeriodLabel(res.period_id);

    queue = queue.slice(batch.length);
    saveJson(QUEUE_KEY, queue);

    for (let i = 0; i < (res.results || []).length; i++) {
      const r = res.results[i];
      const parsed = parseDisplayFromQrText(batch[i]?.qr_text || "");

      if (r.status === "ok") sentCount++;
      if (r.status === "error") errCount++;

      localPeriodList.push({
        student_id: r.student_id || parsed.id || "UNKNOWN",
        name: parsed.name || "",
        grade: parsed.grade || "",
        status: r.status
      });

      if (localPeriodList.length > 120) localPeriodList.shift();
    }

    saveJson(LOCAL_LIST_KEY, localPeriodList);
    renderLocalList();
    updatePills();

    const last = (res.results || []).slice(-1)[0];

    if (last?.status === "ok") {
      showFrameFeedback("✅", "Saved. Next student.");
      pauseCameraThenResume(900);
    }
    else if (last?.status === "duplicate") {
      showFrameFeedback("⚠️", "Duplicate scan.");
      pauseCameraThenResume(1200);
    }
    else {
      showFrameFeedback("❌", "Scan error.");
      pauseCameraThenResume(1500);
    }

  } catch (e) {
    errCount++;
    showToast("Upload error (will retry)", "warn");
    updatePills();
  } finally {
    flushing = false;
  }
}

function startFlushTimer() {
  setInterval(() => {
    if (!isLocked) return;
    if (queue.length > 0) flushQueue();
  }, FLUSH_MS);
}

/* ------------------ INIT ------------------ */
(async function init() {
  getLockState();
  await loadConfig();
  await loadRooms();
  applyLockUi();
  renderLocalList();
  updatePills();
  setPeriodLabel(loadJson(PERIOD_KEY, "…"));
  startFlushTimer();
  startNYClock();

  if (isLocked && lockedRoom) startHeartbeat();
})();
