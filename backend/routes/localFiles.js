const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { authRequired } = require("../middleware/auth");
const { saveCompressedImageFromFile } = require("../imageProcessing");

const router = express.Router();

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif"]);
const SPREADSHEET_EXTENSIONS = new Set([".xlsx", ".csv"]);
const MAX_FILE_BYTES = 50 * 1024 * 1024;

const uploadRoot = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadRoot)) fs.mkdirSync(uploadRoot, { recursive: true });

function allowedRoots() {
  const home = os.homedir();
  return ["Desktop", "Downloads", "Documents", "Pictures"]
    .map((name) => path.join(home, name))
    .filter((root) => fs.existsSync(root));
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function resolveAllowedPath(candidatePath) {
  const resolvedPath = fs.realpathSync(candidatePath);
  const matchingRoot = allowedRoots()
    .map((root) => fs.realpathSync(root))
    .find((root) => resolvedPath === root || isInside(root, resolvedPath));

  if (!matchingRoot) return null;
  return resolvedPath;
}

function getKind(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (SPREADSHEET_EXTENSIONS.has(extension)) return "spreadsheet";
  return "other";
}

function listFilesInRoot(root) {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const filePath = path.join(root, entry.name);
      const stats = fs.statSync(filePath);
      return {
        name: entry.name,
        path: filePath,
        folder: path.basename(root),
        kind: getKind(filePath),
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
      };
    });
}

router.get("/", authRequired, (req, res, next) => {
  try {
    const requestedKind = String(req.query.kind || "all");
    const allowedKinds = new Set(["all", "image", "spreadsheet"]);
    const kind = allowedKinds.has(requestedKind) ? requestedKind : "all";

    const files = allowedRoots()
      .flatMap(listFilesInRoot)
      .filter((file) => file.kind !== "other")
      .filter((file) => kind === "all" || file.kind === kind)
      .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime())
      .slice(0, 200);

    res.json({ files });
  } catch (error) {
    next(error);
  }
});

router.get("/file", authRequired, (req, res, next) => {
  try {
    const requestedPath = String(req.query.path || "");
    const safePath = resolveAllowedPath(requestedPath);
    if (!safePath) return res.status(400).json({ message: "File is outside allowed folders" });

    const stats = fs.statSync(safePath);
    if (!stats.isFile()) return res.status(400).json({ message: "Not a file" });
    if (stats.size > MAX_FILE_BYTES) return res.status(400).json({ message: "File is too large" });

    const kind = getKind(safePath);
    if (kind === "other") return res.status(400).json({ message: "Unsupported file type" });

    res.download(safePath);
  } catch (error) {
    next(error);
  }
});

router.post("/upload", authRequired, express.json(), async (req, res, next) => {
  try {
    const requestedPath = String(req.body?.path || "");
    const safePath = resolveAllowedPath(requestedPath);
    if (!safePath) return res.status(400).json({ message: "File is outside allowed folders" });

    const stats = fs.statSync(safePath);
    if (!stats.isFile()) return res.status(400).json({ message: "Not a file" });
    if (stats.size > MAX_FILE_BYTES) return res.status(400).json({ message: "File is too large" });
    if (getKind(safePath) !== "image") {
      return res.status(400).json({ message: "Only images can be copied to uploads" });
    }

    const orgSegment = req.user?.organizationId ? `org-${req.user.organizationId}` : "platform";
    const uploadDir = path.join(uploadRoot, orgSegment);
    const fileName = await saveCompressedImageFromFile(safePath, uploadDir);

    res.json({ files: [`/uploads/${orgSegment}/${fileName}`] });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
