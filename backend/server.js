"use strict";

const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const cron = require("node-cron");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");
const http = require("http");

// ── Environment ───────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "3001", 10);
const APP_PASSWORD = process.env.APP_PASSWORD || "admin";
const DATA_DIR = process.env.DATA_DIR || "/vw-data";
const BACKUP_DIR = process.env.BACKUP_DIR || "/backups";
const LOG_FILE = process.env.LOG_FILE || "/var/log/backup.log";
const CONFIG_DIR = process.env.CONFIG_DIR || "/config";
const STATIC_DIR = process.env.STATIC_DIR || null;
const SETTINGS_FILE = path.join(CONFIG_DIR, "settings.json");

// Warn if falling back to a random JWT secret — tokens won't survive restarts
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  JWT_SECRET = crypto.randomBytes(64).toString("hex");
  console.warn(
    "WARNING: JWT_SECRET env var is not set. Using a random secret — all sessions will be " +
    "invalidated on restart. Set JWT_SECRET for production use."
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function appendLog(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    ensureDir(path.dirname(LOG_FILE));
    fs.appendFileSync(LOG_FILE, line);
  } catch (e) {
    console.error("Failed to write log:", e.message);
  }
}

// ── Input validation ──────────────────────────────────────────────────────────
// Remote names: only alphanumeric, hyphens and underscores (safe for shell)
const SAFE_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function validateRemoteName(name) {
  if (!SAFE_NAME_RE.test(name)) {
    throw new Error(
      `Invalid remote name "${name}". Only letters, digits, hyphens and underscores are allowed.`
    );
  }
}

// Escape a path for safe use inside double-quoted shell arguments
function shellEscapePath(p) {
  return p.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/`/g, "\\`");
}

function loadSettings() {
  try {
    ensureDir(CONFIG_DIR);
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    }
  } catch (e) {
    appendLog(`Warning: could not load settings: ${e.message}`);
  }
  return { remotes: [], retention: { days: 30 }, telegram: {}, history: [] };
}

// ── Telegram notification ─────────────────────────────────────────────────────
function sendTelegramMessage(botToken, chatId, text) {
  return new Promise((resolve) => {
    if (!botToken || !chatId) return resolve();
    const body = JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" });
    const options = {
      hostname: "api.telegram.org",
      path: `/bot${botToken}/sendMessage`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 10000,
    };
    const req = https.request(options, (res) => {
      res.resume();
      resolve();
    });
    req.on("error", () => resolve());
    req.on("timeout", () => { req.destroy(); resolve(); });
    req.write(body);
    req.end();
  });
}

// ── Disk space helper ─────────────────────────────────────────────────────────
function getDiskSpace(dir) {
  const safeDir = shellEscapePath(dir);
  return new Promise((resolve) => {
    exec(`df -k "${safeDir}" 2>/dev/null | tail -1`, { timeout: 5000 }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const parts = stdout.trim().split(/\s+/);
      if (parts.length < 5) return resolve(null);
      // df -k columns: Filesystem 1K-blocks Used Available Use% Mountpoint
      resolve({
        total: parseInt(parts[1], 10) * 1024,
        used: parseInt(parts[2], 10) * 1024,
        available: parseInt(parts[3], 10) * 1024,
      });
    });
  });
}

function saveSettings(settings) {
  ensureDir(CONFIG_DIR);
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

function execPromise(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 30000, ...opts }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.trim());
    });
  });
}

// Maximum number of backup history entries to persist
const MAX_HISTORY_ENTRIES = 50;
const backupState = {
  running: false,
  lastRun: null,      // ISO string
  lastStatus: null,   // "success" | "error"
  lastMessage: "",
  storageUsed: 0,     // bytes
};

// ── App setup ─────────────────────────────────────────────────────────────────
const app = express();

app.use(cors());
app.use(express.json());

// Serve built frontend if STATIC_DIR is set
if (STATIC_DIR && fs.existsSync(STATIC_DIR)) {
  app.use(express.static(STATIC_DIR));
}

// ── Rate limiter on auth ───────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts, please try again later." },
});

