const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
"use strict";

const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const cron = require("node-cron");
const { exec } = require("child_process");
const fs = require("fs");
const crypto = require("crypto");
const https = require("https");
const http = require("http");
const nodemailer = require("nodemailer");

// ── Environment ───────────────────────────────────────────────────────────────
const NODE_ENV = process.env.NODE_ENV || "production";
const IS_DEVELOPMENT = NODE_ENV === "development";
const PORT = parseInt(process.env.PORT || "3001", 10);
const APP_SECRET_KEY = process.env.APP_SECRET_KEY || "Thanhnam0";
const RECOVERY_EMAIL = "namnt05@gmail.com";
const DATA_DIR = process.env.DATA_DIR || (IS_DEVELOPMENT ? "./mock-vw-data" : "/vw-data");
const BACKUP_DIR = process.env.BACKUP_DIR || (IS_DEVELOPMENT ? "./mock-backups" : "/backups");
const LOG_FILE = process.env.LOG_FILE || (IS_DEVELOPMENT ? "./mock-logs/backup.log" : "/var/log/backup.log");
const CONFIG_DIR = process.env.CONFIG_DIR || (IS_DEVELOPMENT ? "./mock-config" : "/app/config");
const STATIC_DIR = process.env.STATIC_DIR || null;
const SETTINGS_FILE = path.join(CONFIG_DIR, "settings.json");
const RCLONE_CONFIG_FILE = process.env.RCLONE_CONFIG_FILE || (IS_DEVELOPMENT ? "./mock-config/rclone.conf" : "/root/.config/rclone/rclone.conf");
const RCLONE_EXE = process.env.RCLONE_EXE || "rclone";
const RCLONE_DISABLE_MOCK = String(process.env.RCLONE_DISABLE_MOCK).trim().toLowerCase() === "true";

if (IS_DEVELOPMENT) {
  console.log("🚀 DEVELOPMENT MODE ENABLED");
  console.log(`  - DATA_DIR: ${path.resolve(DATA_DIR)}`);
  console.log(`  - BACKUP_DIR: ${path.resolve(BACKUP_DIR)}`);
  console.log(`  - CONFIG_DIR: ${path.resolve(CONFIG_DIR)}`);
  console.log(`  - SETTINGS_FILE: ${path.resolve(SETTINGS_FILE)}`);
  console.log(`  - ENV RCLONE_DISABLE_MOCK: "${process.env.RCLONE_DISABLE_MOCK}" (parsed: ${RCLONE_DISABLE_MOCK})`);
  console.log(`  - ENV RCLONE_EXE: "${process.env.RCLONE_EXE}"`);

  // Ensure we have directories for mocks
  ensureDir(path.dirname(LOG_FILE));
  ensureDir(DATA_DIR);
  ensureDir(BACKUP_DIR);
  ensureDir(CONFIG_DIR);

  if (RCLONE_DISABLE_MOCK) {
    console.log("  - Rclone MOCKING IS DISABLED (Real cloud operations)");
  } else {
    console.log("  - Rclone will be MOCKED");
  }
} else {
  console.log("🌐 PRODUCTION MODE");
  console.log(`  - Settings location: ${path.resolve(SETTINGS_FILE)}`);
}

// Warn if falling back to a random JWT secret — tokens won't survive restarts
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (IS_DEVELOPMENT) {
    // In development mode, use a stable default secret so tokens survive restarts
    JWT_SECRET = "dev-secret-do-not-use-in-production-12345678";
    console.warn("ℹ️  JWT_SECRET not set. Using default development secret.");
  } else {
    // In production, generate random and warn
    JWT_SECRET = crypto.randomBytes(64).toString("hex");
    console.warn(
      "WARNING: JWT_SECRET env var is not set. Using a random secret — all sessions will be " +
      "invalidated on restart. Set JWT_SECRET for production use."
    );
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      if (err.code === 'EACCES') {
        const msg = `Permission denied creating directory: ${dir}. In development mode, ensure NODE_ENV=development is set.`;
        if (IS_DEVELOPMENT) {
          console.warn(`⚠️  ${msg}`);
          appendLog(`Warning: ${msg}`);
        } else {
          throw new Error(msg);
        }
      } else {
        throw err;
      }
    }
  }
}

