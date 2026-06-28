import jsPDF from "jspdf";
import { API_BASE, FILE_BASE } from "../services/api";

type AnswerValue = "YES" | "NO" | "N/A" | "";

type ChecklistPdfItem = {
  title?: string;
  question?: string;
  sectionTitle?: string;
  section_title?: string;
  answer?: AnswerValue | string;
  answerType?: "FORMAT1" | "DATE" | "TEXT" | "MULTIPLE_CHOICE";
  answer_type?: "FORMAT1" | "DATE" | "TEXT" | "MULTIPLE_CHOICE";
  comment?: string;
  photos?: string[];
};

type ChecklistPdfReport = {
  hotelName?: string;
  reportTitle?: string;
  checklistTitle?: string;
  assignedToName?: string;
  assignedByName?: string;
  completedByName?: string;
  completedAt?: string | Date;
  status?: string;
  items: ChecklistPdfItem[];
};

type ChecklistPdfOutput = {
  fileName: string;
  dataUri?: string;
};

type ChecklistPdfOptions = {
  output?: "save" | "dataUri";
};

type PdfPhotoData = {
  dataUrl: string;
  width: number;
  height: number;
};

type PdfImageData = {
  dataUrl: string;
  width: number;
  height: number;
};

const PAGE = {
  width: 210,
  height: 297,
  marginX: 14,
  top: 18,
  bottom: 16,
};

const COLORS = {
  text: [33, 37, 41] as [number, number, number],
  muted: [108, 117, 125] as [number, number, number],
  line: [210, 210, 210] as [number, number, number],
  headerBg: [245, 247, 250] as [number, number, number],
  yes: [22, 163, 74] as [number, number, number],
  no: [220, 38, 38] as [number, number, number],
  na: [37, 99, 235] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
};

const PDF_SIZE_TARGET_BYTES = 7 * 1024 * 1024;
const PDF_NON_IMAGE_BUDGET_BYTES = 700 * 1024;
const MAX_PHOTO_LONG_EDGE_PX = 1100;
const MIN_PHOTO_LONG_EDGE_PX = 520;
const MAX_PHOTO_QUALITY = 0.72;
const MIN_PHOTO_QUALITY = 0.38;
const LOGO_PATH = "/inspectra-logo.png";
const SITE_URL = "www.inspectria.com";

function sanitizeText(value?: string | null) {
  const text = value && value.trim() ? value.trim() : "-";

  // jsPDF's default fonts do not fully support these characters, so keep a
  // safe fallback until a Unicode font is embedded.
  return text
    .replace(/\u0131/g, "i")
    .replace(/\u0130/g, "I")
    .replace(/\u015f/g, "s")
    .replace(/\u015e/g, "S")
    .replace(/\u011f/g, "g")
    .replace(/\u011e/g, "G")
    .replace(/\u00fc/g, "u")
    .replace(/\u00dc/g, "U")
    .replace(/\u00f6/g, "o")
    .replace(/\u00d6/g, "O")
    .replace(/\u00e7/g, "c")
    .replace(/\u00c7/g, "C");
}

function formatDate(value?: string | Date) {
  if (!value) return "-";
  try {
    const d = typeof value === "string" ? new Date(value) : value;
    if (Number.isNaN(d.getTime())) return "-";
    return sanitizeText(d.toLocaleString("en-US"));
  } catch {
    return "-";
  }
}

function normalizeAnswer(answer?: string) {
  if (!answer) return "-";
  return answer;
}

function answerColor(answer?: string): [number, number, number] {
  const normalized = normalizeAnswer(answer);
  if (normalized === "YES") return COLORS.yes;
  if (normalized === "NO") return COLORS.no;
  return COLORS.na;
}

function isServerFile(path: string) {
  return path.startsWith("/uploads/") || path.startsWith("uploads/");
}

function estimateDataUrlBytes(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] || "";
  return Math.floor((base64.length * 3) / 4);
}