// ── JWT middleware ────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "No token provided." });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────
app.post("/api/auth/login", authLimiter, async (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: "Password is required." });

  // Prefer password hash stored in settings.json; fall back to APP_PASSWORD env var.
  const settings = loadSettings();
  const storedPassword = settings.passwordHash || APP_PASSWORD;

  // Support both plain-text and bcrypt-hashed passwords.
  // Detect bcrypt by checking for the full versioned prefix ($2a$, $2b$, $2y$).
  let valid = false;
  if (/^\$2[aby]\$\d{2}\$/.test(storedPassword)) {
    valid = await bcrypt.compare(password, storedPassword);
  } else {
    valid = password === storedPassword;
  }

  if (!valid) return res.status(401).json({ error: "Invalid password." });

  const token = jwt.sign({ sub: "admin" }, JWT_SECRET, { expiresIn: "24h" }); // Sessions last 24 hours per security policy
  return res.json({ token });
});

// ── Change password ────────────────────────────────────────────────────────────
app.post("/api/auth/change-password", async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Fields 'currentPassword' and 'newPassword' are required." });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters." });
  }

  const settings = loadSettings();
  const storedPassword = settings.passwordHash || APP_PASSWORD;

  let valid = false;
  if (/^\$2[aby]\$\d{2}\$/.test(storedPassword)) {
    valid = await bcrypt.compare(currentPassword, storedPassword);
  } else {
    valid = currentPassword === storedPassword;
  }

  if (!valid) return res.status(401).json({ error: "Current password is incorrect." });

  const hash = await bcrypt.hash(newPassword, 12);
  settings.passwordHash = hash;
  saveSettings(settings);
  appendLog("Admin password changed successfully.");
  return res.json({ message: "Password changed successfully." });
});

// ── Protect all other /api/* routes ──────────────────────────────────────────
app.use("/api", requireAuth);

// ── Status ────────────────────────────────────────────────────────────────────
app.get("/api/status", (req, res) => {
  // Refresh storage used from BACKUP_DIR
  try {
    if (fs.existsSync(BACKUP_DIR)) {
      const files = fs.readdirSync(BACKUP_DIR);
      let total = 0;
      for (const f of files) {
        try {
          total += fs.statSync(path.join(BACKUP_DIR, f)).size;
        } catch {}
      }
      backupState.storageUsed = total;
    }
  } catch {}

  res.json({
    last_backup: backupState.lastRun,
    storage_used: backupState.storageUsed,
    status: backupState.lastStatus,
    is_running: backupState.running,
    last_message: backupState.lastMessage,
  });
});

// ── Logs ──────────────────────────────────────────────────────────────────────
app.get("/api/logs", (req, res) => {
  const lines = parseInt(req.query.lines || "200", 10);
  try {
    if (!fs.existsSync(LOG_FILE)) {
      return res.json({ logs: [] });
    }
    const content = fs.readFileSync(LOG_FILE, "utf8");
    const all = content.split("\n").filter(Boolean);
    return res.json({ logs: all.slice(-lines) });
  } catch (e) {
    return res.status(500).json({ error: `Could not read log file: ${e.message}` });
  }
});

// ── Backup ────────────────────────────────────────────────────────────────────
app.post("/api/backup/run", (req, res) => {
  if (backupState.running) {
    return res.status(409).json({ error: "A backup is already running." });
  }

  // Validate prerequisites
  if (!fs.existsSync(DATA_DIR)) {
    return res.status(422).json({ error: `DATA_DIR "${DATA_DIR}" does not exist.` });
  }

  const settings = loadSettings();
  const activeRemotes = settings.remotes || [];
  if (activeRemotes.length === 0) {
    return res.status(422).json({ error: "No rclone remotes configured." });
  }

  // Respond immediately and run in background
  res.json({ message: "Backup started." });
  runBackup(settings);
});