function appendLog(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    ensureDir(path.dirname(LOG_FILE));
    fs.appendFileSync(LOG_FILE, line);
  } catch (e) {
    // In development, silently skip log writes if permissions denied
    // In production, print warning
    if (!IS_DEVELOPMENT || e.code !== 'EACCES') {
      if (e.code !== 'EACCES') {
        console.error("Failed to write log:", e.message);
      }
    }
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function loadSettings() {
  try {
    ensureDir(CONFIG_DIR);
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = fs.readFileSync(SETTINGS_FILE, "utf8");
      if (data) return JSON.parse(data);
    }
  } catch (e) {
    appendLog(`Warning: could not load settings from ${SETTINGS_FILE}: ${e.message}`);
    console.error(`❌ Load Settings Error: ${e.message}`);
  }
  // Default structure
  return {
    remotes: [],
    retention: { days: 30, cron: "0 0 * * *" },
    telegram: {},
    history: [],
    user: { email: RECOVERY_EMAIL, passwordHash: "", isDefault: true }
  };
}

function getPasswordHashFromSettings() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return null;
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    const hash = parsed && typeof parsed.passwordHash === "string" ? parsed.passwordHash.trim() : "";
    return hash || null;
  } catch (e) {
    appendLog(`Warning: could not read password hash: ${e.message}`);
    return null;
  }
}

