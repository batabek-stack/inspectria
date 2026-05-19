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

export type ContactPayload = {
  name: string;
  email: string;
  organization?: string;
  message: string;
  website?: string;
};

export function emailReport(payload: EmailReportPayload) {
  return apiPost<{ success: boolean }>("/emails/report", payload);
}

export function sendContactMessage(payload: ContactPayload) {
  return apiPost<{ success: boolean }>("/emails/contact", payload);
}
