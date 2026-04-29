const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

let nodemailer = null;
try {
  nodemailer = require("nodemailer");
} catch {
  nodemailer = null;
}

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const dataFile = process.env.DATA_FILE || path.join(root, "tool-register-data.json");
const adminPin = process.env.ADMIN_PIN || "1234";
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function defaultState() {
  let assets = [];
  let workers = [];
  try {
    const source = fs.readFileSync(path.join(root, "registered-assets.js"), "utf8");
    const json = source.replace(/^window\.REGISTERED_ASSETS = /, "").replace(/;\s*$/, "");
    assets = JSON.parse(json);
  } catch {
    assets = [];
  }
  try {
    const source = fs.readFileSync(path.join(root, "workers.js"), "utf8");
    const json = source.replace(/^window\.AUTHORISED_WORKERS = /, "").replace(/;\s*$/, "");
    workers = JSON.parse(json);
  } catch {
    workers = [];
  }
  return {
    assets: assets.map(prepareAsset),
    history: [],
    settings: normaliseSettings({
      foremanEmails: process.env.FOREMAN_EMAILS || "",
      siteName: process.env.SITE_NAME || "Jundee",
      workers
    })
  };
}

function prepareAsset(asset) {
  const assetNumber = String(asset.assetNumber || "").toUpperCase();
  const serial = asset.serialNumber || "";
  const duplicate = Boolean(asset.duplicateAssetNumber);
  const id = asset.id || (duplicate && serial ? `${assetNumber}|${serial}` : assetNumber);
  return {
    ...asset,
    assetNumber,
    id: String(id).toUpperCase(),
    qrValue: String(asset.qrValue || id || assetNumber).toUpperCase(),
    status: asset.status || "available",
    holder: asset.holder || "",
    lastMoved: asset.lastMoved || ""
  };
}

function readState() {
  try {
    const state = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    state.assets = (state.assets || []).map(prepareAsset);
    state.history = state.history || [];
    state.settings = normaliseSettings(state.settings || {});
    return state;
  } catch {
    const state = defaultState();
    writeState(state);
    return state;
  }
}

function uniqueWorkers(workers) {
  const seen = new Set();
  return (Array.isArray(workers) ? workers : [])
    .map(worker => String(worker || "").trim())
    .filter(Boolean)
    .filter(worker => {
      const key = worker.toLowerCase().replace(/\s+/g, " ");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.localeCompare(b));
}

function normaliseSettings(settings) {
  let workers = uniqueWorkers(settings.workers || []);
  if (!workers.length) {
    try {
      const source = fs.readFileSync(path.join(root, "workers.js"), "utf8");
      const json = source.replace(/^window\.AUTHORISED_WORKERS = /, "").replace(/;\s*$/, "");
      workers = uniqueWorkers(JSON.parse(json));
    } catch {
      workers = [];
    }
  }
  return {
    foremanEmails: settings.foremanEmails || process.env.FOREMAN_EMAILS || "",
    siteName: settings.siteName || process.env.SITE_NAME || "Jundee",
    workers
  };
}

function approvedWorkerName(state, input) {
  const key = String(input || "").trim().toLowerCase().replace(/\s+/g, " ");
  return (state.settings?.workers || []).find(worker => worker.toLowerCase().replace(/\s+/g, " ") === key) || "";
}

function writeState(state) {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify(state, null, 2));
}

function sendJson(res, code, payload) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function requireAdmin(req, res) {
  if (req.headers["x-admin-pin"] === adminPin) return true;
  sendJson(res, 401, { error: "Admin PIN required" });
  return false;
}

function publicState(state) {
  return {
    assets: state.assets || [],
    history: state.history || [],
    settings: {
      foremanEmails: state.settings?.foremanEmails || process.env.FOREMAN_EMAILS || "",
      siteName: state.settings?.siteName || process.env.SITE_NAME || "Jundee",
      workers: state.settings?.workers || []
    }
  };
}

function buildTransport() {
  if (!nodemailer || !process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true",
    auth: process.env.SMTP_USER ? {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS || ""
    } : undefined
  });
}

async function sendMovementEmail(state, movement, asset) {
  const recipients = (state.settings?.foremanEmails || process.env.FOREMAN_EMAILS || "")
    .split(/[,\n;]/)
    .map(email => email.trim())
    .filter(Boolean);
  const transport = buildTransport();
  if (!transport || !recipients.length) return { sent: false, reason: "Email is not configured" };

  const action = movement.type === "checkout" ? "logged out" : "returned";
  const siteName = state.settings?.siteName || process.env.SITE_NAME || "Jundee";
  const body = [
    `Tool ${action}`,
    "",
    `Asset: ${asset.assetNumber}`,
    `Tool: ${asset.name}`,
    `Serial: ${asset.serialNumber || "-"}`,
    `Part number: ${asset.partNumber || "-"}`,
    `Person: ${movement.person}`,
    `Notes: ${movement.notes || "-"}`,
    `Time: ${new Date(movement.timestamp).toLocaleString()}`,
    `Site: ${siteName}`
  ].join("\n");

  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: recipients.join(","),
    subject: `${siteName} tool ${action}: ${asset.assetNumber}`,
    text: body
  });
  return { sent: true };
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/state") {
    sendJson(res, 200, publicState(readState()));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/check") {
    if (!requireAdmin(req, res)) return;
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/move") {
    const body = await readBody(req);
    const state = readState();
    const asset = (state.assets || []).find(item => item.id === body.assetId || item.qrValue === body.lookup || item.assetNumber === body.lookup);
    if (!asset) {
      sendJson(res, 404, { error: "Tool not found" });
      return;
    }
    if (body.type === "checkout") {
      const approved = approvedWorkerName(state, body.person);
      if (!approved) {
        sendJson(res, 400, { error: "Only approved workers can borrow tools" });
        return;
      }
      body.person = approved;
    }

    const timestamp = new Date().toISOString();
    asset.status = body.type === "checkout" ? "out" : "available";
    asset.holder = body.type === "checkout" ? body.person : "";
    asset.lastMoved = timestamp;
    const movement = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      assetNumber: asset.assetNumber,
      toolName: asset.name,
      type: body.type,
      person: body.person || "Workshop",
      notes: body.notes || "",
      timestamp
    };
    state.history = [movement, ...(state.history || [])];
    writeState(state);

    let email = { sent: false, reason: "Email not attempted" };
    try {
      email = await sendMovementEmail(state, movement, asset);
    } catch (error) {
      email = { sent: false, reason: error.message };
    }

    sendJson(res, 200, { state: publicState(state), movement, asset, email });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/state") {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    writeState(body);
    sendJson(res, 200, { state: publicState(body) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/settings") {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const state = readState();
    state.settings = normaliseSettings({
      ...(state.settings || {}),
      foremanEmails: body.foremanEmails || "",
      siteName: body.siteName || "Jundee",
      workers: body.workers || []
    });
    writeState(state);
    sendJson(res, 200, { state: publicState(state) });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

function serveStatic(req, res, url) {
  const cleanPath = decodeURIComponent(url.pathname);
  const filePath = path.join(root, cleanPath === "/" ? "index.html" : cleanPath);

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": types[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(port, () => {
  console.log(`Tool QR Register running at http://localhost:${port}`);
});
