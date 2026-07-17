const express = require("express");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const crypto = require("crypto");
const db = require("../db");
const { authRequired } = require("../middleware/auth");

const router = express.Router();

const appRoot = path.join(__dirname, "..", "..");
const backendRoot = path.join(__dirname, "..");
const backupRoot = path.join(backendRoot, "backups", "maintenance");
const uploadsRoot = path.join(backendRoot, "uploads");
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS || 14);

let activeJob = null;

function platformAdminOnly(req, res, next) {
  if (!req.user || req.user.role !== "platform_admin") {
    return res.status(403).json({ message: "Platform admin access required" });
  }
  next();
}

function databaseUrl() {
  return process.env.DATABASE_URL || "postgres://inspectra:inspectra@localhost:5432/inspectra";
}

function postgresEnv() {
  const env = { ...process.env };
  if (!process.env.PGSSLMODE && !String(databaseUrl()).includes("sslmode=")) {
    delete env.PGSSLMODE;
  }
  return env;
}

function bundledPgTool(name) {
  return path.join(appRoot, ".local-tools", "Postgres.app", "Contents", "Versions", "16", "bin", name);
}

function resolveTool(envName, toolName) {
  const configured = process.env[envName];
  if (configured) return configured;

  const bundled = bundledPgTool(toolName);
  if (fs.existsSync(bundled)) return bundled;

  return toolName;
}

function runFile(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        return reject(error);
      }

      resolve({ stdout, stderr });
    });
  });
}

function ensureBackupRoot() {
  fs.mkdirSync(backupRoot, { recursive: true });
}

function safeBackupId(value) {
  const id = String(value || "");
  if (!/^inspectria-backup-\d{8}-\d{6}(?:-[a-z0-9-]+)?$/.test(id)) return "";
  return id;
}

function backupPath(id) {
  const safeId = safeBackupId(id);
  if (!safeId) return "";
  return path.join(backupRoot, safeId);
}

function backupArchivePath(id) {
  const safeId = safeBackupId(id);
  if (!safeId) return "";
  return path.join(backupRoot, `${safeId}.tar.gz`);
}

function timestampId(suffix = "") {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
  return `inspectria-backup-${stamp}${suffix}`;
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function pathSize(targetPath) {
  const stat = await fs.promises.stat(targetPath);
  if (!stat.isDirectory()) return stat.size;

  const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });
  const sizes = await Promise.all(
    entries.map((entry) => pathSize(path.join(targetPath, entry.name)))
  );
  return sizes.reduce((total, size) => total + size, 0);
}

async function copyUploads(targetDir) {
  if (!fs.existsSync(uploadsRoot)) {
    await fs.promises.mkdir(targetDir, { recursive: true });
    return 0;
  }

  await fs.promises.cp(uploadsRoot, targetDir, { recursive: true });
  return pathSize(targetDir);
}

async function writeManifest(dir, manifest) {
  await fs.promises.writeFile(
    path.join(dir, "manifest.json"),
    JSON.stringify(manifest, null, 2)
  );
}

async function readManifest(dir) {
  const raw = await fs.promises.readFile(path.join(dir, "manifest.json"), "utf8");
  return JSON.parse(raw);
}

async function getTableCounts() {
  const tables = [
    "organizations",
    "users",
    "checklists",
    "assignments",
    "reports",
    "report_items",
    "report_photos",
    "walkthroughs",
    "walkthrough_photos",
  ];
  const counts = {};

  for (const table of tables) {
    const result = await db.one(`SELECT count(*)::int AS count FROM ${table}`);
    counts[table] = result?.count || 0;
  }

  return counts;
}

async function cleanupRetention() {
  ensureBackupRoot();
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const entries = await fs.promises.readdir(backupRoot, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || !safeBackupId(entry.name)) continue;
    const dir = path.join(backupRoot, entry.name);
    let manifest = null;
    try {
      manifest = await readManifest(dir);
    } catch {
      continue;
    }

    const createdAt = new Date(manifest.createdAt || 0).getTime();
    if (createdAt && createdAt < cutoff) {
      await fs.promises.rm(dir, { recursive: true, force: true });
      const archive = backupArchivePath(entry.name);
      if (archive) await fs.promises.rm(archive, { force: true });
    }
  }
}

