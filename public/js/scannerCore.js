import { api, getToken, requireLoginIfNeeded } from "./auth.js";

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
let mediaStream = null;
let scanning = false;

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

function renderLocalList() {
  localList.innerHTML = "";
  for (let i = localPeriodList.length - 1; i >= 0; i--) {
    const s = localPeriodList[i];
    const div = document.createElement("div");
    div.className = "listItem";
    div.textContent = `${s.student_id} ${s.status === "duplicate" ? "⚠️ DUP" : s.status === "ok" ? "✅" : "❌"}`;
    localList.appendChild(div);
  }
}

function updatePills() {
  queuePill.textContent = `Queue: ${queue.length}`;
  sentPill.textContent = `Sent: ${sentCount}`;
  errPill.textContent = `Errors: ${errCount}`;
}

async function loadConfig() {
  // Pull settings from server via /api/admin_settings?public=1 (we’ll add below) or keep defaults.
  // To keep this minimal, we’ll just keep defaults for now.
  // You can later fetch batchSize/flushInterval from settings.
}

async function loadRooms() {
  // For now, rooms come from summary endpoint (works for everyone)
  // If you want scanners to see only rooms, we can add /api/public/rooms too.
  // We'll use rooms_summary even if not logged in (if you want locked down, we can change).
  const res = await fetch("/api/rooms_summary", { headers: authHeadersMaybe() }).then(r=>r.json()).catch(()=>null);

  // If not logged in and endpoint blocks, we fallback to local list; admin can pre-load rooms.
  const rooms = res?.rooms?.map(r => r.room_id) || [];

  roomSelect.innerHTML = "";
  const opt0 = new Option("Select Room…", "");
  opt0.disabled = true; opt0.selected = true;
  roomSelect.add(opt0);

  for (const r of rooms) roomSelect.add(new Option(r, r));
}

function authHeadersMaybe() {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
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

lockBtn.addEventListener("click", async () => {
  if (!roomSelect.value) return showToast("Pick a room", "warn");
  setLockState(roomSelect.value, true);
  applyLockUi();
  showToast(`Locked: ${roomSelect.value}`, "ok");
});

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
  const gr = String(mGrade.value || "").trim();
  const grade = /^\d{1,2}$/.test(gr) ? Number(gr) : null;

  queue.push({
    qr_text: `${nm} , ${sid} , ${grade ?? ""}`.trim(),
    manual: true,
    client_ts: Date.now()
  });
  saveJson(QUEUE_KEY, queue);
  updatePills();
  showToast("Queued manual entry", "ok");
  modal.classList.add("hidden");

  maybeFlush(true);
});

startBtn.addEventListener("click", async () => {
  if (!isLocked) return showToast("Lock room first", "warn");
  await startCamera();
});
stopBtn.addEventListener("click", () => stopCamera());

async function startCamera() {
  if (scanning) return;
  if (!navigator.mediaDevices?.getUserMedia) return showToast("Camera not supported", "err");
  if (!window.ZXing?.BrowserMultiFormatReader) return showToast("ZXing not loaded", "err");

  videoBox.innerHTML = "";
  const video = document.createElement("video");
  video.setAttribute("playsinline", "");
  video.muted = true;
  video.autoplay = true;
  video.style.width = "100%";
  video.style.height = "100%";
  videoBox.appendChild(video);

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio:false, video:{ facingMode:{ ideal:"environment" } } });
    video.srcObject = mediaStream;
    await video.play();

    codeReader = codeReader || new ZXing.BrowserMultiFormatReader();
    scanning = true;
    showToast("Scanning…", "info");

    codeReader.decodeFromVideoElement(video, (result, err) => {
      if (result) onScan(result.getText());
    });
  } catch (e) {
    scanning = false;
    showToast("Camera blocked. Allow permission.", "err");
  }
}

function stopCamera() {
  scanning = false;
  try { codeReader?.reset(); } catch {}
  try { mediaStream?.getTracks()?.forEach(t=>t.stop()); } catch {}
  mediaStream = null;
  showToast("Camera stopped", "info");
}

let lastScanText = "";
let lastScanAt = 0;

function onScan(text) {
  const now = Date.now();
  const t = String(text || "").trim();

  // simple debounce to reduce double reads
  if (t === lastScanText && (now - lastScanAt) < 900) return;
  lastScanText = t;
  lastScanAt = now;

  // Queue the scan
  queue.push({ qr_text: t, manual: false, client_ts: now });
  saveJson(QUEUE_KEY, queue);
  updatePills();

  // show queued quickly, server will confirm after flush
  showToast("Queued", "info");

  maybeFlush(false);
}

async function maybeFlush(force) {
  if (!isLocked) return;
  if (!getToken()) {
    // Scanner can be “open” (no login) if you want; if you want to lock scanners, add SCANNER role and require login here.
    // For now, we allow scanning without login and set source_role via server token if present.
  }

  if (force || queue.length >= BATCH_SIZE) {
    flushQueue();
  }
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

    // remove sent items
    queue = queue.slice(batch.length);
    saveJson(QUEUE_KEY, queue);

    // update local list with results
    for (const r of res.results || []) {
      if (r.status === "ok") sentCount++;
      if (r.status === "duplicate") { /* count as sent too */ }
      if (r.status === "error") errCount++;

      localPeriodList.push({ student_id: r.student_id || "UNKNOWN", status: r.status });
      if (localPeriodList.length > 120) localPeriodList.shift();
    }
    saveJson(LOCAL_LIST_KEY, localPeriodList);
    renderLocalList();
    updatePills();

    // show the last result
    const last = (res.results || []).slice(-1)[0];
    if (last?.status === "ok") showToast("Saved ✅", "ok");
    else if (last?.status === "duplicate") showToast("Duplicate ⚠️", "warn");
    else showToast("Error ❌", "err");

  } catch (e) {
    errCount++;
    showToast("Upload error (will retry)", "warn");
    updatePills();
  } finally {
    flushing = false;
  }
}

// Period label: we’ll read it from scan responses or tech endpoint when logged in.
// Simple: update from heartbeat response later. For now, show unknown.
function setPeriodLabel(p) {
  periodLabel.textContent = `Period: ${p}`;
}

function startFlushTimer() {
  setInterval(() => {
    if (!isLocked) return;
    if (queue.length > 0) flushQueue();
  }, FLUSH_MS);
}

// Init
(async function init() {
  getLockState();
  applyLockUi();
  await loadConfig();
  await loadRooms();
  renderLocalList();
  updatePills();
  setPeriodLabel(loadJson(PERIOD_KEY, "…"));
  startFlushTimer();
})();
