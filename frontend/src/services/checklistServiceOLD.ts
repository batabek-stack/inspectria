import { apiGet, apiPost, apiDelete } from "./api";
import { Checklist } from "../types";

export async function getChecklists(): Promise<Checklist[]> {
  return apiGet("/checklists");
}

export async function createChecklist(title: string, items: Array<{ question: string }>) {
  return apiPost("/checklists", { title, items });
}

export async function deleteChecklist(checklistId: number) {
  return apiDelete(`/checklists/${checklistId}`);
}