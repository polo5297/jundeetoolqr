const STORE_KEY = "toolQrRegister.v2";
const DEFAULT_USERS = [
  { email: "desmond.trinidad@byrnecut.com.au", name: "Desmond Trinidad", role: "main", password: "060225" },
  { email: "james.tepairi@byrnecut.com.au", name: "James Tepairi", role: "admin", password: "281097" },
  { email: "brian.stimson@byrnecut.com.au", name: "Brian Stimson", role: "admin", password: "375867" },
  { email: "jorden.d'ippolito@byrnecut.com.au", name: "Jorden D'Ippolito", role: "admin", password: "617635" },
  { email: "trevor.martin@byrnecut.com.au", name: "Trevor Martin", role: "admin", password: "123456" },
  { email: "thomas.ooi@byrnecut.com.au", name: "Thomas Ooi", role: "admin", password: "123456" },
  { email: "glenn.mays@byrnecut.com.au", name: "Glenn Mays", role: "storeman", password: "123456" },
  { email: "anthony.kandie@byrnecut.com.au", name: "Anthony Kandie", role: "storeman", password: "123456" },
  { email: "kai.macvicar@byrnecut.com.au", name: "Kai Macvicar", role: "storeman", password: "123456" },
  { email: "michael.frausin@byrnecut.com.au", name: "Michael Frausin", role: "storeman", password: "123456" },
  { email: "jordan.sbrana@byrnecut.com.au", name: "Jordan Sbrana", role: "storeman", password: "123456" }
];
const DEFAULT_SETTINGS = { foremanEmails: "", siteName: "Jundee", workers: [], users: DEFAULT_USERS };
const IS_SERVER = location.protocol.startsWith("http");
let currentUser = null;
let credentials = null;
let scannerStream = null;
let scannerTimer = null;
let activeStatusFilter = "all";
let batchAssetIds = [];

const state = loadState();
const els = {};

document.addEventListener("DOMContentLoaded", () => {
  ["loginScreen","appShell","loginForm","loginEmail","loginPassword","loginMessage","currentUser","logoutButton","pinToggle","pinPanel","pinForm","currentPin","newPin","confirmPin","pinMessage","pinBackButton","adminToggle","adminPanel","adminBackButton","assetForm","settingsForm","usersForm","checkoutForm","assetTable","historyList","assetLookup","lookupResult","personName","workerSelect","movementNotes","scannerStatus","scannerVideo","searchBox","foremanEmails","siteName","workersList","workerCount","usersList","testEmailButton","testEmailMessage","labelSheet","scanButton","addToBatchButton","batchList","batchCheckoutButton","clearBatchButton","returnButton","repairButton","sampleData","printLabels","exportData","importData","clearHistory","filterAll","filterAvailable","filterOut","filterRepair"].forEach(id => els[id] = document.querySelector(`#${id}`));
  bindEvents();
  restoreLogin();
  render();
});

