const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { authRequired } = require("../middleware/auth");
const { saveCompressedImageFromBuffer } = require("../imageProcessing");

const router = express.Router();

const uploadRoot = path.join(__dirname, "..", "uploads");

if (!fs.existsSync(uploadRoot)) {
  fs.mkdirSync(uploadRoot, { recursive: true });
}

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
const allowedImageExtensions = new Set([
  ".gif",
  ".heic",
  ".heif",
  ".jpeg",
  ".jpg",
  ".png",
  ".webp",
]);

const maxUploadBytes = 8 * 1024 * 1024;
const maxUploadFiles = 5;

function isVideoFile(file) {
  const extension = path.extname(file.originalname || "").toLowerCase();

  return (
    file.mimetype?.startsWith("video/") ||
    blockedVideoExtensions.has(extension)
  );
}

function isImageFile(file) {
  const extension = path.extname(file.originalname || "").toLowerCase();

  return (
    file.mimetype?.startsWith("image/") ||
    allowedImageExtensions.has(extension)
  );
}

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: maxUploadBytes,
    files: maxUploadFiles,
    fields: 20,
  },

  fileFilter: (_, file, cb) => {
    if (isVideoFile(file)) {
      const error = new multer.MulterError(
        "LIMIT_UNEXPECTED_FILE",
        file.fieldname
      );

      error.message =
        "Video files are not allowed. Please upload photos only.";

      return cb(error);
    }

    if (!isImageFile(file)) {
      const error = new multer.MulterError(
        "LIMIT_UNEXPECTED_FILE",
        file.fieldname
      );

      error.message = "Only image files can be uploaded.";

      return cb(error);
    }

    return cb(null, true);
  },
});

router.post(
  "/",
  authRequired,

  (req, res, next) => {
    upload.array("photos", maxUploadFiles)(req, res, (error) => {
      if (!error) {
        return next();
      }

      if (error.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          message: "Each photo must be smaller than 8 MB.",
        });
      }

      if (error.code === "LIMIT_FILE_COUNT") {
        return res.status(400).json({
          message: `A maximum of ${maxUploadFiles} photos can be uploaded at once.`,
        });
      }

      return res.status(400).json({
        message: error.message || "File upload failed.",
      });
    });
  },

  async (req, res, next) => {
    const orgSegment = req.user?.organizationId
      ? `org-${req.user.organizationId}`
      : "platform";

    const uploadDir = path.join(uploadRoot, orgSegment);

    try {
      const uploadedFiles = req.files || [];

      if (uploadedFiles.length === 0) {
        return res.status(400).json({
          message: "Please select at least one photo.",
        });
      }

      const files = [];

      // Fotoğrafları aynı anda değil, sırayla işle.
      for (const file of uploadedFiles) {
        const fileName = await saveCompressedImageFromBuffer(
          file.buffer,
          uploadDir,
          file.originalname
        );

        files.push(`/uploads/${orgSegment}/${fileName}`);

        // Buffer referansını mümkün olduğunca erken bırak.
        file.buffer = null;
      }

      return res.json({ files });
    } catch (error) {
      return next(error);
    }
  }
);

module.exports = router;