function getPhotoBudgetBytes(totalPhotos: number) {
  if (totalPhotos <= 0) return PDF_SIZE_TARGET_BYTES;

  const available = Math.max(
    2 * 1024 * 1024,
    PDF_SIZE_TARGET_BYTES - PDF_NON_IMAGE_BUDGET_BYTES
  );

  return Math.max(42 * 1024, Math.floor(available / totalPhotos));
}

function getInitialPhotoQuality(totalPhotos: number) {
  if (totalPhotos >= 60) return 0.46;
  if (totalPhotos >= 35) return 0.52;
  if (totalPhotos >= 20) return 0.58;
  if (totalPhotos >= 10) return 0.64;
  return MAX_PHOTO_QUALITY;
}

function getInitialLongEdge(totalPhotos: number) {
  if (totalPhotos >= 60) return 680;
  if (totalPhotos >= 35) return 760;
  if (totalPhotos >= 20) return 860;
  if (totalPhotos >= 10) return 980;
  return MAX_PHOTO_LONG_EDGE_PX;
}

async function readImageAsDataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function createImageElement(dataUrl: string): Promise<HTMLImageElement> {
  return await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });
}

async function compressImageForPdf(
  sourceDataUrl: string,
  totalPhotos: number
): Promise<PdfPhotoData> {
  const image = await createImageElement(sourceDataUrl);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context || !image.naturalWidth || !image.naturalHeight) {
    return {
      dataUrl: sourceDataUrl,
      width: image.naturalWidth || 1,
      height: image.naturalHeight || 1,
    };
  }

  const targetBytes = getPhotoBudgetBytes(totalPhotos);
  let longEdge = getInitialLongEdge(totalPhotos);
  let quality = getInitialPhotoQuality(totalPhotos);
  let bestDataUrl = sourceDataUrl;

  for (let attempt = 0; attempt < 7; attempt += 1) {
    const scale = Math.min(1, longEdge / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    bestDataUrl = canvas.toDataURL("image/jpeg", quality);
    if (estimateDataUrlBytes(bestDataUrl) <= targetBytes) {
      break;
    }

    if (quality > MIN_PHOTO_QUALITY) {
      quality = Math.max(MIN_PHOTO_QUALITY, quality - 0.08);
    } else if (longEdge > MIN_PHOTO_LONG_EDGE_PX) {
      longEdge = Math.max(MIN_PHOTO_LONG_EDGE_PX, Math.round(longEdge * 0.82));
    } else {
      break;
    }
  }

  return {
    dataUrl: bestDataUrl,
    width: canvas.width,
    height: canvas.height,
  };
}

async function loadImageAsDataUrl(src: string, totalPhotos: number): Promise<PdfPhotoData | null> {
  const uniqueSources = (sources: string[]) => Array.from(new Set(sources.filter(Boolean)));
  const apiHostBase = API_BASE.replace(/\/api\/?$/, "");
  const browserBase = typeof window !== "undefined" ? window.location.origin : "";
  const serverPath = src.startsWith("/") ? src : `/${src}`;
  const sources = src.startsWith("data:image/")
    ? [src]
    : isServerFile(src)
      ? uniqueSources([
          `${FILE_BASE}${serverPath}`,
          `${apiHostBase}${serverPath}`,
          `${browserBase}${serverPath}`,
          serverPath,
        ])
      : [src];

  for (const source of sources) {
    try {
      let dataUrl = source;

      if (!source.startsWith("data:image/")) {
        const response = await fetch(source);
        if (!response.ok) continue;

        const blob = await response.blob();
        if (!blob.type.startsWith("image/")) continue;

        dataUrl = await readImageAsDataUrl(blob);
      }

      return await compressImageForPdf(dataUrl, totalPhotos);
    } catch {
      // Try the next candidate source.
    }
  }

  return null;
}

async function loadLogoImage(): Promise<PdfImageData | null> {
  try {
    const response = await fetch(LOGO_PATH);
    const blob = await response.blob();
    const dataUrl = await readImageAsDataUrl(blob);
    const image = await createImageElement(dataUrl);

    return {
      dataUrl,
      width: image.naturalWidth || 1,
      height: image.naturalHeight || 1,
    };
  } catch {
    return null;
  }
}

