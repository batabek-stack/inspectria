const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const IMAGE_QUALITY = 82;
const MAX_IMAGE_WIDTH = 1600;

function safeImageBaseName(originalName) {
  const extension = path.extname(originalName || "");
  const baseName = path.basename(originalName || "image", extension);
  return baseName.replace(/[^a-zA-Z0-9._-]/g, "_") || "image";
}

function compressedImageName(originalName) {
  const random = Math.random().toString(16).slice(2);
  return `${Date.now()}-${random}-${safeImageBaseName(originalName)}.webp`;
}

function compressImage(input) {
  return sharp(input)
    .rotate()
    .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
    .webp({ quality: IMAGE_QUALITY });
}

async function saveCompressedImageFromBuffer(buffer, uploadDir, originalName) {
  await fs.promises.mkdir(uploadDir, { recursive: true });
  const fileName = compressedImageName(originalName);
  await compressImage(buffer).toFile(path.join(uploadDir, fileName));
  return fileName;
}

async function saveCompressedImageFromFile(filePath, uploadDir) {
  await fs.promises.mkdir(uploadDir, { recursive: true });
  const fileName = compressedImageName(path.basename(filePath));
  await compressImage(filePath).toFile(path.join(uploadDir, fileName));
  return fileName;
}

module.exports = {
  saveCompressedImageFromBuffer,
  saveCompressedImageFromFile,
};