async function runBackup(settings) {
  backupState.running = true;
  const startTime = Date.now();
  appendLog("=== Backup started ===");

  let archiveName = "";
  let archiveSizeBytes = 0;

  try {
    // 1. Check rclone availability
    await execPromise("rclone version").catch(() => {
      throw new Error("rclone is not installed or not in PATH.");
    });

    // 2. Ensure BACKUP_DIR exists
    ensureDir(BACKUP_DIR);

    // 3. Create tar.gz with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    archiveName = `backup-${timestamp}.tar.gz`;
    const archivePath = path.join(BACKUP_DIR, archiveName);

    appendLog(`Creating archive: ${archivePath}`);
    const safeArchive = shellEscapePath(archivePath);
    const safeParent  = shellEscapePath(path.dirname(DATA_DIR));
    const safeBase    = shellEscapePath(path.basename(DATA_DIR));
    await execPromise(`tar -czf "${safeArchive}" -C "${safeParent}" "${safeBase}"`, {
      timeout: 600000, // 10 min
    });
    appendLog(`Archive created successfully.`);

    // Get archive size
    try { archiveSizeBytes = fs.statSync(archivePath).size; } catch (e) {
      appendLog(`Warning: could not read archive size: ${e.message}`);
    }

    // 4. Upload to each configured remote
    for (const remote of settings.remotes) {
      validateRemoteName(remote.name);
      const safeFolder = shellEscapePath(remote.folder || "");
      const remotePath = `${remote.name}:${safeFolder}`;
      appendLog(`Uploading to remote: ${remotePath}`);
      await execPromise(`rclone copy "${safeArchive}" "${remotePath}"`, { timeout: 1800000 });
      appendLog(`Upload to ${remotePath} complete.`);
    }

    // 5. Retention policy – delete old backups from remotes
    const retentionDays = (settings.retention && settings.retention.days) || 30;
    await applyRetention(settings.remotes, retentionDays);

    // 6. Update state
    const duration = Math.round((Date.now() - startTime) / 1000);
    backupState.lastRun = new Date().toISOString();
    backupState.lastStatus = "success";
    backupState.lastMessage = `Backup completed: ${archiveName}`;
    appendLog("=== Backup finished successfully ===");

    // 7. Record history
    addHistory({
      timestamp: backupState.lastRun,
      status: "success",
      fileName: archiveName,
      fileSize: archiveSizeBytes,
      duration,
      destinations: (settings.remotes || []).map((r) => r.name),
    });

    // 8. Send Telegram notification
    const tg = settings.telegram || {};
    if (tg.botToken && tg.chatId) {
      const sizeMB = (archiveSizeBytes / (1024 * 1024)).toFixed(2);
      const dests = (settings.remotes || []).map((r) => r.name).join(", ") || "None";
      const msg =
        `✅ <b>Backup Successful</b>\n` +
        `📁 <b>File:</b> ${archiveName}\n` +
        `📦 <b>Size:</b> ${sizeMB} MB\n` +
        `☁️ <b>Destination:</b> ${dests}\n` +
        `⏱ <b>Duration:</b> ${duration}s`;
      sendTelegramMessage(tg.botToken, tg.chatId, msg).catch(() => {});
    }
  } catch (err) {
    const duration = Math.round((Date.now() - startTime) / 1000);
    backupState.lastRun = new Date().toISOString();
    backupState.lastStatus = "error";
    backupState.lastMessage = err.message;
    appendLog(`=== Backup failed: ${err.message} ===`);

    // Record history
    addHistory({
      timestamp: backupState.lastRun,
      status: "error",
      fileName: archiveName || "",
      fileSize: 0,
      duration,
      destinations: (settings.remotes || []).map((r) => r.name),
      error: err.message,
    });

    // Send Telegram failure notification
    const tg = settings.telegram || {};
    if (tg.botToken && tg.chatId) {
      const dests = (settings.remotes || []).map((r) => r.name).join(", ") || "None";
      const msg =
        `❌ <b>Backup Failed</b>\n` +
        `☁️ <b>Destination:</b> ${dests}\n` +
        `⏱ <b>Duration:</b> ${duration}s\n` +
        `⚠️ <b>Error:</b> ${err.message}`;
      sendTelegramMessage(tg.botToken, tg.chatId, msg).catch(() => {});
    }
  } finally {
    backupState.running = false;
  }
}

function addHistory(entry) {
  try {
    const settings = loadSettings();
    const history = settings.history || [];
    history.push(entry);
    // Keep last MAX_HISTORY_ENTRIES entries
    settings.history = history.slice(-MAX_HISTORY_ENTRIES);
    saveSettings(settings);
  } catch (e) {
    appendLog(`Warning: could not save backup history: ${e.message}`);
  }
}

async function applyRetention(remotes, days) {
  if (!days || days <= 0) return;
  const cutoff = Date.now() - days * 86400 * 1000;

  for (const remote of remotes) {
    validateRemoteName(remote.name);
    const safeFolder = shellEscapePath(remote.folder || "");
    const remotePath = `${remote.name}:${safeFolder}`;
    appendLog(`Applying retention (${days} days) on ${remotePath}`);
    try {
      const output = await execPromise(`rclone lsjson "${remotePath}"`, { timeout: 60000 });
      const files = JSON.parse(output || "[]");
      for (const file of files) {
        if (!file.IsDir && new Date(file.ModTime).getTime() < cutoff) {
          // file.Path comes from rclone JSON output — escape before use in shell
          const safeFilePath = shellEscapePath(`${remote.name}:${remote.folder || ""}/${file.Path}`);
          appendLog(`Deleting old backup: ${safeFilePath}`);
          await execPromise(`rclone deletefile "${safeFilePath}"`, { timeout: 30000 }).catch((e) =>
            appendLog(`Warning: could not delete ${safeFilePath}: ${e.message}`)
          );
        }
      }
    } catch (e) {
      appendLog(`Warning: retention check failed for ${remotePath}: ${e.message}`);
    }
  }
}

