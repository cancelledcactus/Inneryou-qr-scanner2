import { api, setToken, clearToken, startIdleWatcher, touchActivity } from "./auth.js";

const loginBox = document.getElementById("loginBox");
const idInput = document.getElementById("idInput");
const loginBtn = document.getElementById("loginBtn");
const scanLoginBtn = document.getElementById("scanLoginBtn");

const main = document.getElementById("main");
const grid = document.getElementById("grid");
const periodPill = document.getElementById("periodPill");

const openScannerBtn = document.getElementById("openScannerBtn");
const logoutBtn = document.getElementById("logoutBtn");

const roomModal = document.getElementById("roomModal");
const rmTitle = document.getElementById("rmTitle");
const rmBody = document.getElementById("rmBody");
const rmClose = document.getElementById("rmClose");

let codeReader = null;
let mediaStream = null;

loginBtn.addEventListener("click", async () => {
  const id = String(idInput.value || "").trim();
  if (!/^\d{9}$/.test(id)) return alert("Enter a 9-digit ID");
  const res = await api("/api/login", { method:"POST", body: JSON.stringify({ id }) });
  if (!res?.ok || (res.role !== "TECH" && res.role !== "ADMIN")) return alert("Access denied");
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

function showLogin() {
  loginBox.classList.remove("hidden");
  main.classList.add("hidden");
}
function showMain() {
  loginBox.classList.add("hidden");
  main.classList.remove("hidden");
  refreshLoop();
}

async function refreshLoop() {
  await refresh();
  setInterval(refresh, 3000);
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
    box.innerHTML = `
      <div class="roomTitle">${escapeHtml(r.room_id)}</div>
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

function escapeHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

// One-scan QR login helper
async function scanOneQrForId() {
  if (!navigator.mediaDevices?.getUserMedia) { alert("Camera not supported"); return null; }
  if (!window.ZXing?.BrowserMultiFormatReader) { alert("ZXing missing"); return null; }

  const overlay = document.createElement("div");
  overlay.className = "scanOverlay";
  overlay.innerHTML = `<div class="scanOverlayCard"><h3>Scan your ID badge</h3><div id="scanVid"></div><button id="cancelScan" class="ghost">Cancel</button></div>`;
  document.body.appendChild(overlay);

  const vidWrap = overlay.querySelector("#scanVid");
  const cancel = overlay.querySelector("#cancelScan");

  const video = document.createElement("video");
  video.setAttribute("playsinline","");
  video.autoplay = true;
  video.muted = true;
  video.style.width = "100%";
  vidWrap.appendChild(video);

  codeReader = codeReader || new ZXing.BrowserMultiFormatReader();

  let done = false;
  cancel.onclick = () => { done = true; cleanup(); };

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio:false, video:{ facingMode:{ ideal:"environment" } } });
    video.srcObject = mediaStream;
    await video.play();

    return await new Promise((resolve) => {
      codeReader.decodeFromVideoElement(video, (result) => {
        if (done) return;
        if (result) {
          const txt = result.getText();
          const m = String(txt).match(/\b(\d{9})\b/);
          if (m) {
            done = true;
            cleanup();
            resolve(m[1]);
          }
        }
      });
      function cleanup() {
        try { codeReader.reset(); } catch {}
        try { mediaStream?.getTracks()?.forEach(t=>t.stop()); } catch {}
        overlay.remove();
      }
    });
  } catch (e) {
    alert("Camera blocked");
    overlay.remove();
    return null;
  }
}

startIdleWatcher(() => {
  alert("Logged out (idle)");
  showLogin();
});
showLogin();
