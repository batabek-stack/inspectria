import { apiPost } from "./api";

export type EmailReportPayload = {
  reportType: "checklist" | "walkthrough";
  reportId: number;
  to: string;
  cc?: string;
  subject?: string;
  message?: string;
  attachmentBase64?: string;
  attachmentFileName?: string;
};

export function emailReport(payload: EmailReportPayload) {
  return apiPost<{ success: boolean }>("/emails/report", payload);
}
