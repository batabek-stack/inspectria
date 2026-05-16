import * as XLSX from "xlsx";
import { AiActionPlan, Report } from "../types";

export function exportReportsToExcel(reports: Report[]) {
  const rows = reports.flatMap((report) =>
    report.items.length
      ? report.items.map((item) => ({
          checklist: report.checklistTitle,
          completedBy: report.completedByName,
          assignedTo: report.assignedToName,
          assignedBy: report.assignedByName,
          completedAt: report.completed_at,
          status: report.status,
          question: item.question,
          answer: item.answer,
          comment: item.comment,
          photoCount: item.photos.length,
        }))
      : [{
          checklist: report.checklistTitle,
          completedBy: report.completedByName,
          assignedTo: report.assignedToName,
          assignedBy: report.assignedByName,
          completedAt: report.completed_at,
          status: report.status,
          question: "",
          answer: "",
          comment: "",
          photoCount: 0,
        }]
  );

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Reports");
  XLSX.writeFile(workbook, `MOD_Checklist_Reports_${Date.now()}.xlsx`);
}

export function exportActionPlansToExcel(actionPlans: AiActionPlan[], report: Report) {
  const rows = actionPlans.map((plan) => ({
    "Section": plan.sectionTitle,
    "Issue": plan.issue,
    "Comment": plan.comment,
    "Department": plan.department,
    "Estimated Duration (min)": plan.estimatedDurationMinutes,
    "Corrective Action": plan.correctiveAction,
    "Priority": plan.priority,
    "Owner": plan.owner,
    "Due Date": plan.dueDate,
    "Status": plan.status,
    "Confidence": plan.confidence,
    "Follow-up Notes": plan.followUpNotes,
  }));

  const summaryRows = [
    { Metric: "Checklist", Value: report.checklistTitle },
    { Metric: "Completed By", Value: report.completedByName },
    { Metric: "Assigned To", Value: report.assignedToName },
    { Metric: "Completed At", Value: report.completed_at },
    { Metric: "Failed Items", Value: actionPlans.length },
    {
      Metric: "Critical / High Items",
      Value: actionPlans.filter((plan) => ["Critical", "High"].includes(plan.priority)).length,
    },
  ];

  const workbook = XLSX.utils.book_new();
  const actionSheet = XLSX.utils.json_to_sheet(rows);
  const summarySheet = XLSX.utils.json_to_sheet(summaryRows);

  actionSheet["!cols"] = [
    { wch: 20 },
    { wch: 40 },
    { wch: 32 },
    { wch: 22 },
    { wch: 24 },
    { wch: 45 },
    { wch: 12 },
    { wch: 22 },
    { wch: 14 },
    { wch: 16 },
    { wch: 12 },
    { wch: 35 },
  ];

  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");
  XLSX.utils.book_append_sheet(workbook, actionSheet, "AI Action Plan");
  XLSX.writeFile(workbook, `MOD_AI_Action_Plan_${report.id}_${Date.now()}.xlsx`);
}
