const STORE_KEY = "toolQrRegister.v1";
const DEFAULT_SETTINGS = {
  adminPin: "1234",
  foremanEmails: "",
  siteName: "Jundee"
};
const IS_SERVER = location.protocol.startsWith("http");

const state = loadState();
let scannerStream = null;
let scannerTimer = null;
let adminUnlocked = false;

const els = {
  assetForm: document.querySelector("#assetForm"),
  adminPanel: document.querySelector("#adminPanel"),
  adminLoginForm: document.querySelector("#adminLoginForm"),
  adminControls: document.querySelector("#adminControls"),
  checkoutForm: document.querySelector("#checkoutForm"),
  assetTable: document.querySelector("#assetTable"),
  historyList: document.querySelector("#historyList"),
  assetLookup: document.querySelector("#assetLookup"),
  lookupResult: document.querySelector("#lookupResult"),
  personName: document.querySelector("#personName"),
  movementNotes: document.querySelector("#movementNotes"),
  scannerStatus: document.querySelector("#scannerStatus"),
  scannerVideo: document.querySelector("#scannerVideo"),
  searchBox: document.querySelector("#searchBox"),
  foremanEmails: document.querySelector("#foremanEmails"),
  siteName: document.querySelector("#siteName"),
  newAdminPin: document.querySelector("#newAdminPin"),
  labelSheet: document.querySelector("#labelSheet")
};

document.addEventListener("DOMContentLoaded", async () => {
  await hydrateFromServer();
  bindEvents();
  render();
});

function bindEvents() {
  els.assetForm.addEventListener("submit", saveAsset);
  els.adminLoginForm.addEventListener("submit", unlockAdmin);
  els.checkoutForm.addEventListener("submit", event => {
    event.preventDefault();
    moveAsset("checkout");
  });
  document.querySelector("#adminToggle").addEventListener("click", toggleAdminPanel);
  document.querySelector("#adminLogout").addEventListener("click", lockAdmin);
  document.querySelector("#settingsForm").addEventListener("submit", saveSettings);
  document.querySelector("#returnButton").addEventListener("click", () => moveAsset("return"));
  document.querySelector("#scanButton").addEventListener("click", scanQr);
  document.querySelector("#sampleData").addEventListener("click", addSampleData);
  document.querySelector("#printLabels").addEventListener("click", printLabels);
  document.querySelector("#exportData").addEventListener("click", exportData);
  document.querySelector("#importData").addEventListener("change", importData);
  document.querySelector("#clearHistory").addEventListener("click", clearHistory);
  els.searchBox.addEventListener("input", renderAssets);
  els.assetLookup.addEventListener("input", updateLookup);
}

function loadState() {
  const fallback = {
    assets: Array.isArray(window.REGISTERED_ASSETS) ? window.REGISTERED_ASSETS.map(prepareAsset) : [],
    history: [],
    settings: { ...DEFAULT_SETTINGS }
  };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (!saved) return fallback;
    saved.assets = (saved.assets || []).map(prepareAsset);
    saved.history = saved.history || [];
    saved.settings = { ...DEFAULT_SETTINGS, ...(saved.settings || {}) };
    if (!saved.assets.length && fallback.assets.length) return fallback;
    return saved;
  } catch {
    return fallback;
  }
}

function persist() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

async function hydrateFromServer() {
  if (!IS_SERVER) return;
  try {
    const response = await fetch("/api/state");
    if (!response.ok) throw new Error("State could not be loaded");
    const serverState = await response.json();
    applyServerState(serverState);
  } catch {
    setScannerMessage("Server data could not be loaded. Local browser data is showing.");
  }
}

function applyServerState(serverState) {
  state.assets = (serverState.assets || []).map(prepareAsset);
  state.history = serverState.history || [];
  state.settings = { ...DEFAULT_SETTINGS, ...(serverState.settings || {}) };
  persist();
}

async function syncFullState() {
  if (!IS_SERVER) return;
  const response = await fetch("/api/admin/state", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-pin": getAdminPin()
    },
    body: JSON.stringify(state)
  });
  if (!response.ok) throw new Error("Server save failed");
  const payload = await response.json();
  applyServerState(payload.state);
}