function bindEvents() {
  els.loginForm.addEventListener("submit", login);
  els.logoutButton.addEventListener("click", logout);
  els.pinToggle.addEventListener("click", () => { els.pinPanel.hidden = !els.pinPanel.hidden; });
  els.pinBackButton.addEventListener("click", () => { els.pinPanel.hidden = true; });
  els.pinForm.addEventListener("submit", changePin);
  els.adminToggle.addEventListener("click", () => { els.adminPanel.hidden = !els.adminPanel.hidden; });
  els.adminBackButton.addEventListener("click", () => { els.adminPanel.hidden = true; });
  els.assetForm.addEventListener("submit", saveAsset);
  els.settingsForm.addEventListener("submit", saveSettings);
  els.testEmailButton.addEventListener("click", sendTestEmail);
  els.usersForm.addEventListener("submit", saveUsers);
  els.checkoutForm.addEventListener("submit", e => { e.preventDefault(); moveAsset("checkout"); });
  els.addToBatchButton.addEventListener("click", addCurrentLookupToBatch);
  els.batchCheckoutButton.addEventListener("click", batchCheckout);
  els.clearBatchButton.addEventListener("click", clearBatch);
  els.returnButton.addEventListener("click", () => moveAsset("return"));
  els.repairButton.addEventListener("click", () => moveAsset("repair"));
  els.scanButton.addEventListener("click", scanQr);
  els.sampleData.addEventListener("click", addSampleData);
  els.printLabels.addEventListener("click", printLabels);
  els.exportData.addEventListener("click", exportData);
  els.importData.addEventListener("change", importData);
  els.clearHistory.addEventListener("click", clearHistory);
  els.searchBox.addEventListener("input", renderAssets);
  els.assetLookup.addEventListener("input", updateLookup);
  els.personName.addEventListener("input", renderWorkers);
  els.workerSelect.addEventListener("change", () => {
    els.personName.value = els.workerSelect.value;
  });
  [els.filterAll, els.filterAvailable, els.filterOut, els.filterRepair].forEach(button => {
    button.addEventListener("click", () => {
      activeStatusFilter = button.dataset.filter;
      renderAssets();
    });
  });
}

function loadState() {
  const fallback = { assets: Array.isArray(window.REGISTERED_ASSETS) ? window.REGISTERED_ASSETS.map(prepareAsset) : [], history: [], settings: normaliseSettings({ workers: getDefaultWorkers(), users: DEFAULT_USERS }) };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (!saved) return fallback;
    return { assets: (saved.assets || []).map(prepareAsset), history: saved.history || [], settings: normaliseSettings(saved.settings || {}) };
  } catch { return fallback; }
}
function persist() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
function getDefaultWorkers() { return uniqueList(Array.isArray(window.AUTHORISED_WORKERS) ? window.AUTHORISED_WORKERS : []); }
function uniqueList(list) { const seen = new Set(); return (Array.isArray(list) ? list : []).map(x => String(x || "").trim()).filter(Boolean).filter(x => { const k = x.toLowerCase().replace(/\s+/g," "); if (seen.has(k)) return false; seen.add(k); return true; }).sort((a,b)=>a.localeCompare(b)); }
function normaliseSettings(settings) { return { ...DEFAULT_SETTINGS, ...settings, workers: uniqueList(settings.workers?.length ? settings.workers : getDefaultWorkers()), users: normaliseUsers(settings.users?.length ? settings.users : DEFAULT_USERS) }; }
function normaliseUsers(users) { const seen = new Set(); const clean = (Array.isArray(users) ? users : []).map(u => ({ email: String(u.email || "").trim().toLowerCase(), name: String(u.name || "").trim() || String(u.email || "").trim().toLowerCase(), role: ["main","admin","storeman"].includes(String(u.role || "").toLowerCase()) ? String(u.role).toLowerCase() : "storeman", password: String(u.password || "").trim() })).filter(u => u.email && /^\d{6}$/.test(u.password)).filter(u => { if (seen.has(u.email)) return false; seen.add(u.email); return true; }); DEFAULT_USERS.forEach(user => { if (!seen.has(user.email)) { clean.push(user); seen.add(user.email); } }); return clean; }
function parseWorkerList(text) { return uniqueList(String(text || "").split(/[\n,;]+/)); }
function parseUserList(text) { return String(text || "").split(/\n+/).map(line => line.trim()).filter(Boolean).map(line => { const [email,name,role,password] = line.split("|").map(v => String(v || "").trim()); return { email, name, role, password }; }).filter(u => u.email && u.password); }
function usersToText(users) { return (users || []).map(u => `${u.email} | ${u.name || u.email} | ${u.role || "storeman"} | ${u.password || ""}`).join("\n"); }

