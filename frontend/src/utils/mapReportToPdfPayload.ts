import { Report } from "../types";

export function mapReportToPdfPayload(report: Report) {
  return {
    hotelName: report.checklistTitle,
    reportTitle: "Checklist Completion Report",
    checklistTitle: report.checklistTitle,
    assignedToName: report.assignedToName,
    assignedByName: report.assignedByName,
    completedByName: report.completedByName,
    completedAt: report.completed_at,
    status: report.status,
    items: report.items.map((item) => ({
      title: item.question,
      question: item.question,
      answer: item.answer,
      answerType: item.answerType || item.answer_type || "FORMAT1",
      comment: item.comment,
      photos: item.photos,
    })),
  };
}
