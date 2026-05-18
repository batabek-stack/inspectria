import jsPDF from "jspdf";
import { ManagerSummaryResponse, Report } from "../types";
import { getReportFailedItems } from "../services/aiActionPlanService";

const PAGE = {
  width: 210,
  height: 297,
  marginX: 16,
  top: 18,
  bottom: 18,
};

const COLORS = {
  text: [33, 37, 41] as [number, number, number],
  muted: [108, 117, 125] as [number, number, number],
  line: [210, 210, 210] as [number, number, number],
  headerBg: [245, 247, 250] as [number, number, number],
  accent: [15, 118, 110] as [number, number, number],
};

function sanitizeText(value?: string | null) {
  const text = value && value.trim() ? value.trim() : "-";

  return text
    .replace(/ı/g, "i")
    .replace(/İ/g, "I")
    .replace(/ş/g, "s")
    .replace(/Ş/g, "S")
    .replace(/ğ/g, "g")
    .replace(/Ğ/g, "G")
    .replace(/ü/g, "u")
    .replace(/Ü/g, "U")
    .replace(/ö/g, "o")
    .replace(/Ö/g, "O")
    .replace(/ç/g, "c")
    .replace(/Ç/g, "C");
}

function formatDate(value?: string | Date) {
  if (!value) return "-";
  try {
    const d = typeof value === "string" ? new Date(value) : value;
    if (Number.isNaN(d.getTime())) return "-";
    return sanitizeText(d.toLocaleString("tr-TR"));
  } catch {
    return "-";
  }
}

type ManagerSummaryPdfOutput = {
  fileName: string;
  blob?: Blob;
};

type ManagerSummaryPdfOptions = {
  output?: "save" | "blob";
};

export function generateManagerSummaryPdf(
  report: Report,
  summary: ManagerSummaryResponse,
  options: ManagerSummaryPdfOptions = {}
): ManagerSummaryPdfOutput {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });
  const contentWidth = PAGE.width - PAGE.marginX * 2;
  let cursorY = PAGE.top;
  let pageNumber = 1;

  const drawFooter = () => {
    doc.setDrawColor(...COLORS.line);
    doc.line(PAGE.marginX, PAGE.height - 12, PAGE.width - PAGE.marginX, PAGE.height - 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.muted);
    doc.text(`Generated: ${formatDate(new Date())}`, PAGE.marginX, PAGE.height - 7);
    doc.text(`Page ${pageNumber}`, PAGE.width - PAGE.marginX - 14, PAGE.height - 7);
  };

  const drawHeader = () => {
    doc.setFillColor(...COLORS.headerBg);
    doc.rect(0, 0, PAGE.width, 24, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor(...COLORS.text);
    doc.text("Inspectria Manager Summary", PAGE.marginX, 11);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...COLORS.muted);
    doc.text(sanitizeText(report.checklistTitle), PAGE.marginX, 17);
    cursorY = 34;
  };

  const addPage = () => {
    drawFooter();
    doc.addPage();
    pageNumber += 1;
    drawHeader();
  };

  const ensureSpace = (height: number) => {
    if (cursorY + height > PAGE.height - PAGE.bottom) {
      addPage();
    }
  };

  const drawMeta = (label: string, value?: string) => {
    const labelWidth = 34;
    const lines = doc.splitTextToSize(sanitizeText(value), contentWidth - labelWidth);
    const height = Math.max(6, lines.length * 5);
    ensureSpace(height + 1);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...COLORS.text);
    doc.text(sanitizeText(label), PAGE.marginX, cursorY);
    doc.setFont("helvetica", "normal");
    doc.text(lines, PAGE.marginX + labelWidth, cursorY);
    cursorY += height + 1;
  };

  const drawSectionTitle = (title: string) => {
    ensureSpace(12);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...COLORS.accent);
    doc.text(sanitizeText(title), PAGE.marginX, cursorY);
    cursorY += 3;
    doc.setDrawColor(...COLORS.line);
    doc.line(PAGE.marginX, cursorY + 2, PAGE.width - PAGE.marginX, cursorY + 2);
    cursorY += 8;
  };

  const drawParagraphs = (text: string) => {
    sanitizeText(text)
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .forEach((paragraph) => {
        const lines = doc.splitTextToSize(paragraph, contentWidth);
        const height = lines.length * 5 + 4;
        ensureSpace(height);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(...COLORS.text);
        doc.text(lines, PAGE.marginX, cursorY);
        cursorY += height;
      });
  };

  const noItems = getReportFailedItems(report);

  drawHeader();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...COLORS.text);
  const titleLines = doc.splitTextToSize(sanitizeText(summary.summaryTitle), contentWidth);
  doc.text(titleLines, PAGE.marginX, cursorY);
  cursorY += titleLines.length * 7 + 8;

  drawMeta("Checklist", report.checklistTitle);
  drawMeta("Completed By", report.completedByName);
  drawMeta("Assigned To", report.assignedToName);
  drawMeta("Completed At", formatDate(report.completed_at));
  drawMeta("Negative Items", String(noItems.length));
  drawMeta("AI Provider", summary.provider === "fallback" ? "Local fallback" : summary.provider);

  cursorY += 6;
  drawSectionTitle("Summary");
  drawParagraphs(summary.summaryText);

  if (noItems.length > 0) {
    drawSectionTitle("Negative Items Reviewed");
    noItems.forEach((item, index) => {
      const text = `${index + 1}. ${sanitizeText(item.question)}${item.comment ? ` | Comment: ${sanitizeText(item.comment)}` : ""}`;
      const lines = doc.splitTextToSize(text, contentWidth);
      const height = lines.length * 5 + 3;
      ensureSpace(height);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...COLORS.text);
      doc.text(lines, PAGE.marginX, cursorY);
      cursorY += height;
    });
  }

  drawFooter();

  const fileName = `${sanitizeText(report.checklistTitle || "Manager_Summary").replace(/[^\w\-]+/g, "_")}_Manager_Summary_${Date.now()}.pdf`;
  if (options.output === "blob") {
    return {
      fileName,
      blob: doc.output("blob"),
    };
  }

  doc.save(fileName);
  return { fileName };
}