async function login(event) {
  event.preventDefault();
  const email = els.loginEmail.value.trim().toLowerCase();
  const password = els.loginPassword.value.trim();
  if (IS_SERVER) {
    try {
      const response = await fetch("/api/login", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ email, password }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Login failed");
      currentUser = payload.user; credentials = { email, password }; applyServerState(payload.state); sessionStorage.setItem("toolQrLogin", JSON.stringify(credentials));
    } catch (error) { els.loginMessage.textContent = error.message; return; }
  } else {
    const user = state.settings.users.find(u => u.email === email && u.password === password);
    if (!user) { els.loginMessage.textContent = "Wrong login or password"; return; }
    currentUser = { email:user.email, name:user.name, role:user.role }; credentials = { email, password }; sessionStorage.setItem("toolQrLogin", JSON.stringify(credentials));
  }
  els.loginPassword.value = ""; els.loginMessage.textContent = ""; render();
}
async function restoreLogin() {
  try {
    const saved = JSON.parse(sessionStorage.getItem("toolQrLogin") || "null"); if (!saved) return;
    els.loginEmail.value = saved.email || ""; els.loginPassword.value = saved.password || "";
    await login(new Event("submit"));
  } catch {}
}
function logout() { currentUser = null; credentials = null; sessionStorage.removeItem("toolQrLogin"); render(); }
function authHeaders() { return { "Content-Type":"application/json", "x-user-email": credentials?.email || "", "x-user-password": credentials?.password || "" }; }
function applyServerState(serverState) { state.assets = (serverState.assets || []).map(prepareAsset); state.history = serverState.history || []; state.settings = normaliseSettings({ ...state.settings, ...(serverState.settings || {}) }); persist(); }
async function refreshState() { if (!IS_SERVER || !credentials) return; const r = await fetch("/api/state", { headers: authHeaders() }); if (r.ok) applyServerState(await r.json()); }
async function syncFullState() { if (!IS_SERVER) return; const r = await fetch("/api/admin/state", { method:"POST", headers: authHeaders(), body: JSON.stringify(state) }); const p = await r.json(); if (!r.ok) throw new Error(p.error || "Server save failed"); applyServerState(p.state); }

function isAdminLevel() { return currentUser && ["main","admin"].includes(currentUser.role); }
function isMainUser() { return currentUser?.role === "main"; }

async function saveAsset(event) {
  event.preventDefault(); if (!isAdminLevel()) return alert("Admin level required.");
  const assetNumber = getValue("#assetNumber").toUpperCase();
  const existing = state.assets.find(a => a.assetNumber === assetNumber && !a.duplicateAssetNumber);
  const details = { assetNumber, name:getValue("#toolName"), category:getValue("#toolCategory"), location:getValue("#homeLocation"), status: existing?.status || "available", holder: existing?.holder || "", lastMoved: existing?.lastMoved || "", serialNumber: existing?.serialNumber || "", condition: existing?.condition || "", partNumber: existing?.partNumber || "", id: existing?.id || assetNumber, qrValue: existing?.qrValue || assetNumber, duplicateAssetNumber:false };
  existing ? Object.assign(existing, details) : state.assets.push(details);
  state.assets.sort((a,b)=>a.assetNumber.localeCompare(b.assetNumber)); persist();
  try { await syncFullState(); } catch(e){ alert(e.message); }
  event.target.reset(); render();
}
async function saveSettings(event) {
  event.preventDefault(); if (!isAdminLevel()) return;
  state.settings.foremanEmails = els.foremanEmails.value.trim(); state.settings.siteName = els.siteName.value.trim() || "Jundee"; state.settings.workers = parseWorkerList(els.workersList.value); persist();
  try { if (IS_SERVER) { const r = await fetch("/api/admin/settings", { method:"POST", headers: authHeaders(), body: JSON.stringify({ foremanEmails:state.settings.foremanEmails, siteName:state.settings.siteName, workers:state.settings.workers }) }); const p = await r.json(); if (!r.ok) throw new Error(p.error || "Settings save failed"); applyServerState(p.state); } render(); } catch(e){ alert(e.message); }
}
async function saveUsers(event) {
  event.preventDefault(); if (!isMainUser()) return alert("Main user only.");
  state.settings.users = normaliseUsers(parseUserList(els.usersList.value)); persist();
  try { if (IS_SERVER) { const r = await fetch("/api/admin/settings", { method:"POST", headers: authHeaders(), body: JSON.stringify({ foremanEmails:state.settings.foremanEmails, siteName:state.settings.siteName, workers:state.settings.workers, users:state.settings.users }) }); const p = await r.json(); if (!r.ok) throw new Error(p.error || "Login save failed"); applyServerState(p.state); } render(); } catch(e){ alert(e.message); }
}

