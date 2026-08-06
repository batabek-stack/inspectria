import { API_BASE, apiPost } from "./api";
import { AiActionPlan, AiActionPlanResponse, ManagerSummaryResponse, Report } from "../types";

function normalizeForMatch(value?: string | null) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\u0131/g, "i")
    .replace(/\u015f/g, "s")
    .replace(/\u011f/g, "g")
    .replace(/\u00fc/g, "u")
    .replace(/\u00f6/g, "o")
    .replace(/\u00e7/g, "c");
}

export function isNegativeChecklistAnswer(answer?: string | null) {
  const normalized = normalizeForMatch(answer);
  return ["no", "fail", "failed", "false"].includes(normalized);
}

export function getReportFailedItems(report: Report) {
  return (report.items || []).filter(
    (item) => {
      const answerType = item.answerType || item.answer_type || "FORMAT1";
      return answerType === "FORMAT1" && isNegativeChecklistAnswer(item.answer);
    }
  );
}

export function getReportManagerSummaryItems(report: Report) {
  return (report.items || []).filter((item) => {
    const answerType = item.answerType || item.answer_type || "FORMAT1";
    const hasAnswer = Boolean(String(item.answer || "").trim());
    const hasNegativeAnswer = answerType === "FORMAT1" && isNegativeChecklistAnswer(item.answer);
    const hasOperationalAnswer = answerType !== "FORMAT1" && hasAnswer;
    const hasComment = Boolean(String(item.comment || "").trim());
    return hasNegativeAnswer || hasOperationalAnswer || hasComment;
  });
}

type SummaryLanguage = "Turkish" | "English" | "the dominant language used in the user's comments and answers";

function languageScore(text: string, language: SummaryLanguage) {
  const normalized = ` ${text.toLowerCase()} `;

  if (language === "Turkish") {
    const charMatches = text.match(/[\u00e7\u011f\u0131\u00f6\u015f\u00fc\u00c7\u011e\u0130\u00d6\u015e\u00dc]/g)?.length || 0;
    const wordMatches =
      normalized.match(/\b(ve|bir|bu|da|de|ile|icin|gibi|var|yok|kontrol|oda|misafir|temiz|eksik|tamam|uygun)\b/g)
        ?.length || 0;
    return charMatches * 3 + wordMatches;
  }

  return (
    normalized.match(/\b(and|the|with|for|not|room|guest|clean|check|completed|missing|ok|yes|no)\b/g)
      ?.length || 0
  );
}

