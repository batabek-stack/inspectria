import { apiGet, apiDelete } from "./api";
import { Report } from "../types";

export async function getReports(): Promise<Report[]> {
  return apiGet("/reports");
}

export async function deleteReport(reportId: number) {
  return apiDelete(`/reports/${reportId}`);
}