async function sendTestEmail() {
  if (!isAdminLevel()) return;
  els.testEmailMessage.textContent = "Sending test email...";
  if (!IS_SERVER) {
    els.testEmailMessage.textContent = "Test email only works on the Render website.";
    return;
  }
  try {
    const r = await fetch("/api/admin/test-email", { method:"POST", headers: authHeaders(), body: JSON.stringify({ foremanEmails: els.foremanEmails.value.trim(), siteName: els.siteName.value.trim() || "Jundee" }) });
    const p = await r.json();
    if (!r.ok) throw new Error(p.error || "Test email failed");
    els.testEmailMessage.textContent = `Test email sent to ${p.recipients} recipient(s).`;
  } catch(e) {
    els.testEmailMessage.textContent = e.message;
  }
}

async function changePin(event) {
  event.preventDefault();
  const currentPin = els.currentPin.value.trim();
  const newPin = els.newPin.value.trim();
  const confirmPin = els.confirmPin.value.trim();
  els.pinMessage.textContent = "";
  if (!/^\d{6}$/.test(currentPin) || !/^\d{6}$/.test(newPin)) {
    els.pinMessage.textContent = "PINs must be exactly 6 digits.";
    return;
  }
  if (newPin !== confirmPin) {
    els.pinMessage.textContent = "New PINs do not match.";
    return;
  }

  if (IS_SERVER) {
    try {
      const r = await fetch("/api/change-pin", { method:"POST", headers: authHeaders(), body: JSON.stringify({ currentPin, newPin }) });
      const p = await r.json();
      if (!r.ok) throw new Error(p.error || "PIN change failed");
      credentials.password = newPin;
      sessionStorage.setItem("toolQrLogin", JSON.stringify(credentials));
      applyServerState(p.state);
      els.pinForm.reset();
      els.pinMessage.textContent = "PIN updated.";
      return;
    } catch(e) {
      els.pinMessage.textContent = e.message;
      return;
    }
  }

  const user = state.settings.users.find(u => u.email === currentUser.email && u.password === currentPin);
  if (!user) {
    els.pinMessage.textContent = "Current PIN is incorrect.";
    return;
  }
  user.password = newPin;
  credentials.password = newPin;
  sessionStorage.setItem("toolQrLogin", JSON.stringify(credentials));
  persist();
  els.pinForm.reset();
  els.pinMessage.textContent = "PIN updated.";
}

