const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

let nodemailer = null;
try { nodemailer = require("nodemailer"); } catch { nodemailer = null; }

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const dataFile = process.env.DATA_FILE || path.join(root, "tool-register-data.json");
const types = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".json":"application/json; charset=utf-8", ".png":"image/png" };

const DEFAULT_USERS = [
  { email: "desmond.trinidad@byrnecut.com.au", name: "Desmond Trinidad", role: "main", password: "060225" }
];

function readJsonJs(file, prefix) {
  try {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    return JSON.parse(source.replace(new RegExp(`^window\\.${prefix} = `), "").replace(/;\s*$/, ""));
  } catch { return []; }
}

function defaultState() {
  return {
    assets: readJsonJs("registered-assets.js", "REGISTERED_ASSETS").map(prepareAsset),
    history: [],
    settings: normaliseSettings({
      foremanEmails: process.env.FOREMAN_EMAILS || "",
      siteName: process.env.SITE_NAME || "Jundee",
      workers: readJsonJs("workers.js", "AUTHORISED_WORKERS"),
      users: DEFAULT_USERS
    })
  };
}

function prepareAsset(asset) {
  const assetNumber = String(asset.assetNumber || "").toUpperCase();
  const serial = asset.serialNumber || "";
  const duplicate = Boolean(asset.duplicateAssetNumber);
  const id = asset.id || (duplicate && serial ? `${assetNumber}|${serial}` : assetNumber);
  return { ...asset, assetNumber, id: String(id).toUpperCase(), qrValue: String(asset.qrValue || id || assetNumber).toUpperCase(), status: asset.status || "available", holder: asset.holder || "", lastMoved: asset.lastMoved || "" };
}

function uniqueList(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).map(v => String(v || "").trim()).filter(Boolean).filter(v => {
    const key = v.toLowerCase().replace(/\s+/g, " "); if (seen.has(key)) return false; seen.add(key); return true;
  }).sort((a,b)=>a.localeCompare(b));
}

function normaliseUsers(users) {
  const seen = new Set();
  const clean = (Array.isArray(users) ? users : []).map(user => ({
    email: String(user.email || "").trim().toLowerCase(),
    name: String(user.name || "").trim() || String(user.email || "").trim().toLowerCase(),
    role: ["main","admin","storeman"].includes(String(user.role || "").toLowerCase()) ? String(user.role).toLowerCase() : "storeman",
    password: String(user.password || "").trim()
  })).filter(user => user.email && user.password).filter(user => { if (seen.has(user.email)) return false; seen.add(user.email); return true; });
  if (!clean.some(u => u.email === DEFAULT_USERS[0].email)) clean.unshift(DEFAULT_USERS[0]);
  return clean;
}

function normaliseSettings(settings) {
  let workers = uniqueList(settings.workers || []);
  if (!workers.length) workers = uniqueList(readJsonJs("workers.js", "AUTHORISED_WORKERS"));
  return { foremanEmails: settings.foremanEmails || process.env.FOREMAN_EMAILS || "", siteName: settings.siteName || process.env.SITE_NAME || "Jundee", workers, users: normaliseUsers(settings.users || DEFAULT_USERS) };
}

function readState() {
  try {
    const state = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    state.assets = (state.assets || []).map(prepareAsset);
    state.history = state.history || [];
    state.settings = normaliseSettings(state.settings || {});
    return state;
  } catch { const state = defaultState(); writeState(state); return state; }
}
function writeState(state) { fs.mkdirSync(path.dirname(dataFile), { recursive: true }); fs.writeFileSync(dataFile, JSON.stringify(state, null, 2)); }
function sendJson(res, code, payload) { res.writeHead(code, { "Content-Type":"application/json; charset=utf-8" }); res.end(JSON.stringify(payload)); }
function readBody(req) { return new Promise((resolve,reject)=>{ let body=""; req.on("data",c=>{ body += c; if (body.length > 1_000_000) { req.destroy(); reject(new Error("Request body too large")); }}); req.on("end",()=>{ try { resolve(body ? JSON.parse(body) : {}); } catch(e){ reject(e); } }); }); }

function publicUser(user) { return user ? { email:user.email, name:user.name, role:user.role } : null; }
function publicState(state, includeUsers=false) {
  return { assets: state.assets || [], history: state.history || [], settings: { foremanEmails: state.settings?.foremanEmails || "", siteName: state.settings?.siteName || "Jundee", workers: state.settings?.workers || [], users: includeUsers ? (state.settings?.users || []).map(publicUser) : [] } };
}
function findUser(state, email, password) {
  const key = String(email || "").trim().toLowerCase();
  return (state.settings.users || []).find(u => u.email === key && u.password === String(password || "").trim()) || null;
}
function requireUser(req, res, roles=[]) {
  const state = readState();
  const user = findUser(state, req.headers["x-user-email"], req.headers["x-user-password"]);
  if (!user) { sendJson(res, 401, { error: "Login required" }); return null; }
  if (roles.length && !roles.includes(user.role)) { sendJson(res, 403, { error: "Not allowed for this login level" }); return null; }
  return { state, user };
}
function approvedWorkerName(state, input) {
  const key = String(input || "").trim().toLowerCase().replace(/\s+/g," ");
  return (state.settings?.workers || []).find(w => w.toLowerCase().replace(/\s+/g," ") === key) || "";
}