function drawLogo(
  doc: jsPDF,
  logo: PdfImageData | null,
  x: number,
  y: number,
  width: number
) {
  if (!logo) return;

  const height = width / (logo.width / logo.height || 1);
  doc.addImage(logo.dataUrl, "PNG", x, y, width, height, undefined, "FAST");
}

function getPhotoDrawSize(photo: PdfPhotoData, maxWidth: number) {
  const aspectRatio = photo.width / photo.height;
  const isPortrait = photo.height > photo.width * 1.08;
  const maxHeight = isPortrait ? 84 : 52;

  let width = maxWidth;
  let height = width / aspectRatio;

  if (height > maxHeight) {
    height = maxHeight;
    width = height * aspectRatio;
  }

  return {
    width: Math.max(1, width),
    height: Math.max(1, height),
  };
}

export async function generateChecklistPdf(
  report: ChecklistPdfReport,
  options: ChecklistPdfOptions = {}
): Promise<ChecklistPdfOutput> {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
    compress: true,
  });

  const contentWidth = PAGE.width - PAGE.marginX * 2;
  const totalPhotos = report.items.reduce((total, item) => total + (item.photos?.length || 0), 0);
  const logo = await loadLogoImage();
  let cursorY = PAGE.top;
  let pageNumber = 1;

  const scoredItems = report.items.filter(
    (x) => (x.answerType || x.answer_type || "FORMAT1") === "FORMAT1"
  );
  const totalQuestions = scoredItems.length;
  const yesCount = scoredItems.filter((x) => x.answer === "YES").length;
  const noItems = scoredItems.filter((x) => x.answer === "NO");
  const successRate =
    totalQuestions > 0 ? Math.round((yesCount / totalQuestions) * 100) : 0;

  const drawPageHeader = (isFirstPage = false) => {
    const headerLogoWidth = 16;
    const headerTextX = PAGE.marginX + headerLogoWidth + 5;

    doc.setFillColor(...COLORS.headerBg);
    doc.rect(0, 0, PAGE.width, 24, "F");
    drawLogo(doc, logo, PAGE.marginX, 4, headerLogoWidth);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(isFirstPage ? 16 : 12);
    doc.setTextColor(...COLORS.text);
    doc.text(sanitizeText(report.hotelName || "Inspectria Report"), headerTextX, 11);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...COLORS.muted);
    doc.text(
      sanitizeText(report.reportTitle || report.checklistTitle || "Checklist Completion Report"),
      headerTextX,
      17
    );

    doc.setDrawColor(...COLORS.line);
    doc.line(PAGE.marginX, 24, PAGE.width - PAGE.marginX, 24);

    cursorY = 30;
  };

  const drawPageFooter = () => {
    const footerLogoWidth = 8;
    const footerLogoX = PAGE.width - PAGE.marginX - footerLogoWidth;

    doc.setDrawColor(...COLORS.line);
    doc.line(PAGE.marginX, PAGE.height - 12, PAGE.width - PAGE.marginX, PAGE.height - 12);
    drawLogo(
      doc,
      logo,
      footerLogoX,
      PAGE.height - 11,
      footerLogoWidth
    );

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.muted);
    doc.text(SITE_URL, PAGE.marginX, PAGE.height - 9);
    doc.text(`Generated: ${formatDate(new Date())}`, PAGE.marginX, PAGE.height - 5);
    doc.text(`Page ${pageNumber}`, footerLogoX - 18, PAGE.height - 7, { align: "right" });
  };

  const addNewPage = () => {
    drawPageFooter();
    doc.addPage();
    pageNumber += 1;
    drawPageHeader(false);
  };

  const ensureSpace = (neededHeight: number) => {
    if (cursorY + neededHeight > PAGE.height - PAGE.bottom - 12) {
      addNewPage();
    }
  };

  const drawSectionTitle = (title: string) => {
    ensureSpace(10);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...COLORS.text);
    doc.text(sanitizeText(title), PAGE.marginX, cursorY);
    cursorY += 2;

    doc.setDrawColor(...COLORS.line);
    doc.line(PAGE.marginX, cursorY + 2, PAGE.width - PAGE.marginX, cursorY + 2);
    cursorY += 7;
  };

  const drawReportSectionTitle = (title: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor(...COLORS.text);
    doc.text(sanitizeText(title), PAGE.marginX, cursorY);
    cursorY += 4;

    doc.setDrawColor(...COLORS.line);
    doc.line(PAGE.marginX, cursorY + 2, PAGE.width - PAGE.marginX, cursorY + 2);
    cursorY += 9;
  };

  const getItemSectionTitle = (item: ChecklistPdfItem) =>
    sanitizeText(item.sectionTitle || item.section_title || "Section");

  const groupedItems = report.items.reduce<Array<{ title: string; items: ChecklistPdfItem[] }>>(
    (groups, item) => {
      const title = getItemSectionTitle(item);
      const lastGroup = groups[groups.length - 1];

      if (lastGroup?.title === title) {
        lastGroup.items.push(item);
      } else {
        groups.push({ title, items: [item] });
      }

      return groups;
    },
    []
  );

  const drawLabelValue = (label: string, value: string) => {
    const labelWidth = 36;
    const x = PAGE.marginX;
    const safeValue = sanitizeText(value);
    const safeLabel = sanitizeText(label);

    const lines = doc.splitTextToSize(safeValue, contentWidth - labelWidth);
    const lineHeight = 5;
    const blockHeight = Math.max(6, lines.length * lineHeight);

    ensureSpace(blockHeight + 2);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...COLORS.text);
    doc.text(safeLabel, x, cursorY);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(...COLORS.text);
    doc.text(lines, x + labelWidth, cursorY);

    cursorY += blockHeight + 1;
  };

  const drawAnswerBadge = (answer?: string) => {
    const text = normalizeAnswer(answer);
    const color = answerColor(answer);

    doc.setFillColor(...color);
    doc.roundedRect(PAGE.marginX, cursorY - 4, 24, 7, 1.5, 1.5, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.white);
    doc.text(text, PAGE.marginX + 12, cursorY + 0.8, { align: "center" });
  };

  const drawWrappedText = (label: string, value?: string) => {
    const text = `${sanitizeText(label)}: ${sanitizeText(value)}`;
    const lines = doc.splitTextToSize(text, contentWidth);
    const blockHeight = lines.length * 5 + 1;

    ensureSpace(blockHeight + 2);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...COLORS.text);
    doc.text(lines, PAGE.marginX, cursorY);

    cursorY += blockHeight;
  };

  const drawPhotos = async (photos: string[] = []) => {
    if (!photos.length) return;

    const gap = 6;
    const columnWidth = (contentWidth - gap) / 2;

    for (let i = 0; i < photos.length; i += 2) {
      const leftRaw = photos[i];
      const rightRaw = photos[i + 1];

      const left = leftRaw ? await loadImageAsDataUrl(leftRaw, totalPhotos) : null;
      const right = rightRaw ? await loadImageAsDataUrl(rightRaw, totalPhotos) : null;
      const leftSize = left ? getPhotoDrawSize(left, columnWidth) : null;
      const rightSize = right ? getPhotoDrawSize(right, columnWidth) : null;
      const rowHeight = Math.max(leftSize?.height || 0, rightSize?.height || 0, 52);

      if (!left && !right) {
        continue;
      }

      ensureSpace(rowHeight + 8);

      if (left) {
        const size = leftSize || getPhotoDrawSize(left, columnWidth);
        const x = PAGE.marginX + (columnWidth - size.width) / 2;
        doc.setDrawColor(...COLORS.line);
        doc.rect(x, cursorY, size.width, size.height);
        doc.addImage(left.dataUrl, "JPEG", x, cursorY, size.width, size.height, undefined, "FAST");
      }

      if (right) {
        const size = rightSize || getPhotoDrawSize(right, columnWidth);
        const columnX = PAGE.marginX + columnWidth + gap;
        const x = columnX + (columnWidth - size.width) / 2;
        doc.setDrawColor(...COLORS.line);
        doc.rect(x, cursorY, size.width, size.height);
        doc.addImage(
          right.dataUrl,
          "JPEG",
          x,
          cursorY,
          size.width,
          size.height,
          undefined,
          "FAST"
        );
      }

      cursorY += rowHeight + 6;
    }
  };

  const drawItemBlock = async (item: ChecklistPdfItem, index: number) => {
    const title = sanitizeText(item.title || item.question);
    const noteText = item.comment?.trim() || "";
    const hasPhotos = Boolean(item.photos?.length);

    const questionLines = doc.splitTextToSize(`${index + 1}. ${title}`, contentWidth - 30);
    const questionHeight = questionLines.length * 5;
    const noteLines = noteText ? doc.splitTextToSize(`Comment: ${sanitizeText(noteText)}`, contentWidth) : [];
    const noteHeight = noteLines.length ? noteLines.length * 5 + 1 : 0;
    const firstPhotoRowHeight = hasPhotos ? 66 : 0;

    ensureSpace(questionHeight + noteHeight + firstPhotoRowHeight + 20);

    doc.setFillColor(250, 250, 250);
    doc.roundedRect(PAGE.marginX, cursorY - 4, contentWidth, 12 + questionHeight, 2, 2, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...COLORS.text);
    doc.text(questionLines, PAGE.marginX + 28, cursorY + 1);

    if ((item.answerType || item.answer_type || "FORMAT1") === "FORMAT1") {
      drawAnswerBadge(item.answer);
    }

    cursorY += questionHeight + 10;

    if (noteLines.length) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...COLORS.text);
      doc.text(noteLines, PAGE.marginX, cursorY);
      cursorY += noteHeight;
    }

    if (hasPhotos) {
      await drawPhotos(item.photos);
    }

    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.5);
    doc.line(PAGE.marginX, cursorY, PAGE.width - PAGE.marginX, cursorY);

    cursorY += 6;
  };

  drawPageHeader(true);

  doc.setFillColor(255, 255, 255);
  doc.roundedRect(PAGE.marginX, cursorY - 2, contentWidth, 44, 2, 2, "S");

  cursorY += 4;
  drawLabelValue("Checklist", report.checklistTitle || "-");
  drawLabelValue("Status", report.status || "-");
  drawLabelValue("Assigned To", report.assignedToName || "-");
  drawLabelValue("Assigned By", report.assignedByName || "-");
  drawLabelValue("Completed By", report.completedByName || "-");
  drawLabelValue("Completed At", formatDate(report.completedAt));

  ensureSpace(18);
  doc.setFillColor(37, 99, 235);
  doc.roundedRect(PAGE.marginX, cursorY, 78, 14, 3, 3, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  doc.text(`Basari Orani: %${successRate}`, PAGE.marginX + 39, cursorY + 9.2, {
    align: "center",
  });
  cursorY += 18;

  if (noItems.length > 0) {
    drawSectionTitle("No Olarak Isaretlenen Maddeler");

    noItems.forEach((item, index) => {
      const lines = doc.splitTextToSize(
        `${index + 1}. ${sanitizeText(item.question)} | Aciklama: ${sanitizeText(item.comment)}`,
        contentWidth
      );
      const blockHeight = lines.length * 5 + 3;

      ensureSpace(blockHeight);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(120, 0, 0);
      doc.text(lines, PAGE.marginX, cursorY);

      cursorY += blockHeight;
    });

    cursorY += 3;
  }

  if (groupedItems.length > 0) {
    addNewPage();

    let itemIndex = 0;
    for (let sectionIndex = 0; sectionIndex < groupedItems.length; sectionIndex += 1) {
      if (sectionIndex > 0) {
        addNewPage();
      }

      const section = groupedItems[sectionIndex];
      drawReportSectionTitle(section.title);

      for (let i = 0; i < section.items.length; i += 1) {
        await drawItemBlock(section.items[i], itemIndex);
        itemIndex += 1;
      }
    }
  }

  drawPageFooter();

  const fileName = `${sanitizeText(report.checklistTitle || "Checklist_Report").replace(/[^\w\-]+/g, "_")}_${Date.now()}.pdf`;
  if (options.output === "dataUri") {
    return {
      fileName,
      dataUri: doc.output("datauristring"),
    };
  }

  doc.save(fileName);
  return { fileName };
}
