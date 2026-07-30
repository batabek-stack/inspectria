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
    const hasNegativeAnswer = answerType === "FORMAT1" && isNegativeChecklistAnswer(item.answer);
    const hasComment = Boolean(String(item.comment || "").trim());
    return hasNegativeAnswer || hasComment;
  });
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

function fallbackManagerSummary(report: Report, summaryItems: ReturnType<typeof getReportManagerSummaryItems>): ManagerSummaryResponse {
  const negativeItems = summaryItems.filter((item) => {
    const answerType = item.answerType || item.answer_type || "FORMAT1";
    return answerType === "FORMAT1" && isNegativeChecklistAnswer(item.answer);
  });
  const commentOnlyItems = summaryItems.filter((item) => {
    const answerType = item.answerType || item.answer_type || "FORMAT1";
    return !(answerType === "FORMAT1" && isNegativeChecklistAnswer(item.answer)) && String(item.comment || "").trim();
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

  return {
    provider: "fallback",
    summaryTitle: `Manager Summary - ${report.checklistTitle}`,
    summaryText: [
      `${report.checklistTitle} includes ${negativeItems.length} negative checklist item${negativeItems.length === 1 ? "" : "s"} and ${commentOnlyItems.length} additional commented item${commentOnlyItems.length === 1 ? "" : "s"} requiring management review.`,
      sections.length
        ? `The reviewed observations are concentrated around ${sections.join(", ")}. Key examples include ${examples.join("; ")}.`
        : `The reviewed observations are spread across the completed checklist. Key examples include ${examples.join("; ")}.`,
      comments.length
        ? `Inspector comments indicate: ${comments.slice(0, 4).join("; ")}.`
        : "No detailed inspector comments were provided for these reviewed items.",
      "These points should be reviewed for operational meaning, correction where needed, ownership, and follow-up evidence.",
    ].join("\n\n"),
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

  try {
    return await apiPost<ManagerSummaryResponse>("/ai/manager-summary", {
      report,
      failedItems: summaryItems,
    });
  } catch {
    return fallbackManagerSummary(report, summaryItems);
  }
}