function buildTransport() {
  if (!nodemailer || !process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true", auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || "" } : undefined });
}
async function sendMovementEmail(state, movement, asset) {
  const recipients = (state.settings?.foremanEmails || process.env.FOREMAN_EMAILS || "").split(/[,\n;]/).map(e=>e.trim()).filter(Boolean);
  const transport = buildTransport(); if (!transport || !recipients.length) return { sent:false, reason:"Email is not configured" };
  const action = movement.type === "checkout" ? "logged out" : movement.type === "repair" ? "sent for repair" : "returned";
  const siteName = state.settings?.siteName || "Jundee";
  const body = [`Tool ${action}`, "", `Asset: ${asset.assetNumber}`, `Tool: ${asset.name}`, `Serial: ${asset.serialNumber || "-"}`, `Part number: ${asset.partNumber || "-"}`, `Person: ${movement.person}`, `Notes: ${movement.notes || "-"}`, `Time: ${new Date(movement.timestamp).toLocaleString()}`, `Site: ${siteName}`].join("\n");
  await transport.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: recipients.join(","), subject: `${siteName} tool ${action}: ${asset.assetNumber}`, text: body });
  return { sent:true };
}

async function handleApi(req, res, url) {
  if (req.method === "POST" && url.pathname === "/api/login") {
    const body = await readBody(req); const state = readState(); const user = findUser(state, body.email, body.password);
    if (!user) return sendJson(res, 401, { error:"Wrong login or password" });
    return sendJson(res, 200, { user: publicUser(user), state: publicState(state, user.role === "main") });
  }
  if (req.method === "GET" && url.pathname === "/api/state") {
    const ctx = requireUser(req, res); if (!ctx) return;
    return sendJson(res, 200, publicState(ctx.state, ctx.user.role === "main"));
  }
  if (req.method === "POST" && url.pathname === "/api/move") {
    const ctx = requireUser(req, res, ["main","admin","storeman"]); if (!ctx) return;
    const body = await readBody(req); const { state, user } = ctx;
    const lookup = String(body.lookup || "").toUpperCase();
    const asset = (state.assets || []).find(item => item.id === body.assetId || item.qrValue === lookup || item.assetNumber === lookup);
    if (!asset) return sendJson(res, 404, { error:"Tool not found" });
    let person = "";
    if (body.type === "checkout") { person = approvedWorkerName(state, body.person); if (!person) return sendJson(res, 400, { error:"Only approved workers can borrow tools" }); asset.status = "out"; asset.holder = person; }
    else if (body.type === "repair") { person = "OUT FOR REPAIR"; asset.status = "repair"; asset.holder = "Out for repair"; }
    else { person = body.person || user.name || "Workshop"; asset.status = "available"; asset.holder = ""; }
    asset.lastMoved = new Date().toISOString();
    const movement = { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, assetNumber: asset.assetNumber, toolName: asset.name, type: body.type, person, loginUser: user.email, notes: body.notes || "", timestamp: asset.lastMoved };
    state.history = [movement, ...(state.history || [])]; writeState(state);
    let email = { sent:false, reason:"Email not attempted" }; try { email = await sendMovementEmail(state, movement, asset); } catch(e){ email = { sent:false, reason:e.message }; }
    return sendJson(res, 200, { state: publicState(state, user.role === "main"), movement, asset, email });
  }
  if (req.method === "POST" && url.pathname === "/api/admin/state") {
    const ctx = requireUser(req, res, ["main","admin"]); if (!ctx) return;
    const body = await readBody(req); const state = readState();
    state.assets = (body.assets || []).map(prepareAsset); state.history = body.history || state.history; state.settings = normaliseSettings({ ...(state.settings || {}), ...(body.settings || {}) });
    if (ctx.user.role !== "main") state.settings.users = ctx.state.settings.users;
    writeState(state); return sendJson(res, 200, { state: publicState(state, ctx.user.role === "main") });
  }
  if (req.method === "POST" && url.pathname === "/api/admin/settings") {
    const ctx = requireUser(req, res, ["main","admin"]); if (!ctx) return;
    const body = await readBody(req); const state = ctx.state;
    state.settings = normaliseSettings({ ...(state.settings || {}), foremanEmails: body.foremanEmails || "", siteName: body.siteName || "Jundee", workers: body.workers || state.settings.workers, users: ctx.user.role === "main" && Array.isArray(body.users) ? body.users : state.settings.users });
    writeState(state); return sendJson(res, 200, { state: publicState(state, ctx.user.role === "main") });
  }
  sendJson(res, 404, { error:"Not found" });
}

function serveStatic(req, res, url) {
  const cleanPath = decodeURIComponent(url.pathname); const filePath = path.join(root, cleanPath === "/" ? "index.html" : cleanPath);
  if (!filePath.startsWith(root)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(filePath, (err,data)=>{ if (err) { res.writeHead(404); return res.end("Not found"); } res.writeHead(200, { "Content-Type": types[path.extname(filePath)] || "application/octet-stream" }); res.end(data); });
}

http.createServer(async (req,res)=>{ const url = new URL(req.url, `http://${req.headers.host}`); try { if (url.pathname.startsWith("/api/")) return await handleApi(req,res,url); serveStatic(req,res,url); } catch(e){ sendJson(res, 500, { error:e.message }); } }).listen(port, ()=>console.log(`Tool QR Register running at http://localhost:${port}`));