// ── Mail Helper ──────────────────────────────────────────────────────────────
async function sendResetEmail(email, token) {
  const targetEmail = email || RECOVERY_EMAIL;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT || 587,
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${token}`;

  const info = await transporter.sendMail({
    from: `"Rei-Warden" <${process.env.SMTP_USER}>`,
    to: email,
    subject: "Password Reset Request",
    html: `
      <div style="font-family: sans-serif; color: #333; padding: 20px;">
        <h2>Rei-Warden Password Reset</h2>
        <p>You requested a password reset. Click the button below to set a new password:</p>
        <div style="margin: 30px 0;">
          <a href="${resetLink}" style="background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">Reset Password</a>
        </div>
        <p>If you didn't request this, you can safely ignore this email.</p>
        <p>The link will expire in 1 hour.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin-top: 30px;">
        <p style="font-size: 12px; color: #777;">🛡️ Rei-Warden Backup Manager</p>
      </div>
    `,
  });

  appendLog(`Reset email sent to ${email}: ${info.messageId}`);
}

// ── Mock Rclone (Development Mode) ──────────────────────────────────────────────
const mockRcloneResponses = {
  lsd: {
    folders: ["folder1", "folder2", "backup-archive"],
    output: "folder1\nfolder2\nbackup-archive"
  },
  lsjson: [{
    Path: "backup-2025-02-20.tar.gz",
    Size: 1073741824,
    ModTime: new Date(Date.now() - 2 * 86400000).toISOString(),
    IsDir: false
  }, {
    Path: "backup-2025-02-15.tar.gz",
    Size: 1048576000,
    ModTime: new Date(Date.now() - 7 * 86400000).toISOString(),
    IsDir: false
  }],
  version: "rclone v1.63.1\n: go1.21.3 on linux/amd64"
};

async function mockRcloneCommand(args) {
  // Simulate command processing without actual rclone
  if (args.includes("lsd")) {
    return mockRcloneResponses.lsd.output;
  } else if (args.includes("lsjson")) {
    return JSON.stringify(mockRcloneResponses.lsjson);
  } else if (args.includes("version")) {
    return mockRcloneResponses.version;
  } else if (args.includes("copy")) {
    appendLog(`[MOCK] Simulated rclone copy: ${args}`);
    return "100% copy complete";
  } else if (args.includes("deletefile")) {
    appendLog(`[MOCK] Simulated rclone deletefile: ${args}`);
    return "Deleted";
  } else if (args.includes("rcat")) {
    appendLog(`[MOCK] Simulated rclone rcat: ${args}`);
    return "rcat: Transfer complete";
  }
  return "OK";
}

function getRcloneCommand(args) {
  const safeConfig = shellEscapePath(RCLONE_CONFIG_FILE);
  // On Windows, if the path has spaces, it needs quotes.
  // If we just use rclone, we don't necessarily need them but it doesn't hurt.
  // However, CMD.exe can be picky about the first quoted argument.
  const exe = RCLONE_EXE.includes(" ") ? `"${RCLONE_EXE}"` : RCLONE_EXE;
  return `${exe} --config="${safeConfig}" ${args}`;
}

function validateDropboxToken(tokenStr) {
  if (!tokenStr) throw new Error("Dropbox token is required");
  try {
    JSON.parse(tokenStr);
    return true;
  } catch {
    throw new Error("Invalid Dropbox token: must be valid JSON");
  }
}

function rcloneConfigExists() {
  return fs.existsSync(RCLONE_CONFIG_FILE);
}

function rcloneConfigHasRemote(remoteName) {
  if (!rcloneConfigExists()) return false;
  const content = fs.readFileSync(RCLONE_CONFIG_FILE, "utf8");
  const pattern = new RegExp(`^\\[${escapeRegExp(remoteName)}\\]$`, "m");
  return pattern.test(content);
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
  // In development mode, intercept rclone commands and mock them (unless disabled)
  if (IS_DEVELOPMENT && !RCLONE_DISABLE_MOCK && cmd.toLowerCase().includes("rclone")) {
    // A more robust way to extract arguments for the mock: 
    // split by --config="..." and take what's after.
    const parts = cmd.split(/--config="[^"]*"\s+/);
    if (parts.length > 1) {
      const rcloneArgs = parts[1].trim();
      return Promise.resolve().then(() => mockRcloneCommand(rcloneArgs));
    }
  }

  return new Promise((resolve, reject) => {
    // Add RCLONE_CONFIG to env for rclone commands
    const env = { ...process.env, RCLONE_CONFIG: RCLONE_CONFIG_FILE };
    exec(cmd, { timeout: 30000, env, ...opts }, (err, stdout, stderr) => {
      if (err) {
        console.error(`[EXEC ERROR] Command: ${cmd}`);
        console.error(`[EXEC ERROR] Stderr: ${stderr}`);
        return reject(new Error(stderr || err.message));
      }
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
  skip: (req) => IS_DEVELOPMENT, // Disable rate limiting in development mode
  handler: (req, res) => {
    res.status(429).json({ error: "Too many login attempts, please try again later." });
  },
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
  const { secretKey } = req.body || {};
  if (!secretKey) return res.status(400).json({ error: "Secret Key is required." });

  const settings = loadSettings();

  // Initialize user settings if not exists
  if (!settings.user) {
    settings.user = {
      email: RECOVERY_EMAIL,
      passwordHash: "",
      isDefault: true
    };
    saveSettings(settings);
  }

  let valid = false;
  let isFirstLogin = false;

  // 1. Check if user is using the default key for the first time
  if (!settings.user.passwordHash || settings.user.isDefault) {
    valid = secretKey === APP_SECRET_KEY;
    if (valid) isFirstLogin = true;
  }

  // 2. If not default, check against stored hash
  if (!valid && settings.user.passwordHash) {
    valid = await bcrypt.compare(secretKey, settings.user.passwordHash);
  }

  if (!valid) {
    return res.status(401).json({ error: "Invalid Secret Key." });
  }

  const token = jwt.sign({ sub: settings.user.email }, JWT_SECRET, { expiresIn: "24h" });
  return res.json({ token, isFirstLogin });
});

app.post("/api/auth/forgot-password", authLimiter, async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: "Email is required." });

  const settings = loadSettings();
  const targetEmail = RECOVERY_EMAIL;

  if (!settings.user || settings.user.email !== email) {
    // Return success anyway to prevent email enumeration
    return res.json({ message: "If that email is registered, you will receive a reset link shortly." });
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expires = Date.now() + 3600000; // 1 hour

  settings.user.resetToken = token;
  settings.user.resetTokenExpires = expires;
  saveSettings(settings);

  try {
    if (IS_DEVELOPMENT || !process.env.SMTP_HOST) {
      appendLog(`[DEV] Password reset token for ${email}: ${token}`);
      console.log(`🚀 [DEV] Password reset link: http://localhost:5173/reset-password?token=${token}`);
    } else {
      await sendResetEmail(email, token);
    }
    return res.json({ message: "If that email is registered, you will receive a reset link shortly." });
  } catch (err) {
    appendLog(`Error sending reset email: ${err.message}`);
    return res.status(500).json({ error: "Failed to send reset email." });
  }
});