// ── Remotes – list ────────────────────────────────────────────────────────────
app.get("/api/config/remotes", (req, res) => {
  const settings = loadSettings();
  res.json({ remotes: settings.remotes || [] });
});

// ── Remotes – create / update ─────────────────────────────────────────────────
app.post("/api/config/remote", (req, res) => {
  const { name, type, folder, credentials } = req.body || {};
  if (!name || !type) {
    return res.status(400).json({ error: "Fields 'name' and 'type' are required." });
  }

  try { validateRemoteName(name); } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const settings = loadSettings();
  settings.remotes = settings.remotes || [];

  const idx = settings.remotes.findIndex((r) => r.name === name);
  const entry = { name, type, folder: folder || "", credentials: credentials || {} };

  if (idx >= 0) {
    settings.remotes[idx] = entry;
  } else {
    settings.remotes.push(entry);
  }

  // Write rclone config entry
  try {
    writeRcloneConfig(entry);
  } catch (e) {
    appendLog(`Warning: could not write rclone config for ${name}: ${e.message}`);
  }

  saveSettings(settings);
  res.json({ message: `Remote "${name}" saved.`, remote: entry });
});

// ── Remotes – delete ──────────────────────────────────────────────────────────
app.delete("/api/config/remote/:name", (req, res) => {
  const { name } = req.params;

  try { validateRemoteName(name); } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const settings = loadSettings();
  const before = (settings.remotes || []).length;
  settings.remotes = (settings.remotes || []).filter((r) => r.name !== name);

  if (settings.remotes.length === before) {
    return res.status(404).json({ error: `Remote "${name}" not found.` });
  }

  saveSettings(settings);

  // Remove from rclone config — name is already validated as safe
  exec(`rclone config delete "${name}"`, () => {});

  res.json({ message: `Remote "${name}" deleted.` });
});

// ── Remotes – test ────────────────────────────────────────────────────────────
app.post("/api/config/remote/:name/test", async (req, res) => {
  const { name } = req.params;
  try { validateRemoteName(name); } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  try {
    await execPromise(`rclone lsd "${name}:" --max-depth 1`, { timeout: 30000 });
    res.json({ success: true, message: `Connection to "${name}" successful.` });
  } catch (e) {
    res.status(422).json({ success: false, error: e.message });
  }
});

// ── Remotes – list folders ────────────────────────────────────────────────────
app.get("/api/config/remote/:name/folders", async (req, res) => {
  const { name } = req.params;
  try { validateRemoteName(name); } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  try {
    const output = await execPromise(`rclone lsd "${name}:" --max-depth 1`, { timeout: 30000 });
    const folders = output
      .split("\n")
      .filter(Boolean)
      .map((line) => line.trim().split(/\s+/).pop());
    res.json({ folders });
  } catch (e) {
    res.status(422).json({ error: e.message });
  }
});

// ── Retention – get ───────────────────────────────────────────────────────────
app.get("/api/config/retention", (req, res) => {
  const settings = loadSettings();
  const r = settings.retention || { days: 30, cron: "" };
  res.json({ days: r.days ?? 30, cron: r.cron || "" });
});

// ── Retention – set ───────────────────────────────────────────────────────────
app.post("/api/config/retention", (req, res) => {
  const { days, cron } = req.body || {};
  if (days === undefined || isNaN(Number(days)) || Number(days) < 0) {
    return res.status(400).json({ error: "Field 'days' must be a non-negative number." });
  }

  const settings = loadSettings();
  settings.retention = { days: Number(days), cron: cron || settings.retention?.cron || "" };
  saveSettings(settings);
  applySchedule(settings.retention.cron);
  res.json({ message: "Retention policy saved.", days: settings.retention.days, cron: settings.retention.cron });
});

// ── Telegram – get ────────────────────────────────────────────────────────────
app.get("/api/config/telegram", (req, res) => {
  const settings = loadSettings();
  const t = settings.telegram || {};
  res.json({ botToken: t.botToken ? "***" : "", chatId: t.chatId || "", enabled: Boolean(t.botToken && t.chatId) });
});