export function detectReportSummaryLanguage(
  report: Report,
  summaryItems: ReturnType<typeof getReportManagerSummaryItems>
): SummaryLanguage {
  const userEnteredText = summaryItems
    .flatMap((item) => {
      const answerType = item.answerType || item.answer_type || "FORMAT1";
      return [item.comment, answerType !== "FORMAT1" ? item.answer : ""];
    })
    .filter(Boolean)
    .join(" ");

  const fallbackText = [
    report.checklistTitle,
    ...summaryItems.flatMap((item) => [item.sectionTitle || item.section_title, item.question, item.answer, item.comment]),
  ]
    .filter(Boolean)
    .join(" ");

  const textToScore = userEnteredText.trim() || fallbackText;
  const turkishScore = languageScore(textToScore, "Turkish");
  const englishScore = languageScore(textToScore, "English");

  if (turkishScore > englishScore) return "Turkish";
  if (englishScore > turkishScore) return "English";

  return "the dominant language used in the user's comments and answers";
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function fallbackActionPlans(report: Report, failedItems: ReturnType<typeof getReportFailedItems>): AiActionPlan[] {
  const today = new Date();

  return failedItems.map((item, index) => ({
    failedItemId: String(item.id || item.checklist_item_id || index + 1),
    reportId: String(report.id || ""),
    checklistTitle: report.checklistTitle,
    sectionTitle: item.sectionTitle || "",
    issue: item.question || `Failed item ${index + 1}`,
    failedAnswer: item.answer || "NO",
    comment: item.comment || "",
    rootCause: "The failed answer indicates the expected operating standard was not met and needs owner review.",
    correctiveAction: "Review the failed item, correct the condition, and record completion evidence.",
    preventiveAction: "Confirm the related routine control and ownership so the same issue does not repeat.",
    priority: "Medium",
    department: "Operations",
    owner: "Operations Supervisor",
    departmentReason: "Local fallback assigned the issue to Operations because AI classification was unavailable.",
    estimatedDurationMinutes: 60,
    confidence: "Low",
    dueDate: addDays(today, 1),
    status: "Open",
    progress: 0,
    followUpNotes: "",
  }));
}

function fallbackManagerSummary(
  report: Report,
  summaryItems: ReturnType<typeof getReportManagerSummaryItems>,
  targetLanguage: SummaryLanguage
): ManagerSummaryResponse {
  const negativeItems = summaryItems.filter((item) => {
    const answerType = item.answerType || item.answer_type || "FORMAT1";
    return answerType === "FORMAT1" && isNegativeChecklistAnswer(item.answer);
  });
  const commentOnlyItems = summaryItems.filter((item) => {
    const answerType = item.answerType || item.answer_type || "FORMAT1";
    return !(answerType === "FORMAT1" && isNegativeChecklistAnswer(item.answer)) && String(item.comment || "").trim();
  });
  const answeredObservationItems = summaryItems.filter((item) => {
    const answerType = item.answerType || item.answer_type || "FORMAT1";
    return answerType !== "FORMAT1" && String(item.answer || "").trim();
  });
  const sections = [
    ...new Set(
      summaryItems
        .map((item) => item.sectionTitle)
        .filter((section): section is string => Boolean(section && section.trim()))
    ),
  ];
  const comments = summaryItems.map((item) => item.comment).filter(Boolean);
  const examples = summaryItems.slice(0, 5).map((item) => item.question).filter(Boolean);

  if (targetLanguage === "Turkish") {
    return {
      provider: "fallback",
      summaryTitle: `Y\u00f6netici \u00d6zeti - ${report.checklistTitle}`,
      summaryText: [
        `${report.checklistTitle} raporunda y\u00f6netim incelemesi gerektiren ${negativeItems.length} negatif checklist maddesi ve ${commentOnlyItems.length} ek yorumlu madde bulunuyor.`,
        answeredObservationItems.length
          ? `${answeredObservationItems.length} adet tamamlanm\u0131\u015f metin, tarih veya se\u00e7im cevab\u0131 operasyonel ba\u011flam i\u00e7in ayr\u0131ca incelendi.`
          : "",
        sections.length
          ? `G\u00f6zlemler a\u011f\u0131rl\u0131kl\u0131 olarak ${sections.join(", ")} alanlar\u0131nda toplan\u0131yor. \u00d6ne \u00e7\u0131kan \u00f6rnekler: ${examples.join("; ")}.`
          : `G\u00f6zlemler tamamlanan checklist geneline yay\u0131lm\u0131\u015f durumda. \u00d6ne \u00e7\u0131kan \u00f6rnekler: ${examples.join("; ")}.`,
        comments.length
          ? `Denet\u00e7i yorumlar\u0131 \u015funlar\u0131 g\u00f6steriyor: ${comments.slice(0, 4).join("; ")}.`
          : "Bu maddeler i\u00e7in ayr\u0131nt\u0131l\u0131 denet\u00e7i yorumu girilmemi\u015f.",
        "Bu noktalar operasyonel anlam, gerekli d\u00fczeltme, sorumluluk ve takip kan\u0131t\u0131 a\u00e7\u0131s\u0131ndan de\u011ferlendirilmelidir.",
      ].filter(Boolean).join("\n\n"),
    };
  }

  return {
    provider: "fallback",
    summaryTitle: `Manager Summary - ${report.checklistTitle}`,
    summaryText: [
      `${report.checklistTitle} includes ${negativeItems.length} negative checklist item${negativeItems.length === 1 ? "" : "s"} and ${commentOnlyItems.length} additional commented item${commentOnlyItems.length === 1 ? "" : "s"} requiring management review.`,
      answeredObservationItems.length
        ? `${answeredObservationItems.length} completed text, date, or choice response${answeredObservationItems.length === 1 ? "" : "s"} were also reviewed for operational context.`
        : "",
      sections.length
        ? `The reviewed observations are concentrated around ${sections.join(", ")}. Key examples include ${examples.join("; ")}.`
        : `The reviewed observations are spread across the completed checklist. Key examples include ${examples.join("; ")}.`,
      comments.length
        ? `Inspector comments indicate: ${comments.slice(0, 4).join("; ")}.`
        : "No detailed inspector comments were provided for these reviewed items.",
      "These points should be reviewed for operational meaning, correction where needed, ownership, and follow-up evidence.",
    ].filter(Boolean).join("\n\n"),
  };
}

export async function generateAiActionPlan(report: Report): Promise<AiActionPlanResponse> {
  const failedItems = getReportFailedItems(report);

  try {
    return await apiPost<AiActionPlanResponse>("/ai/action-plan", {
      report,
      failedItems,
    });
  } catch {
    return {
      provider: "fallback",
      actionPlans: fallbackActionPlans(report, failedItems),
    };
  }
}

export function submitActionPlanExcelDownload(report: Report) {
  window.location.href = getActionPlanExcelDownloadUrl(report.id);
}

export function getActionPlanExcelDownloadUrl(reportId: number | string) {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("mod_token") : "";
  const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : "";
  return `${API_BASE}/ai/reports/${encodeURIComponent(reportId)}/action-plan-excel${tokenQuery}`;
}

export async function generateManagerSummary(report: Report): Promise<ManagerSummaryResponse> {
  const summaryItems = getReportManagerSummaryItems(report);
  const targetLanguage = detectReportSummaryLanguage(report, summaryItems);

  try {
    return await apiPost<ManagerSummaryResponse>("/ai/manager-summary", {
      report,
      failedItems: summaryItems,
      targetLanguage,
    });
  } catch {
    return fallbackManagerSummary(report, summaryItems, targetLanguage);
  }
}
