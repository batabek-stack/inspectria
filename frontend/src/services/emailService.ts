import { apiGet, apiPost } from "./api";
import { EmailLog } from "../types";

export type EmailReportPayload = {
  reportType: "checklist" | "walkthrough";
  reportId: number;
  to: string | string[];
  cc?: string;
  subject?: string;
  message?: string;
  attachmentBase64?: string;
  attachmentFileName?: string;
};

export type ReportEmailRecipient = {
  id: number;
  name: string;
  username: string;
  email: string;
  role: "admin" | "user";
  organizationName?: string | null;
};

export type ContactPayload = {
  name: string;
  email: string;
  organization?: string;
  message: string;
  website?: string;
};

export type SupportTicketPayload = {
  subject: string;
  message: string;
};

export function emailReport(payload: EmailReportPayload) {
  return apiPost<{ success: boolean }>("/emails/report", payload);
}

export function getReportEmailRecipients() {
  return apiGet<ReportEmailRecipient[]>("/emails/report-recipients");
}

export function sendContactMessage(payload: ContactPayload) {
  return apiPost<{ success: boolean }>("/emails/contact", payload);
}

export function createSupportTicket(payload: SupportTicketPayload) {
  return apiPost<{ success: boolean }>("/emails/support-ticket", payload);
}

export function getEmailLogs() {
  return apiGet<{ logs: EmailLog[] }>("/emails/logs");
}