async function moveAsset(type) {
  if (!currentUser) return;
  const lookup = els.assetLookup.value.trim().toUpperCase(); const asset = findAssetByLookup(lookup);
  if (!asset) { setLookupMessage("No tool found for that asset number."); return; }
  const person = type === "checkout" ? getApprovedWorkerName(els.personName.value.trim()) : (type === "repair" ? "OUT FOR REPAIR" : els.personName.value.trim());
  if (type === "checkout" && !person) { setLookupMessage("Only approved workers can borrow tools. Start typing and pick a name from the list."); return; }
  if (IS_SERVER) {
    try {
      const r = await fetch("/api/move", { method:"POST", headers: authHeaders(), body: JSON.stringify({ type, lookup, assetId: asset.id, person, notes: els.movementNotes.value.trim() }) }); const p = await r.json(); if (!r.ok) throw new Error(p.error || "Movement failed");
      applyServerState(p.state); els.personName.value = ""; els.movementNotes.value = ""; render(); setLookupMessage(formatLookup(p.asset));
    } catch(e){ setLookupMessage(escapeHtml(e.message)); }
    return;
  }
  asset.status = type === "checkout" ? "out" : type === "repair" ? "repair" : "available"; asset.holder = type === "checkout" ? person : type === "repair" ? "Out for repair" : ""; asset.lastMoved = new Date().toISOString();
  state.history.unshift({ id:makeId(), assetNumber:asset.assetNumber, toolName:asset.name, type, person:person || currentUser.name, loginUser:currentUser.email, notes:els.movementNotes.value.trim(), timestamp:asset.lastMoved }); persist(); els.personName.value = ""; els.movementNotes.value = ""; render();
}
function getApprovedWorkerName(input) { const key = String(input || "").trim().toLowerCase().replace(/\s+/g," "); return (state.settings.workers || []).find(w => w.toLowerCase().replace(/\s+/g," ") === key) || ""; }

function addCurrentLookupToBatch() {
  const lookup = els.assetLookup.value.trim().toUpperCase();
  const asset = findAssetByLookup(lookup);
  if (!asset) {
    setLookupMessage("No tool found for that asset number.");
    return;
  }
  if (asset.status !== "available") {
    setLookupMessage(`${formatLookup(asset)}<br><span class="duplicate-note">Only available tools can be added to a checkout batch.</span>`);
    return;
  }
  if (!batchAssetIds.includes(asset.id)) batchAssetIds.push(asset.id);
  els.assetLookup.value = "";
  renderBatch();
  updateLookup();
}

function removeFromBatch(assetId) {
  batchAssetIds = batchAssetIds.filter(id => id !== assetId);
  renderBatch();
}

function clearBatch() {
  batchAssetIds = [];
  renderBatch();
}

async function batchCheckout() {
  const person = getApprovedWorkerName(els.personName.value.trim());
  if (!person) {
    setLookupMessage("Choose an approved worker before logging out a batch.");
    return;
  }
  const assets = batchAssetIds.map(id => state.assets.find(asset => asset.id === id)).filter(Boolean);
  if (!assets.length) {
    setLookupMessage("Add at least one scanned tool to the batch.");
    return;
  }
  const unavailable = assets.filter(asset => asset.status !== "available");
  if (unavailable.length) {
    setLookupMessage(`${unavailable.length} tool(s) in the batch are no longer available.`);
    return;
  }

  const failures = [];
  if (IS_SERVER) {
    try {
      const r = await fetch("/api/batch-checkout", { method:"POST", headers: authHeaders(), body: JSON.stringify({ assetIds: assets.map(asset => asset.id), person, notes: els.movementNotes.value.trim() }) });
      const p = await r.json();
      if (!r.ok) throw new Error(p.error || "Batch checkout failed");
      applyServerState(p.state);
      setLookupMessage(`<strong>${assets.length}</strong> tool(s) logged out to ${escapeHtml(person)}.`);
      batchAssetIds = [];
      els.personName.value = "";
      els.movementNotes.value = "";
      render();
      return;
    } catch(e) {
      setLookupMessage(escapeHtml(e.message));
      return;
    }
  }

  for (const asset of assets) {
      asset.status = "out";
      asset.holder = person;
      asset.lastMoved = new Date().toISOString();
      state.history.unshift({ id:makeId(), assetNumber:asset.assetNumber, toolName:asset.name, type:"checkout", person, loginUser:currentUser.email, notes:els.movementNotes.value.trim(), timestamp:asset.lastMoved });
  }

  persist();
  if (failures.length) {
    setLookupMessage(`Batch stopped.<br><span class="duplicate-note">${escapeHtml(failures.join(" | "))}</span>`);
  } else {
    setLookupMessage(`<strong>${assets.length}</strong> tool(s) logged out to ${escapeHtml(person)}.`);
    batchAssetIds = [];
    els.personName.value = "";
    els.movementNotes.value = "";
  }
  render();
}

