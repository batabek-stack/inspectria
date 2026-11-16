import { apiGet, apiDelete, apiPost } from "./api";
import { Report } from "../types";

export async function getReports(): Promise<Report[]> {
  return apiGet("/reports");
}

export function getArchivedReports(offset = 0, limit = 20): Promise<Report[]> {
  return apiGet(`/reports?archived=true&offset=${offset}&limit=${limit}`);
}

export async function deleteReport(reportId: number) {
  return apiDelete(`/reports/${reportId}`);
}

export async function getUnreadReportCount() {
  return apiGet<{ count: number }>("/reports/unread-count");
}

export async function markReportsRead() {
  return apiPost<{ success: boolean }>("/reports/mark-read", {});
}