app.post("/api/auth/reset-password", async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) {
    return res.status(400).json({ error: "Token and password are required." });
  }

  const settings = loadSettings();
  if (!settings.user || settings.user.resetToken !== token || settings.user.resetTokenExpires < Date.now()) {
    return res.status(400).json({ error: "Invalid or expired reset token." });
  }

  const hash = await bcrypt.hash(password, 12);
  settings.user.passwordHash = hash;
  delete settings.user.resetToken;
  delete settings.user.resetTokenExpires;
  saveSettings(settings);

  appendLog(`Password reset successful for ${settings.user.email}`);
  return res.json({ message: "Password reset successful." });
});

app.get("/api/auth/config", (req, res) => {
  const settings = loadSettings();
  res.json({
    isRegistered: !!(settings.user && settings.user.email),
  });
});

// ── Change password ────────────────────────────────────────────────────────────
app.post("/api/auth/change-password", requireAuth, async (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword) {
    return res.status(400).json({ error: "New Secret Key is required." });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "Secret Key must be at least 8 characters." });
  }

  const settings = loadSettings();
  const hash = await bcrypt.hash(newPassword, 12);

  if (!settings.user) settings.user = { email: RECOVERY_EMAIL };
  settings.user.passwordHash = hash;
  settings.user.isDefault = false;

  saveSettings(settings);
  appendLog("Secret Key updated successfully.");
  return res.json({ message: "Secret Key updated successfully." });
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
        } catch { }
      }
      backupState.storageUsed = total;
    }
  } catch { }

  res.json({
    last_backup: backupState.lastRun,
    storage_used: backupState.storageUsed,
    status: backupState.lastStatus,
    is_running: backupState.running,
    last_message: backupState.lastMessage,
    dev_mode: IS_DEVELOPMENT,
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
  try {
    ensureDir(DATA_DIR);
  } catch (e) {
    return res.status(422).json({ error: `Cannot create DATA_DIR "${DATA_DIR}": ${e.message}` });
  }

  const settings = loadSettings();
  const activeRemotes = settings.remotes || [];
  const missing = [];

  // In development mode, skip rclone config checks (use settings.json only)
  if (!IS_DEVELOPMENT) {
    if (!rcloneConfigExists()) {
      missing.push(`Missing rclone config at ${RCLONE_CONFIG_FILE}`);
    }
  }

  if (activeRemotes.length === 0) {
    missing.push("No rclone remotes configured");
  } else if (!IS_DEVELOPMENT) {
    // In production, verify remotes exist in rclone config
    activeRemotes.forEach((remote, index) => {
      const name = (remote && remote.name ? String(remote.name).trim() : "");
      if (!name) {
        missing.push(`Remote entry at index ${index} is missing a name`);
        return;
      }
      if (!rcloneConfigHasRemote(name)) {
        missing.push(`Remote "${name}" not found in rclone config`);
      }
    });
  }

  if (missing.length > 0) {
    const detail = `Backup prerequisites missing: ${missing.join("; ")}`;
    console.error(detail);
    appendLog(detail);
    return res.status(422).json({ error: detail });
  }

  // Respond immediately and run in background
  res.json({ message: "Backup started." });
  runBackup(settings);
});