function render() {
  const logged = Boolean(currentUser); els.loginScreen.hidden = logged; els.appShell.hidden = !logged; if (!logged) return;
  els.currentUser.textContent = `${currentUser.name || currentUser.email} (${currentUser.role})`;
  document.querySelectorAll(".admin-only").forEach(n => n.hidden = !isAdminLevel());
  document.querySelectorAll(".main-only").forEach(n => n.hidden = !isMainUser());
  els.adminToggle.hidden = !isAdminLevel(); if (!isAdminLevel()) els.adminPanel.hidden = true;
  els.foremanEmails.value = state.settings.foremanEmails || ""; els.siteName.value = state.settings.siteName || "Jundee"; els.workersList.value = (state.settings.workers || []).join("\n"); els.workerCount.textContent = `(${(state.settings.workers || []).length})`; els.usersList.value = usersToText(state.settings.users || DEFAULT_USERS);
  renderWorkers(); renderBatch(); renderAssets(); renderHistory(); updateLookup();
}
function renderWorkers() {
  const current = els.workerSelect.value;
  const typed = els.personName.value.trim().toLowerCase();
  const workers = (state.settings.workers || []).filter(worker => !typed || worker.toLowerCase().includes(typed)).slice(0, 80);
  els.workerSelect.innerHTML = `<option value="">Select approved worker</option>` + workers.map(worker => `<option value="${escapeHtml(worker)}">${escapeHtml(worker)}</option>`).join("");
  if (workers.includes(current)) els.workerSelect.value = current;
}
function renderBatch() {
  const assets = batchAssetIds.map(id => state.assets.find(asset => asset.id === id)).filter(Boolean);
  batchAssetIds = assets.map(asset => asset.id);
  els.batchList.innerHTML = assets.map(asset => `
    <div class="batch-item">
      <span><strong>${escapeHtml(asset.assetNumber)}</strong> ${escapeHtml(asset.name)}</span>
      <button type="button" class="quiet small-button" data-remove-batch="${escapeHtml(asset.id)}">Remove</button>
    </div>
  `).join("") || `<p class="hint">No tools added. Scan or type an asset number, then press Add to batch.</p>`;
  document.querySelectorAll("[data-remove-batch]").forEach(button => {
    button.addEventListener("click", () => removeFromBatch(button.dataset.removeBatch));
  });
}
function renderAssets() {
  const q = els.searchBox.value.trim().toLowerCase();
  [els.filterAll, els.filterAvailable, els.filterOut, els.filterRepair].forEach(button => {
    button.classList.toggle("active", button.dataset.filter === activeStatusFilter);
  });
  const assets = state.assets.filter(a => {
    const textMatch = `${a.assetNumber} ${a.name} ${a.category} ${a.location} ${a.holder} ${a.serialNumber} ${a.partNumber}`.toLowerCase().includes(q);
    const filterMatch = activeStatusFilter === "all" || (activeStatusFilter === "available" ? a.status === "available" : a.status === activeStatusFilter);
    return textMatch && filterMatch;
  });
  els.assetTable.innerHTML = assets.map(a => `<tr><td><strong>${escapeHtml(a.assetNumber)}</strong>${a.duplicateAssetNumber ? '<br><span class="duplicate-note">Duplicate</span>' : ""}<br><small>${escapeHtml(a.location || "No location")}</small></td><td>${escapeHtml(a.name)}<br><small>${escapeHtml([a.category,a.partNumber,a.condition].filter(Boolean).join(" - ") || "Uncategorised")}</small></td><td>${escapeHtml(a.serialNumber || "-")}</td><td><span class="status ${a.status === "out" ? "out" : a.status === "repair" ? "repair" : "available"}">${a.status === "out" ? "Logged out" : a.status === "repair" ? "Repair" : "Available"}</span></td><td>${escapeHtml(a.holder || "-")}</td><td class="qr-cell"><div class="qr-small" data-qr="${escapeHtml(a.qrValue || a.assetNumber)}"></div></td>${isAdminLevel() ? `<td><button type="button" class="danger small-button" data-delete="${escapeHtml(a.id)}">Remove</button></td>` : ""}</tr>`).join("") || `<tr><td colspan="${isAdminLevel() ? 7 : 6}">No tools added yet.</td></tr>`;
  drawQrCodes(".qr-small", 72); document.querySelectorAll("[data-delete]").forEach(b => b.addEventListener("click", () => deleteAsset(b.dataset.delete)));
}
function renderHistory() {
  els.historyList.innerHTML = state.history.slice(0,150).map(i => { const action = i.type === "checkout" ? "logged out to" : i.type === "repair" ? "sent for repair by" : "returned by"; return `<article class="history-item ${i.type}"><p><strong>${escapeHtml(i.assetNumber)}</strong> ${action} ${escapeHtml(i.person || "-")}</p><small>${escapeHtml(i.toolName)} - ${new Date(i.timestamp).toLocaleString()}${i.loginUser ? ` - login: ${escapeHtml(i.loginUser)}` : ""}${i.notes ? ` - ${escapeHtml(i.notes)}` : ""}</small></article>`; }).join("") || "<p>No movement history yet.</p>";
}
function updateLookup() { const lookup = els.assetLookup.value.trim().toUpperCase(); if (!lookup) return setLookupMessage("Select a tool to log it out, return it, or mark it out for repair."); const asset = findAssetByLookup(lookup); setLookupMessage(asset ? formatLookup(asset) : "No tool found for that asset number."); }
function formatLookup(a) { const status = a.status === "out" ? `Logged out to ${a.holder}` : a.status === "repair" ? "Out for repair" : "Available"; return `<strong>${escapeHtml(a.assetNumber)}</strong> - ${escapeHtml(a.name)}<br>${escapeHtml(status)}${a.serialNumber ? `<br>Serial: ${escapeHtml(a.serialNumber)}` : ""}`; }
function setLookupMessage(m) { els.lookupResult.innerHTML = m; }