async function createBackup({ createdBy, reason = "manual" }) {
  await cleanupRetention();

  const id = timestampId(reason === "pre-restore" ? "-pre-restore" : "");
  const dir = path.join(backupRoot, id);
  const dbDumpPath = path.join(dir, "db.dump");
  const uploadsDir = path.join(dir, "uploads");
  const pgDump = resolveTool("PG_DUMP_PATH", "pg_dump");

  await fs.promises.mkdir(dir, { recursive: true });

  const manifest = {
    id,
    reason,
    status: "running",
    createdAt: new Date().toISOString(),
    createdByUserId: createdBy?.id || null,
    createdByUsername: createdBy?.username || "",
    retentionDays,
    files: {
      dbDump: "db.dump",
      uploads: "uploads",
    },
  };
  await writeManifest(dir, manifest);

  try {
    await runFile(pgDump, [databaseUrl(), "-F", "c", "-f", dbDumpPath], {
      env: postgresEnv(),
      cwd: appRoot,
      maxBuffer: 1024 * 1024 * 10,
    });

    const [dbBytes, uploadBytes, tableCounts] = await Promise.all([
      pathSize(dbDumpPath),
      copyUploads(uploadsDir),
      getTableCounts(),
    ]);

    manifest.status = "completed";
    manifest.completedAt = new Date().toISOString();
    manifest.bytes = dbBytes + uploadBytes;
    manifest.dbBytes = dbBytes;
    manifest.uploadBytes = uploadBytes;
    manifest.tableCounts = tableCounts;
    manifest.sha256 = {
      dbDump: await sha256File(dbDumpPath),
    };

    await writeManifest(dir, manifest);
    return manifest;
  } catch (error) {
    manifest.status = "failed";
    manifest.completedAt = new Date().toISOString();
    manifest.error = error.stderr || error.message || "Backup failed";
    await writeManifest(dir, manifest);
    throw error;
  }
}

async function listBackups() {
  ensureBackupRoot();
  await cleanupRetention();

  const entries = await fs.promises.readdir(backupRoot, { withFileTypes: true });
  const backups = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !safeBackupId(entry.name)) continue;
    const dir = path.join(backupRoot, entry.name);
    try {
      const manifest = await readManifest(dir);
      backups.push({
        id: manifest.id || entry.name,
        reason: manifest.reason || "manual",
        status: manifest.status || "unknown",
        createdAt: manifest.createdAt || "",
        completedAt: manifest.completedAt || "",
        createdByUsername: manifest.createdByUsername || "",
        bytes: manifest.bytes || 0,
        dbBytes: manifest.dbBytes || 0,
        uploadBytes: manifest.uploadBytes || 0,
        tableCounts: manifest.tableCounts || {},
        error: manifest.error || "",
      });
    } catch {
      backups.push({
        id: entry.name,
        reason: "unknown",
        status: "unreadable",
        createdAt: "",
        completedAt: "",
        createdByUsername: "",
        bytes: 0,
        dbBytes: 0,
        uploadBytes: 0,
        tableCounts: {},
        error: "Manifest could not be read",
      });
    }
  }

  return backups.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function restoreBackup(id, user) {
  const dir = backupPath(id);
  if (!dir || !fs.existsSync(dir)) {
    const error = new Error("Backup not found");
    error.statusCode = 404;
    throw error;
  }

  const manifest = await readManifest(dir);
  if (manifest.status !== "completed") {
    const error = new Error("Only completed backups can be restored");
    error.statusCode = 400;
    throw error;
  }

  const dbDumpPath = path.join(dir, "db.dump");
  const uploadsDir = path.join(dir, "uploads");
  if (!fs.existsSync(dbDumpPath)) {
    const error = new Error("Backup database dump is missing");
    error.statusCode = 400;
    throw error;
  }

  const safetyBackup = await createBackup({ createdBy: user, reason: "pre-restore" });
  const pgRestore = resolveTool("PG_RESTORE_PATH", "pg_restore");

  await runFile(
    pgRestore,
    ["--clean", "--if-exists", "--no-owner", "--no-acl", "-d", databaseUrl(), dbDumpPath],
    {
      env: postgresEnv(),
      cwd: appRoot,
      maxBuffer: 1024 * 1024 * 10,
    }
  );

  if (fs.existsSync(uploadsDir)) {
    await fs.promises.rm(uploadsRoot, { recursive: true, force: true });
    await fs.promises.mkdir(path.dirname(uploadsRoot), { recursive: true });
    await fs.promises.cp(uploadsDir, uploadsRoot, { recursive: true });
  }

  return {
    restoredBackup: manifest,
    safetyBackup,
  };
}