async function runBackup(settings) {
  backupState.running = true;
  const startTime = Date.now();
  appendLog(`=== Backup started ===${IS_DEVELOPMENT ? " [DEVELOPMENT MODE - USING MOCKS]" : ""} ===`);

  let archiveName = "";
  let archiveSizeBytes = 0;

  try {
    // 1. Check rclone availability (or skip in development)
    if (!IS_DEVELOPMENT) {
      await execPromise(getRcloneCommand("version")).catch(() => {
        throw new Error("rclone is not installed or not in PATH.");
      });
    } else {
      appendLog("[MOCK] Skipping rclone version check (development mode)");
    }

    // 2. Ensure BACKUP_DIR exists
    ensureDir(BACKUP_DIR);

    // 3. Create tar.gz with timestamp (or mock in development)
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    archiveName = `backup-${timestamp}.tar.gz`;
    const archivePath = path.join(BACKUP_DIR, archiveName);

    appendLog(`Creating archive: ${archivePath}`);

    let safeArchive = "";
    if (IS_DEVELOPMENT) {
      // Mock: Create a dummy tar.gz file for development
      const mockData = Buffer.from("Mock backup archive for development testing");
      fs.writeFileSync(archivePath, mockData);
      appendLog("[MOCK] Mock archive created successfully.");
      archiveSizeBytes = mockData.length;
      safeArchive = shellEscapePath(archivePath);
    } else {
      safeArchive = shellEscapePath(archivePath);
      const safeParent = shellEscapePath(path.dirname(DATA_DIR));
      const safeBase = shellEscapePath(path.basename(DATA_DIR));
      await execPromise(`tar -czf "${safeArchive}" -C "${safeParent}" "${safeBase}"`, {
        timeout: 600000, // 10 min
      });
      appendLog(`Archive created successfully.`);
      try { archiveSizeBytes = fs.statSync(archivePath).size; } catch (e) {
        appendLog(`Warning: could not read archive size: ${e.message}`);
      }
    }

    // 4. Upload to each configured remote
    for (const remote of settings.remotes) {
      validateRemoteName(remote.name);
      const safeFolder = shellEscapePath(remote.folder || "");
      const remotePath = `${remote.name}:${safeFolder}`;
      appendLog(`Uploading to remote: ${remotePath}`);
      if (!IS_DEVELOPMENT || RCLONE_DISABLE_MOCK) {
        await execPromise(getRcloneCommand(`copy "${safeArchive}" "${remotePath}"`), {
          timeout: 1800000,
        });
      } else {
        appendLog(`[MOCK] Simulated rclone copy to ${remotePath}`);
      }
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
      sendTelegramMessage(tg.botToken, tg.chatId, msg).catch(() => { });
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
      sendTelegramMessage(tg.botToken, tg.chatId, msg).catch(() => { });
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
  if (IS_DEVELOPMENT) {
    appendLog("[MOCK] Skipping retention check (development mode)");
    return;
  }
  const cutoff = Date.now() - days * 86400 * 1000;

  for (const remote of remotes) {
    validateRemoteName(remote.name);
    const safeFolder = shellEscapePath(remote.folder || "");
    const remotePath = `${remote.name}:${safeFolder}`;
    appendLog(`Applying retention (${days} days) on ${remotePath}`);
    try {
      const output = await execPromise(getRcloneCommand(`lsjson "${remotePath}"`), {
        timeout: 60000,
      });
      const files = JSON.parse(output || "[]");
      for (const file of files) {
        if (!file.IsDir && new Date(file.ModTime).getTime() < cutoff) {
          // file.Path comes from rclone JSON output — escape before use in shell
          const safeFilePath = shellEscapePath(`${remote.name}:${remote.folder || ""}/${file.Path}`);
          appendLog(`Deleting old backup: ${safeFilePath}`);
          await execPromise(getRcloneCommand(`deletefile "${safeFilePath}"`), {
            timeout: 30000,
          }).catch((e) =>
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

  if (type === "Dropbox" || type === "dropbox") {
    try {
      if (credentials && credentials.token) {
        validateDropboxToken(credentials.token);
      } else {
        return res.status(400).json({ error: "Dropbox token (JSON) is required." });
      }
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
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

  // Write rclone config if not in development OR if mocking is disabled
  if (!IS_DEVELOPMENT || RCLONE_DISABLE_MOCK) {
    try {
      writeRcloneConfig(entry);
    } catch (e) {
      appendLog(`Warning: could not write rclone config for ${name}: ${e.message}`);
      return res.status(500).json({ error: `Failed to write rclone config: ${e.message}` });
    }
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
  exec(getRcloneCommand(`config delete "${name}"`), () => { });

  res.json({ message: `Remote "${name}" deleted.` });
});

// ── Remotes – test ────────────────────────────────────────────────────────────
app.post("/api/config/remote/:name/test", async (req, res) => {
  const { name } = req.params;
  try { validateRemoteName(name); } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const logs = [];
  try {
    const settings = loadSettings();
    const remote = (settings.remotes || []).find((r) => r.name === name);
    if (!remote) return res.status(404).json({ error: "Remote not found." });

    logs.push(`🔍 Testing remote: ${name} (${remote.type})`);

    // Step 1: List directory
    logs.push("→ Step 1/2: Checking connection (lsd)...");
    const lsdOut = await execPromise(getRcloneCommand(`lsd "${name}:" --max-depth 1`));
    logs.push(`✓ Connection OK. Console:\n${lsdOut || "(none)"}`);

    // Step 2: Write test file
    const targetFolder = remote.folder || "";
    const testFile = targetFolder ? `${targetFolder}/rei_warden_test.txt` : `rei_warden_test.txt`;
    logs.push(`→ Step 2/2: Verifying write access (rcat to ${testFile})...`);

    const testMsg = `Rei-Warden write test at ${new Date().toLocaleString()}`;
    // Simple echo pipe. rclone rcat reads from stdin.
    const rcatCmd = `echo "${testMsg.replace(/"/g, "")}" | ${getRcloneCommand(`rcat "${name}:${testFile}"`)}`;

    const rcatOut = await execPromise(rcatCmd);
    logs.push(`✓ Write test OK. Console:\n${rcatOut || "(none)"}`);

    res.json({
      success: true,
      message: `Full connection and write test to "${name}" successful.`,
      console: logs.join("\n"),
    });
  } catch (e) {
    const cmdUsed = getRcloneCommand("...");
    logs.push(`❌ Test failed: ${e.message}`);
    logs.push(`💡 Tip: Ensure RCLONE_EXE in .env is correct.`);
    logs.push(`🛠️ Command attempt prefix: ${cmdUsed.split(' --config')[0]}`);
    res.status(422).json({
      success: false,
      error: e.message,
      console: logs.join("\n"),
    });
  }
});

// ── Remotes – list folders ────────────────────────────────────────────────────
app.get("/api/config/remote/:name/folders", async (req, res) => {
  const { name } = req.params;
  try { validateRemoteName(name); } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  try {
    const output = await execPromise(getRcloneCommand(`lsd "${name}:" --max-depth 1`), {
      timeout: 30000,
    });
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

function convertCredentialsForRclone(remote) {
  const creds = remote.credentials || {};
  const rcloneConfig = {};

  if (remote.type === "Dropbox" || remote.type === "dropbox") {
    if (creds.token) rcloneConfig.token = creds.token;
  } else if (remote.type === "Google Drive") {
    if (creds.clientId) rcloneConfig.client_id = creds.clientId;
    if (creds.clientSecret) rcloneConfig.client_secret = creds.clientSecret;
    if (creds.token) rcloneConfig.token = creds.token;
  } else if (remote.type === "OneDrive") {
    if (creds.clientId) rcloneConfig.client_id = creds.clientId;
    if (creds.clientSecret) rcloneConfig.client_secret = creds.clientSecret;
    if (creds.token) rcloneConfig.token = creds.token;
    if (creds.tenant) rcloneConfig.tenant = creds.tenant;
  }

  return rcloneConfig;
}

// ── rclone config writer ──────────────────────────────────────────────────────
function writeRcloneConfig(remote) {
  validateRemoteName(remote.name);

  let rcloneType = remote.type;
  if (rcloneType === "Dropbox" || rcloneType === "dropbox") {
    rcloneType = "dropbox";
  } else if (rcloneType === "Google Drive") {
    rcloneType = "drive";
  } else if (rcloneType === "OneDrive") {
    rcloneType = "onedrive";
  }

  const rcloneConfig = convertCredentialsForRclone(remote);

  let config = `[${remote.name}]\ntype = ${rcloneType}\n`;
  for (const [k, v] of Object.entries(rcloneConfig)) {
    const safeKey = String(k).replace(/[\r\n=]/g, "");
    const safeVal = String(v).replace(/[\r\n]/g, "");
    if (safeKey) config += `${safeKey} = ${safeVal}\n`;
  }

  ensureDir(path.dirname(RCLONE_CONFIG_FILE));
  let existing = "";
  try {
    if (fs.existsSync(RCLONE_CONFIG_FILE)) {
      existing = fs.readFileSync(RCLONE_CONFIG_FILE, "utf8");
    }
  } catch (e) {
    appendLog(`Warning: could not read rclone config: ${e.message}`);
  }

  const sectionHeader = `[${remote.name}]`;
  const sectionBody = `${sectionHeader}\n${config.split("\n").slice(1).join("\n")}`.trimEnd() + "\n";
  const sectionRegex = new RegExp(`^\\[${escapeRegExp(remote.name)}\\][\\s\\S]*?(?=^\\[|\\s*$)`, "m");
  let updated = "";
  if (sectionRegex.test(existing)) {
    updated = existing.replace(sectionRegex, sectionBody).trimEnd() + "\n";
  } else {
    updated = existing.trimEnd();
    updated = (updated ? `${updated}\n\n` : "") + sectionBody;
  }

  try {
    fs.writeFileSync(RCLONE_CONFIG_FILE, updated, { mode: 0o600 });
  } catch (e) {
    if (e.code === 'EACCES' && !IS_DEVELOPMENT) {
      throw new Error(`Permission denied writing rclone config to ${RCLONE_CONFIG_FILE}. Set NODE_ENV=development for local testing with mock rclone.`);
    }
    throw new Error(`Failed to write rclone config: ${e.message}`);
  }
}

function syncRemotesOnStartup() {
  try {
    const DISABLE_MOCK = String(process.env.RCLONE_DISABLE_MOCK).trim().toLowerCase() === "true";
    if (IS_DEVELOPMENT && !DISABLE_MOCK) {
      appendLog("[MOCK] Skipping rclone config sync (development mode)");
    } else {
      appendLog("Syncing remotes from settings to rclone.conf...");
      const settings = loadSettings();
      const remotes = settings.remotes || [];
      for (const remote of remotes) {
        try {
          writeRcloneConfig(remote);
          appendLog(`Synced remote: ${remote.name}`);
        } catch (e) {
          appendLog(`Warning: could not sync remote ${remote.name}: ${e.message}`);
        }
      }
    }
  } catch (e) {
    appendLog(`Warning: could not sync remotes: ${e.message}`);
  }
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
  const errorMsg = err.message || "Unknown error";
  appendLog(`Unhandled error: ${errorMsg}`);
  if (IS_DEVELOPMENT) {
    console.error("Error details:", err);
  }
  res.status(500).json({
    error: IS_DEVELOPMENT ? `Internal server error: ${errorMsg}` : "Internal server error.",
    ...(IS_DEVELOPMENT && { stack: err.stack }),
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Rei-Warden backend listening on port ${PORT}`);
  appendLog(`Server started on port ${PORT}`);

  syncRemotesOnStartup();

  const settings = loadSettings();
  if (settings.retention && settings.retention.cron) {
    applySchedule(settings.retention.cron);
  }
});

module.exports = app;