function drawQrCodes(selector, size) { if (!window.QRCode) return document.querySelectorAll(selector).forEach(n => n.textContent = n.dataset.qr); document.querySelectorAll(selector).forEach(n => { n.innerHTML = ""; new QRCode(n, { text:n.dataset.qr, width:size, height:size, correctLevel:QRCode.CorrectLevel.M }); }); }
async function scanQr() { if (!("BarcodeDetector" in window)) return setScannerMessage("This browser cannot scan QR codes directly. Type the asset number from the label instead."); try { const detector = new BarcodeDetector({ formats:["qr_code"] }); scannerStream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:"environment" } }); els.scannerVideo.srcObject = scannerStream; els.scannerVideo.hidden = false; els.scannerStatus.hidden = true; await els.scannerVideo.play(); scannerTimer = setInterval(async()=>{ const codes = await detector.detect(els.scannerVideo); if (codes.length) { let added = 0; codes.forEach(code => { const asset = findAssetByLookup(code.rawValue.trim().toUpperCase()); if (asset && asset.status === "available" && !batchAssetIds.includes(asset.id)) { batchAssetIds.push(asset.id); added += 1; } }); if (added) { renderBatch(); setLookupMessage(`${added} scanned tool(s) added to batch.`); } } },650); } catch { setScannerMessage("Camera access was not available. You can still type the asset number."); stopScanner(); } }
function stopScanner(){ if(scannerTimer) clearInterval(scannerTimer); if(scannerStream) scannerStream.getTracks().forEach(t=>t.stop()); scannerTimer=null; scannerStream=null; els.scannerVideo.hidden=true; els.scannerStatus.hidden=false; }
function setScannerMessage(m){ els.scannerStatus.textContent = m; }
function printLabels(){ els.labelSheet.innerHTML = state.assets.map(a => `<div class="label-card"><div class="label-qr" data-qr="${escapeHtml(a.qrValue || a.assetNumber)}"></div><div><h3>${escapeHtml(a.assetNumber)}</h3><p>${escapeHtml(a.name)}</p><p>${escapeHtml(a.serialNumber || "")}</p><p>${escapeHtml(a.location || "")}</p></div></div>`).join(""); drawQrCodes(".label-qr", 118); setTimeout(()=>window.print(),200); }
function exportData(){ if (!isAdminLevel()) return; const blob = new Blob([JSON.stringify(state,null,2)], { type:"application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href=url; link.download=`tool-qr-register-${new Date().toISOString().slice(0,10)}.json`; link.click(); URL.revokeObjectURL(url); }
function importData(event){ if (!isAdminLevel()) { alert("Admin level required."); event.target.value=""; return; } const file = event.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { try { const imported = JSON.parse(reader.result); state.assets = (imported.assets || []).map(prepareAsset); state.history = imported.history || []; state.settings = normaliseSettings({ ...state.settings, ...(imported.settings || {}) }); persist(); syncFullState().catch(e=>alert(e.message)); render(); } catch { alert("That backup file could not be imported."); } }; reader.readAsText(file); event.target.value=""; }
async function clearHistory(){ if (!isAdminLevel()) return; if (!confirm("Clear all movement history?")) return; state.history=[]; persist(); try { await syncFullState(); } catch(e){ alert(e.message); } renderHistory(); }
async function addSampleData(){ if (!isAdminLevel()) return; [["TOOL-0001","SDS hammer drill","Power tool","Workshop bay 2"],["TOOL-0002","Torque wrench","Mechanical","Tool cabinet A"]].forEach(([assetNumber,name,category,location]) => { if (!state.assets.some(a=>a.assetNumber===assetNumber)) state.assets.push(prepareAsset({ assetNumber,name,category,location })); }); persist(); try { await syncFullState(); } catch(e){ alert(e.message); } render(); }
async function deleteAsset(assetId){ if (!isAdminLevel()) return; const asset = state.assets.find(a=>a.id===assetId); if (!asset || !confirm(`Remove ${asset.assetNumber} from the register?`)) return; state.assets = state.assets.filter(a=>a.id!==assetId); persist(); try { await syncFullState(); } catch(e){ alert(e.message); } render(); }
function prepareAsset(asset){ const assetNumber = String(asset.assetNumber || "").toUpperCase(); const serial = asset.serialNumber || ""; const duplicate = Boolean(asset.duplicateAssetNumber); const id = asset.id || (duplicate && serial ? `${assetNumber}|${serial}` : assetNumber); return { ...asset, assetNumber, id:String(id).toUpperCase(), qrValue:String(asset.qrValue || id || assetNumber).toUpperCase(), status:asset.status || "available", holder:asset.holder || "", lastMoved:asset.lastMoved || "" }; }
function findAssetByLookup(lookup){ if (!lookup) return null; const exact = state.assets.find(a=>a.id===lookup || a.qrValue===lookup); if (exact) return exact; const matches = state.assets.filter(a=>a.assetNumber===lookup); if (matches.length === 1) return matches[0]; return state.assets.find(a=>String(a.serialNumber || "").toUpperCase() === lookup) || null; }
function getValue(sel){ return document.querySelector(sel).value.trim(); }
function makeId(){ return crypto?.randomUUID ? crypto.randomUUID() : `move-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function escapeHtml(value){ return String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;"); }
