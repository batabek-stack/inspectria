const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const db = require("../db");
const { authRequired } = require("../middleware/auth");
const { saveCompressedImageFromFileWithDataUrl } = require("../imageProcessing");

const router = express.Router();

const uploadRoot = path.join(__dirname, "..", "uploads");
const uploadTempRoot = path.join(os.tmpdir(), "inspectria-upload-temp");

if (!fs.existsSync(uploadRoot)) {
  fs.mkdirSync(uploadRoot, { recursive: true });
}

if (!fs.existsSync(uploadTempRoot)) {
  fs.mkdirSync(uploadTempRoot, { recursive: true });
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

function tempUploadName(_, file, cb) {
  const extension = path.extname(file.originalname || "").toLowerCase();
  const random = crypto.randomBytes(12).toString("hex");
  cb(null, `${Date.now()}-${random}${extension}`);
}

async function removeTempFile(file) {
  if (!file?.path) return;

  try {
    await fs.promises.unlink(file.path);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`Could not remove temporary upload ${file.path}:`, error);
    }
  }
}

async function cleanupTempFiles(files = []) {
  await Promise.all(files.map((file) => removeTempFile(file)));
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => {
      fs.mkdir(uploadTempRoot, { recursive: true }, (error) => {
        cb(error, uploadTempRoot);
      });
    },
    filename: tempUploadName,
  }),

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
    upload.array("photos", maxUploadFiles)(req, res, async (error) => {
      if (!error) {
        return next();
      }

      await cleanupTempFiles(req.files || []);

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
      const dataUrls = [];

      // Fotoğrafları RAM'de tutmadan, temp dosyadan sırayla işle.
      for (const file of uploadedFiles) {
        try {
          const savedImage = await saveCompressedImageFromFileWithDataUrl(
            file.path,
            uploadDir,
            file.originalname
          );
          const fileName = savedImage.fileName;
          const filePath = `/uploads/${orgSegment}/${fileName}`;
          files.push(filePath);
          dataUrls.push(savedImage.dataUrl);
          await db.query(
            `
            INSERT INTO upload_file_blobs (file_path, organization_id, user_id, data_url)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (file_path)
            DO UPDATE SET
              organization_id = EXCLUDED.organization_id,
              user_id = EXCLUDED.user_id,
              data_url = EXCLUDED.data_url
          `,
            [filePath, req.user?.organizationId || null, req.user?.id || null, savedImage.dataUrl]
          );
        } finally {
          await removeTempFile(file);
        }
      }

      return res.json({ files, dataUrls });
    } catch (error) {
      await cleanupTempFiles(req.files || []);
      return next(error);
    }
  }
);

module.exports = router;
