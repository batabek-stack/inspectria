import { apiPost } from "./api";
import { AiActionPlanResponse, Report } from "../types";

function getFailedItems(report: Report) {
  return (report.items || []).filter(
    (item) => (item.answerType || item.answer_type || "FORMAT1") === "FORMAT1" && item.answer === "NO"
  );
}

export async function generateAiActionPlan(report: Report): Promise<AiActionPlanResponse> {
  return apiPost<AiActionPlanResponse>("/ai/action-plan", {
    report,
    failedItems: getFailedItems(report),
  });
}