function getAdminPin() {
  return sessionStorage.getItem("toolQrAdminPin") || state.settings.adminPin || "";
}

async function saveAsset(event) {
  event.preventDefault();
  if (!adminUnlocked) {
    alert("Unlock admin before adding or editing tools.");
    return;
  }
  const assetNumber = getValue("#assetNumber").toUpperCase();
  const existing = state.assets.find(asset => asset.assetNumber === assetNumber && !asset.duplicateAssetNumber);
  const details = {
    assetNumber,
    name: getValue("#toolName"),
    category: getValue("#toolCategory"),
    location: getValue("#homeLocation"),
    status: existing?.status || "available",
    holder: existing?.holder || "",
    lastMoved: existing?.lastMoved || "",
    serialNumber: existing?.serialNumber || "",
    condition: existing?.condition || "",
    partNumber: existing?.partNumber || "",
    id: existing?.id || assetNumber,
    qrValue: existing?.qrValue || assetNumber,
    duplicateAssetNumber: false
  };

  if (existing) {
    Object.assign(existing, details);
  } else {
    state.assets.push(details);
  }

  state.assets.sort((a, b) => a.assetNumber.localeCompare(b.assetNumber));
  persist();
  try {
    await syncFullState();
  } catch {
    alert("Tool saved locally, but the Render server did not accept the update.");
  }
  event.target.reset();
  render();
}

function toggleAdminPanel() {
  els.adminPanel.hidden = !els.adminPanel.hidden;
  renderAdmin();
}

async function unlockAdmin(event) {
  event.preventDefault();
  const pin = document.querySelector("#adminPin").value;
  if (IS_SERVER) {
    const response = await fetch("/api/admin/check", {
      method: "POST",
      headers: { "x-admin-pin": pin }
    });
    if (!response.ok) {
      alert("Admin PIN is incorrect.");
      return;
    }
  } else {
    if (pin !== state.settings.adminPin) {
      alert("Admin PIN is incorrect.");
      return;
    }
  }
  adminUnlocked = true;
  sessionStorage.setItem("toolQrAdminPin", pin);
  document.querySelector("#adminPin").value = "";
  render();
}

function lockAdmin() {
  adminUnlocked = false;
  sessionStorage.removeItem("toolQrAdminPin");
  render();
}

async function saveSettings(event) {
  event.preventDefault();
  if (!adminUnlocked) return;
  state.settings.foremanEmails = els.foremanEmails.value.trim();
  state.settings.siteName = els.siteName.value.trim() || "Jundee";
  if (!IS_SERVER && els.newAdminPin.value.trim()) {
    state.settings.adminPin = els.newAdminPin.value.trim();
    els.newAdminPin.value = "";
  }
  persist();
  try {
    if (IS_SERVER) {
      const response = await fetch("/api/admin/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-pin": getAdminPin()
        },
        body: JSON.stringify({
          foremanEmails: state.settings.foremanEmails,
          siteName: state.settings.siteName
        })
      });
      if (!response.ok) throw new Error("Settings save failed");
      const payload = await response.json();
      applyServerState(payload.state);
    }
    els.newAdminPin.value = "";
    renderAdmin();
  } catch {
    alert("Settings saved locally, but the Render server did not accept the update.");
  }
}

