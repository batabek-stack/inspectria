const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { authRequired } = require("../middleware/auth");
const { saveCompressedImageFromBuffer } = require("../imageProcessing");

const router = express.Router();

const uploadRoot = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadRoot)) fs.mkdirSync(uploadRoot, { recursive: true });

const blockedVideoExtensions = new Set([
  ".avi",
  ".m4v",
  ".mkv",
  ".mov",
  ".mp4",
  ".mpeg",
  ".mpg",
  ".webm",
  ".wmv",
]);
const allowedImageExtensions = new Set([".gif", ".heic", ".heif", ".jpeg", ".jpg", ".png", ".webp"]);
const maxUploadBytes = 25 * 1024 * 1024;

function isVideoFile(file) {
  const extension = path.extname(file.originalname || "").toLowerCase();
  return file.mimetype?.startsWith("video/") || blockedVideoExtensions.has(extension);
}

function isImageFile(file) {
  const extension = path.extname(file.originalname || "").toLowerCase();
  return file.mimetype?.startsWith("image/") || allowedImageExtensions.has(extension);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxUploadBytes,
    files: 10,
  },
  fileFilter: (_, file, cb) => {
    if (isVideoFile(file)) {
      const error = new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname);
      error.message = "Video files are not allowed. Please upload photos only.";
      return cb(error);
    }

    if (!isImageFile(file)) {
      const error = new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname);
      error.message = "Only image files can be uploaded.";
      return cb(error);
    }

    return cb(null, true);
  },
});

router.post("/", authRequired, (req, res, next) => {
  upload.array("photos", 10)(req, res, (error) => {
    if (error) {
      return res.status(400).json({ message: error.message || "File upload failed" });
    }

    return next();
  });
}, async (req, res, next) => {
  const orgSegment = req.user?.organizationId
    ? `org-${req.user.organizationId}`
    : "platform";
  const uploadDir = path.join(uploadRoot, orgSegment);

  try {
    const files = await Promise.all(
      (req.files || []).map(async (file) => {
        const fileName = await saveCompressedImageFromBuffer(
          file.buffer,
          uploadDir,
          file.originalname
        );
        return `/uploads/${orgSegment}/${fileName}`;
      })
    );

    res.json({ files });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
