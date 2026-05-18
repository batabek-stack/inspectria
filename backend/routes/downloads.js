const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");

const router = express.Router();
const downloadDir = path.join(__dirname, "..", "generated-downloads");
const maxAgeMs = 6 * 60 * 60 * 1000;

const allowedMimeTypes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

function ensureDownloadDir() {
  fs.mkdirSync(downloadDir, { recursive: true });
}

function cleanupOldDownloads() {
  ensureDownloadDir();
  const now = Date.now();

  fs.readdir(downloadDir, (err, files) => {
    if (err) return;

    files.forEach((file) => {
      const fullPath = path.join(downloadDir, file);
      fs.stat(fullPath, (statErr, stat) => {
        if (!statErr && now - stat.mtimeMs > maxAgeMs) {
          fs.unlink(fullPath, () => {});
        }
      });
    });
  });
}

function sanitizeFileName(value) {
  const fallback = "inspectria-download";
  const clean = String(value || fallback)
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 160);
  return clean || fallback;
}

function extensionForMimeType(mimeType) {
  if (mimeType === "application/pdf") return ".pdf";
  if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    return ".xlsx";
  }
  return "";
}

function publicUrl(req, id, fileName) {
  return `${req.protocol}://${req.get("host")}/api/downloads/${id}/${encodeURIComponent(fileName)}`;
}

router.post("/", (req, res) => {
  cleanupOldDownloads();

  const { fileName, mimeType, base64 } = req.body || {};
  if (!fileName || !mimeType || !base64) {
    return res.status(400).json({ message: "fileName, mimeType and base64 are required" });
  }

  if (!allowedMimeTypes.has(mimeType)) {
    return res.status(400).json({ message: "Unsupported download file type" });
  }

  let buffer;
  try {
    buffer = Buffer.from(String(base64), "base64");
  } catch {
    return res.status(400).json({ message: "Invalid file data" });
  }

  if (!buffer.length || buffer.length > 25 * 1024 * 1024) {
    return res.status(400).json({ message: "Download file is empty or too large" });
  }

  ensureDownloadDir();
  const id = crypto.randomUUID();
  const safeFileName = sanitizeFileName(fileName);
  const ext = extensionForMimeType(mimeType);
  const storedName = `${id}${ext}`;
  const metaName = `${id}.json`;

  fs.writeFileSync(path.join(downloadDir, storedName), buffer);
  fs.writeFileSync(
    path.join(downloadDir, metaName),
    JSON.stringify({
      fileName: safeFileName.endsWith(ext) ? safeFileName : `${safeFileName}${ext}`,
      mimeType,
      storedName,
      createdAt: new Date().toISOString(),
    })
  );

  const downloadFileName = safeFileName.endsWith(ext) ? safeFileName : `${safeFileName}${ext}`;

  return res.json({
    id,
    url: publicUrl(req, id, downloadFileName),
    fileName: downloadFileName,
  });
});

router.get("/:id/:fileName?", (req, res) => {
  const id = String(req.params.id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return res.status(404).json({ message: "Download not found" });
  }

  const metaPath = path.join(downloadDir, `${id}.json`);
  if (!fs.existsSync(metaPath)) {
    return res.status(404).json({ message: "Download expired or not found" });
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  const filePath = path.join(downloadDir, meta.storedName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: "Download expired or not found" });
  }

  const downloadName = sanitizeFileName(meta.fileName);
  const shouldPreviewPdf = meta.mimeType === "application/pdf" && req.query.view === "1";
  res.setHeader("Content-Type", meta.mimeType);
  res.setHeader(
    "Content-Disposition",
    `${shouldPreviewPdf ? "inline" : "attachment"}; filename="${downloadName}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`
  );
  res.setHeader("Cache-Control", "no-store");
  return res.sendFile(filePath);
});

module.exports = router;