async function moveAsset(type) {
  const lookup = els.assetLookup.value.trim().toUpperCase();
  const asset = findAssetByLookup(lookup);
  if (!asset) {
    const matches = state.assets.filter(item => item.assetNumber === lookup);
    setLookupMessage(matches.length > 1 ? "That asset number is duplicated. Scan the QR label so the serial number is included." : "No tool found for that asset number.");
    return;
  }

  const person = els.personName.value.trim();
  if (type === "checkout" && !person) {
    setLookupMessage("Add the person's name before logging this tool out.");
    return;
  }

  if (IS_SERVER) {
    try {
      const response = await fetch("/api/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          lookup,
          assetId: asset.id,
          person,
          notes: els.movementNotes.value.trim()
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Movement failed");
      applyServerState(payload.state);
      els.personName.value = "";
      els.movementNotes.value = "";
      render();
      const emailText = payload.email?.sent ? "Foreman email sent." : `Foreman email not sent: ${payload.email?.reason || "not configured"}.`;
      setLookupMessage(`${formatLookup(payload.asset)}<br><span class="duplicate-note">${escapeHtml(emailText)}</span>`);
    } catch (error) {
      setLookupMessage(escapeHtml(error.message));
    }
    return;
  }

  const timestamp = new Date().toISOString();
  asset.status = type === "checkout" ? "out" : "available";
  asset.holder = type === "checkout" ? person : "";
  asset.lastMoved = timestamp;
  state.history.unshift({
    id: makeId(),
    assetNumber: asset.assetNumber,
    toolName: asset.name,
    type,
    person: person || "Workshop",
    notes: els.movementNotes.value.trim(),
    timestamp
  });
  const movement = state.history[0];

  persist();
  els.personName.value = "";
  els.movementNotes.value = "";
  render();
  setLookupMessage(formatLookup(asset));
  openMovementEmail(type, asset, movement);
}

function updateLookup() {
  const lookup = els.assetLookup.value.trim().toUpperCase();
  if (!lookup) {
    setLookupMessage("Select a tool to log it out or back in.");
    return;
  }

  const asset = findAssetByLookup(lookup);
  if (asset) {
    setLookupMessage(formatLookup(asset));
    return;
  }

  const matches = state.assets.filter(item => item.assetNumber === lookup);
  if (matches.length > 1) {
    setLookupMessage(`<strong>${escapeHtml(lookup)}</strong> is duplicated in the register. Scan the QR label or enter the serial number.`);
    return;
  }

  setLookupMessage("No tool found for that asset number.");
}

function formatLookup(asset) {
  const status = asset.status === "out" ? `Logged out to ${asset.holder}` : "Available";
  const serial = asset.serialNumber ? `<br>Serial: ${escapeHtml(asset.serialNumber)}` : "";
  const duplicate = asset.duplicateAssetNumber ? `<br><span class="duplicate-note">Duplicate asset number in source register.</span>` : "";
  return `<strong>${escapeHtml(asset.assetNumber)}</strong> - ${escapeHtml(asset.name)}<br>${status}${serial}${duplicate}`;
}

function setLookupMessage(message) {
  els.lookupResult.innerHTML = message;
}

function render() {
  renderAdmin();
  renderAssets();
  renderHistory();
  updateLookup();
}

function renderAdmin() {
  els.assetForm.classList.toggle("locked", !adminUnlocked);
  els.assetForm.querySelectorAll("input, button").forEach(control => {
    control.disabled = !adminUnlocked;
  });
  els.adminLoginForm.hidden = adminUnlocked;
  els.adminControls.hidden = !adminUnlocked;
  document.querySelector("#adminLogout").hidden = !adminUnlocked;
  els.foremanEmails.value = state.settings.foremanEmails || "";
  els.siteName.value = state.settings.siteName || "Jundee";
  document.querySelectorAll(".admin-only").forEach(node => {
    node.hidden = !adminUnlocked;
  });
}

function renderAssets() {
  const query = els.searchBox.value.trim().toLowerCase();
  const assets = state.assets.filter(asset => {
    const text = `${asset.assetNumber} ${asset.name} ${asset.category} ${asset.location} ${asset.holder} ${asset.serialNumber} ${asset.partNumber}`.toLowerCase();
    return text.includes(query);
  });

  els.assetTable.innerHTML = assets.map(asset => `
    <tr>
      <td><strong>${escapeHtml(asset.assetNumber)}</strong>${asset.duplicateAssetNumber ? '<br><span class="duplicate-note">Duplicate</span>' : ""}<br><small>${escapeHtml(asset.location || "No location")}</small></td>
      <td>${escapeHtml(asset.name)}<br><small>${escapeHtml([asset.category, asset.partNumber, asset.condition].filter(Boolean).join(" - ") || "Uncategorised")}</small></td>
      <td>${escapeHtml(asset.serialNumber || "-")}</td>
      <td><span class="status ${asset.status === "out" ? "out" : "available"}">${asset.status === "out" ? "Logged out" : "Available"}</span></td>
      <td>${escapeHtml(asset.holder || "-")}</td>
      <td class="qr-cell"><div class="qr-small" data-qr="${escapeHtml(asset.qrValue || asset.assetNumber)}"></div></td>
      ${adminUnlocked ? `<td class="admin-only"><button type="button" class="danger small-button" data-delete="${escapeHtml(asset.id)}">Remove</button></td>` : ""}
    </tr>
  `).join("") || `<tr><td colspan="${adminUnlocked ? 7 : 6}">No tools added yet.</td></tr>`;

  drawQrCodes(".qr-small", 58);
  document.querySelectorAll("[data-delete]").forEach(button => {
    button.addEventListener("click", () => deleteAsset(button.dataset.delete));
  });
}

function renderHistory() {
  els.historyList.innerHTML = state.history.slice(0, 80).map(item => `
    <article class="history-item ${item.type}">
      <p><strong>${escapeHtml(item.assetNumber)}</strong> ${item.type === "checkout" ? "logged out to" : "returned by"} ${escapeHtml(item.person)}</p>
      <small>${escapeHtml(item.toolName)} - ${new Date(item.timestamp).toLocaleString()}${item.notes ? ` - ${escapeHtml(item.notes)}` : ""}</small>
    </article>
  `).join("") || "<p>No movement history yet.</p>";
}

function drawQrCodes(selector, size) {
  if (!window.QRCode) {
    document.querySelectorAll(selector).forEach(node => {
      node.textContent = node.dataset.qr;
    });
    return;
  }

  document.querySelectorAll(selector).forEach(node => {
    node.innerHTML = "";
    new QRCode(node, {
      text: node.dataset.qr,
      width: size,
      height: size,
      correctLevel: QRCode.CorrectLevel.M
    });
  });
}

async function scanQr() {
  if (!("BarcodeDetector" in window)) {
    setScannerMessage("This browser cannot scan QR codes directly. Type the asset number from the label instead.");
    return;
  }

  try {
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    els.scannerVideo.srcObject = scannerStream;
    els.scannerVideo.hidden = false;
    els.scannerStatus.hidden = true;
    await els.scannerVideo.play();

    scannerTimer = window.setInterval(async () => {
      const codes = await detector.detect(els.scannerVideo);
      if (codes.length) {
        els.assetLookup.value = codes[0].rawValue.trim().toUpperCase();
        stopScanner();
        updateLookup();
      }
    }, 350);
  } catch {
    setScannerMessage("Camera access was not available. You can still type the asset number.");
    stopScanner();
  }
}

function stopScanner() {
  if (scannerTimer) window.clearInterval(scannerTimer);
  if (scannerStream) scannerStream.getTracks().forEach(track => track.stop());
  scannerTimer = null;
  scannerStream = null;
  els.scannerVideo.hidden = true;
  els.scannerStatus.hidden = false;
}

function setScannerMessage(message) {
  els.scannerStatus.textContent = message;
}

function printLabels() {
  els.labelSheet.innerHTML = state.assets.map(asset => `
    <div class="label-card">
      <div class="label-qr" data-qr="${escapeHtml(asset.qrValue || asset.assetNumber)}"></div>
      <div>
        <h3>${escapeHtml(asset.assetNumber)}</h3>
        <p>${escapeHtml(asset.name)}</p>
        <p>${escapeHtml(asset.serialNumber || "")}</p>
        <p>${escapeHtml(asset.location || "")}</p>
      </div>
    </div>
  `).join("");
  drawQrCodes(".label-qr", 110);
  window.setTimeout(() => window.print(), 200);
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `tool-qr-register-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importData(event) {
  if (!adminUnlocked) {
    alert("Unlock admin before importing a register backup.");
    event.target.value = "";
    return;
  }
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported.assets) || !Array.isArray(imported.history)) throw new Error("Invalid file");
      state.assets = imported.assets.map(prepareAsset);
      state.history = imported.history;
      state.settings = { ...state.settings, ...(imported.settings || {}) };
      persist();
      syncFullState().catch(() => alert("Backup imported locally, but the Render server did not accept the update."));
      render();
    } catch {
      alert("That backup file could not be imported.");
    }
  };
  reader.readAsText(file);
  event.target.value = "";
}

function clearHistory() {
  if (!adminUnlocked) {
    alert("Unlock admin before clearing history.");
    return;
  }
  if (!confirm("Clear all movement history? Tool statuses will stay as they are.")) return;
  state.history = [];
  persist();
  syncFullState().catch(() => alert("History cleared locally, but the Render server did not accept the update."));
  renderHistory();
}

async function addSampleData() {
  if (!adminUnlocked) return;
  const samples = [
    ["TOOL-0001", "SDS hammer drill", "Power tool", "Workshop bay 2"],
    ["TOOL-0002", "Torque wrench", "Mechanical", "Tool cabinet A"],
    ["TOOL-0003", "Laser level", "Survey", "Site kit shelf"]
  ];

  samples.forEach(([assetNumber, name, category, location]) => {
    if (!state.assets.some(asset => asset.assetNumber === assetNumber)) {
      state.assets.push(prepareAsset({ assetNumber, name, category, location, status: "available", holder: "", lastMoved: "" }));
    }
  });
  persist();
  try {
    await syncFullState();
  } catch {
    alert("Examples added locally, but the Render server did not accept the update.");
  }
  render();
}

async function deleteAsset(assetId) {
  if (!adminUnlocked) return;
  const asset = state.assets.find(item => item.id === assetId);
  if (!asset) return;
  if (!confirm(`Remove ${asset.assetNumber} from the register?`)) return;
  state.assets = state.assets.filter(item => item.id !== assetId);
  persist();
  try {
    await syncFullState();
  } catch {
    alert("Tool removed locally, but the Render server did not accept the update.");
  }
  render();
}

function openMovementEmail(type, asset, movement) {
  const emails = (state.settings.foremanEmails || "").trim();
  if (!emails) {
    setLookupMessage(`${formatLookup(asset)}<br><span class="duplicate-note">No foreman emails are set in admin.</span>`);
    return;
  }

  const action = type === "checkout" ? "logged out" : "returned";
  const subject = `${state.settings.siteName || "Jundee"} tool ${action}: ${asset.assetNumber}`;
  const lines = [
    `Tool ${action}`,
    "",
    `Asset: ${asset.assetNumber}`,
    `Tool: ${asset.name}`,
    `Serial: ${asset.serialNumber || "-"}`,
    `Part number: ${asset.partNumber || "-"}`,
    `Person: ${movement.person}`,
    `Notes: ${movement.notes || "-"}`,
    `Time: ${new Date(movement.timestamp).toLocaleString()}`,
    `Site: ${state.settings.siteName || "Jundee"}`
  ];
  const recipients = emails.split(/[,\n;]/).map(email => email.trim()).filter(Boolean).join(",");
  const mailto = `mailto:${recipients}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join("\n"))}`;
  window.location.href = mailto;
}

function prepareAsset(asset) {
  const serial = asset.serialNumber || "";
  const duplicate = Boolean(asset.duplicateAssetNumber);
  const id = asset.id || (duplicate && serial ? `${asset.assetNumber}|${serial}` : asset.assetNumber);
  return {
    ...asset,
    assetNumber: String(asset.assetNumber || "").toUpperCase(),
    id: String(id).toUpperCase(),
    qrValue: String(asset.qrValue || id || asset.assetNumber || "").toUpperCase(),
    status: asset.status || "available",
    holder: asset.holder || "",
    lastMoved: asset.lastMoved || ""
  };
}

function findAssetByLookup(lookup) {
  if (!lookup) return null;
  const exactId = state.assets.find(item => item.id === lookup || item.qrValue === lookup);
  if (exactId) return exactId;
  const assetMatches = state.assets.filter(item => item.assetNumber === lookup);
  if (assetMatches.length === 1) return assetMatches[0];
  const serialMatch = state.assets.find(item => String(item.serialNumber || "").toUpperCase() === lookup);
  return serialMatch || null;
}

function getValue(selector) {
  return document.querySelector(selector).value.trim();
}

function makeId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `move-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
