const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const IMAGE_QUALITY = 82;
const MAX_IMAGE_WIDTH = 1600;
const SHARP_CACHE_MEMORY_MB = Number(process.env.SHARP_CACHE_MEMORY_MB || 32);
const SHARP_CONCURRENCY = Number(process.env.SHARP_CONCURRENCY || 1);

sharp.cache({
  files: 0,
  items: 0,
  memory: SHARP_CACHE_MEMORY_MB,
});
sharp.concurrency(SHARP_CONCURRENCY);

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

async function saveCompressedImageFromFile(filePath, uploadDir, originalName) {
  await fs.promises.mkdir(uploadDir, { recursive: true });
  const fileName = compressedImageName(originalName || path.basename(filePath));
  await compressImage(filePath).toFile(path.join(uploadDir, fileName));
  return fileName;
}

async function saveCompressedImageFromFileWithDataUrl(filePath, uploadDir, originalName) {
  await fs.promises.mkdir(uploadDir, { recursive: true });
  const fileName = compressedImageName(originalName || path.basename(filePath));
  const outputPath = path.join(uploadDir, fileName);
  await compressImage(filePath).toFile(outputPath);
  const data = await fs.promises.readFile(outputPath);

  return {
    fileName,
    dataUrl: `data:image/webp;base64,${data.toString("base64")}`,
  };
}

module.exports = {
  saveCompressedImageFromBuffer,
  saveCompressedImageFromFile,
  saveCompressedImageFromFileWithDataUrl,
};
