const fs = require("fs");
const path = require("path");
const db = require("../db");

const uploadRoot = path.join(__dirname, "..", "uploads");
const temporaryFileAgeMs = Number(process.env.UPLOAD_TEMP_MAX_AGE_HOURS || 24) * 60 * 60 * 1000;

function walkFiles(root) {
  if (!fs.existsSync(root)) return [];

  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) return walkFiles(entryPath);
    if (entry.isFile()) return [entryPath];
    return [];
  });
}

function uploadUrlFromFile(filePath) {
  const relative = path.relative(uploadRoot, filePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return `/uploads/${relative.split(path.sep).join("/")}`;
}

function filePathFromUploadUrl(uploadUrl) {
  if (!uploadUrl || typeof uploadUrl !== "string") return null;
  if (!uploadUrl.startsWith("/uploads/")) return null;

  const relative = uploadUrl.replace(/^\/uploads\//, "");
  const resolved = path.resolve(uploadRoot, relative);
  const root = path.resolve(uploadRoot);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
  return resolved;
}

function collectUploadUrls(value, urls = new Set()) {
  if (!value) return urls;

  if (typeof value === "string") {
    if (value.startsWith("/uploads/")) urls.add(value);
    return urls;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectUploadUrls(item, urls));
    return urls;
  }

  if (typeof value === "object") {
    Object.values(value).forEach((item) => collectUploadUrls(item, urls));
  }

  return urls;
}

async function referencedUploadUrls() {
  const referenced = new Set();

  const reportPhotos = await db.many("SELECT file_path FROM report_photos");
  reportPhotos.forEach((row) => collectUploadUrls(row.file_path, referenced));

  const walkthroughPhotos = await db.many("SELECT file_path FROM walkthrough_photos");
  walkthroughPhotos.forEach((row) => collectUploadUrls(row.file_path, referenced));

  const checklistImages = await db.many(
    "SELECT image_path FROM checklists WHERE image_path LIKE '/uploads/%'"
  );
  checklistImages.forEach((row) => collectUploadUrls(row.image_path, referenced));

  const drafts = await db.many("SELECT form_json FROM draft_reports");
  drafts.forEach((row) => {
    try {
      collectUploadUrls(JSON.parse(row.form_json || "{}"), referenced);
    } catch {
      // Ignore malformed legacy drafts; they should not block cleanup forever.
    }
  });

  return referenced;
}

async function ensureCleanupQueueTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS upload_cleanup_queue (
      id SERIAL PRIMARY KEY,
      file_path TEXT NOT NULL,
      reason TEXT NOT NULL,
      delete_after TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ,
      UNIQUE (file_path, reason)
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_upload_cleanup_queue_delete_after
      ON upload_cleanup_queue(delete_after)
      WHERE processed_at IS NULL
  `);
}

async function protectedQueuedUploadUrls() {
  const rows = await db.many(
    `
    SELECT file_path
    FROM upload_cleanup_queue
    WHERE processed_at IS NULL
      AND delete_after > NOW()
  `
  );
  return new Set(rows.map((row) => row.file_path));
}

async function deleteFile(filePath, dryRun) {
  if (dryRun) return true;

  try {
    await fs.promises.unlink(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return true;
    throw error;
  }
}

async function cleanupDeletedReportFiles(referenced, dryRun) {
  const rows = await db.many(
    `
    SELECT id, file_path
    FROM upload_cleanup_queue
    WHERE processed_at IS NULL
      AND delete_after <= NOW()
  `
  );

  let deleted = 0;
  for (const row of rows) {
    if (referenced.has(row.file_path)) continue;

    const filePath = filePathFromUploadUrl(row.file_path);
    if (!filePath) continue;

    await deleteFile(filePath, dryRun);
    deleted += 1;

    if (!dryRun) {
      await db.query("UPDATE upload_cleanup_queue SET processed_at = NOW() WHERE id = $1", [
        row.id,
      ]);
    }
  }

  return deleted;
}

async function cleanupTemporaryFiles(referenced, protectedQueued, dryRun) {
  const cutoff = Date.now() - temporaryFileAgeMs;
  let deleted = 0;

  for (const filePath of walkFiles(uploadRoot)) {
    const uploadUrl = uploadUrlFromFile(filePath);
    if (!uploadUrl) continue;
    if (referenced.has(uploadUrl) || protectedQueued.has(uploadUrl)) continue;

    const stats = fs.statSync(filePath);
    if (stats.mtimeMs > cutoff) continue;

    await deleteFile(filePath, dryRun);
    deleted += 1;
  }

  return deleted;
}

async function removeEmptyDirectories(root) {
  if (!fs.existsSync(root)) return;

  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) await removeEmptyDirectories(path.join(root, entry.name));
  }

  if (root !== uploadRoot && fs.readdirSync(root).length === 0) {
    await fs.promises.rmdir(root);
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  await ensureCleanupQueueTable();

  const referenced = await referencedUploadUrls();
  const protectedQueued = await protectedQueuedUploadUrls();

  const deletedReportFiles = await cleanupDeletedReportFiles(referenced, dryRun);
  const temporaryFiles = await cleanupTemporaryFiles(referenced, protectedQueued, dryRun);

  if (!dryRun) await removeEmptyDirectories(uploadRoot);

  console.log(
    JSON.stringify({
      dryRun,
      deletedReportFiles,
      temporaryFiles,
      referencedFiles: referenced.size,
      protectedQueuedFiles: protectedQueued.size,
    })
  );
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}