// ── Telegram – set ────────────────────────────────────────────────────────────
app.post("/api/config/telegram", (req, res) => {
  const { botToken, chatId } = req.body || {};
  const settings = loadSettings();
  settings.telegram = { botToken: botToken || "", chatId: chatId || "" };
  saveSettings(settings);
  res.json({ message: "Telegram settings saved.", enabled: Boolean(botToken && chatId) });
});

// ── Telegram – test ───────────────────────────────────────────────────────────
app.post("/api/config/telegram/test", async (req, res) => {
  const settings = loadSettings();
  const { botToken, chatId } = settings.telegram || {};
  if (!botToken || !chatId) {
    return res.status(422).json({ error: "Telegram is not configured. Please save Bot Token and Chat ID first." });
  }
  try {
    await sendTelegramMessage(botToken, chatId, "🔔 <b>Rei-Warden Test</b>\nTelegram notifications are working!");
    res.json({ success: true, message: "Test message sent successfully." });
  } catch (e) {
    res.status(422).json({ success: false, error: e.message });
  }
});

// ── Backup history ────────────────────────────────────────────────────────────
app.get("/api/backup/history", (req, res) => {
  const settings = loadSettings();
  res.json({ history: (settings.history || []).slice(-10).reverse() });
});

// ── Disk space ────────────────────────────────────────────────────────────────
app.get("/api/system/disk", async (req, res) => {
  const disk = await getDiskSpace(BACKUP_DIR).catch(() => null);
  res.json(disk || { total: 0, used: 0, available: 0 });
});

// ── rclone config writer ──────────────────────────────────────────────────────
function writeRcloneConfig(remote) {
  // Build a minimal rclone config snippet and write it to a secure temp file
  validateRemoteName(remote.name);
  const creds = remote.credentials || {};
  // Sanitize type and credential values: strip newlines and carriage returns to
  // prevent config injection via user-supplied values.
  const safeType = String(remote.type || "").replace(/[\r\n]/g, "");
  let config = `[${remote.name}]\ntype = ${safeType}\n`;
  for (const [k, v] of Object.entries(creds)) {
    const safeKey = String(k).replace(/[\r\n=]/g, "");
    const safeVal = String(v).replace(/[\r\n]/g, "");
    if (safeKey) config += `${safeKey} = ${safeVal}\n`;
  }

  // Use crypto for unique temp file name to avoid race conditions
  const uniqueSuffix = crypto.randomBytes(8).toString("hex");
  const tmpFile = path.join("/tmp", `.rclone_import_${uniqueSuffix}.conf`);
  fs.writeFileSync(tmpFile, config, { mode: 0o600 });

  exec(`rclone config update "${remote.name}" --config "${tmpFile}"`, (err) => {
    try { fs.unlinkSync(tmpFile); } catch {}
    if (err) appendLog(`Warning: rclone config update for ${remote.name} failed: ${err.message}`);
  });
}

// ── Scheduled backups (node-cron) ─────────────────────────────────────────────
let scheduledJob = null;

function applySchedule(cronExpression) {
  if (scheduledJob) {
    scheduledJob.stop();
    scheduledJob = null;
  }
  if (!cronExpression) return;
  if (!cron.validate(cronExpression)) {
    appendLog(`Warning: invalid cron expression "${cronExpression}" — scheduled backup not set.`);
    return;
  }
  scheduledJob = cron.schedule(cronExpression, () => {
    if (backupState.running) {
      appendLog("Scheduled backup skipped — a backup is already running.");
      return;
    }
    const settings = loadSettings();
    if ((settings.remotes || []).length === 0) {
      appendLog("Scheduled backup skipped — no remotes configured.");
      return;
    }
    appendLog(`Scheduled backup triggered by cron: ${cronExpression}`);
    runBackup(settings);
  });
  appendLog(`Scheduled backup configured: ${cronExpression}`);
}

// ── Catch-all: serve SPA index.html for non-API routes ───────────────────────
app.use((req, res) => {
  if (STATIC_DIR && fs.existsSync(path.join(STATIC_DIR, "index.html"))) {
    return res.sendFile(path.join(STATIC_DIR, "index.html"));
  }
  res.status(404).json({ error: "Not found." });
});

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  appendLog(`Unhandled error: ${err.message}`);
  res.status(500).json({ error: "Internal server error." });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Rei-Warden backend listening on port ${PORT}`);
  appendLog(`Server started on port ${PORT}`);
  // Restore any scheduled backup from persisted settings
  const settings = loadSettings();
  if (settings.retention && settings.retention.cron) {
    applySchedule(settings.retention.cron);
  }
});

module.exports = app;