async function createBackupArchive(id) {
  const dir = backupPath(id);
  const archive = backupArchivePath(id);
  if (!dir || !archive || !fs.existsSync(dir)) {
    const error = new Error("Backup not found");
    error.statusCode = 404;
    throw error;
  }

  const manifest = await readManifest(dir);
  if (manifest.status !== "completed") {
    const error = new Error("Only completed backups can be downloaded");
    error.statusCode = 400;
    throw error;
  }

  const dirStat = await fs.promises.stat(dir);
  if (fs.existsSync(archive)) {
    const archiveStat = await fs.promises.stat(archive);
    if (archiveStat.mtimeMs >= dirStat.mtimeMs) return archive;
  }

  const tempArchive = `${archive}.${process.pid}.tmp`;
  await fs.promises.rm(tempArchive, { force: true });
  await runFile("tar", ["-czf", tempArchive, "-C", backupRoot, id], {
    cwd: backupRoot,
    maxBuffer: 1024 * 1024 * 10,
  });
  await fs.promises.rename(tempArchive, archive);

  return archive;
}

function withBackupLock(handler) {
  return async (req, res, next) => {
    if (activeJob) {
      return res.status(409).json({ message: `${activeJob} is already running` });
    }

    activeJob = req.method === "POST" && req.params.id ? "Restore" : "Backup";
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    } finally {
      activeJob = null;
    }
  };
}

router.get("/backups", authRequired, platformAdminOnly, async (_, res, next) => {
  try {
    res.json({
      retentionDays,
      activeJob,
      backups: await listBackups(),
    });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/backups",
  authRequired,
  platformAdminOnly,
  withBackupLock(async (req, res) => {
    const backup = await createBackup({ createdBy: req.user, reason: "manual" });
    res.json({ success: true, backup, backups: await listBackups() });
  })
);

router.post(
  "/backups/:id/restore",
  authRequired,
  platformAdminOnly,
  withBackupLock(async (req, res) => {
    const result = await restoreBackup(req.params.id, req.user);
    res.json({ success: true, ...result, backups: await listBackups() });
  })
);

router.get("/backups/:id/download", authRequired, platformAdminOnly, async (req, res, next) => {
  try {
    const safeId = safeBackupId(req.params.id);
    if (!safeId) return res.status(404).json({ message: "Backup not found" });

    const archive = await createBackupArchive(safeId);
    res.download(archive, `${safeId}.tar.gz`);
  } catch (error) {
    next(error);
  }
});

router.delete("/backups/:id", authRequired, platformAdminOnly, async (req, res, next) => {
  try {
    const dir = backupPath(req.params.id);
    if (!dir || !fs.existsSync(dir)) {
      return res.status(404).json({ message: "Backup not found" });
    }

    await fs.promises.rm(dir, { recursive: true, force: true });
    const archive = backupArchivePath(req.params.id);
    if (archive) await fs.promises.rm(archive, { force: true });
    res.json({ success: true, backups: await listBackups() });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
