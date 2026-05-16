import { apiGet, apiPost, apiPut, apiDelete } from "./api";
import { AnswerType, Checklist } from "../types";

type ChecklistItemPayload = {
  question: string;
  answerType: AnswerType;
  options?: string[];
};

export async function getChecklists(): Promise<Checklist[]> {
  return apiGet("/checklists");
}

export async function createChecklist(
  title: string,
  imagePath: string,
  sections: Array<{
    title: string;
    items: ChecklistItemPayload[];
  }>
) {
  return apiPost("/checklists", { title, imagePath, sections });
}

export async function updateChecklist(
  id: number,
  title: string,
  imagePath: string,
  sections: Array<{
    title: string;
    items: ChecklistItemPayload[];
  }>
) {
  return apiPut(`/checklists/${id}`, { title, imagePath, sections });
}

export async function deleteChecklist(checklistId: number) {
  return apiDelete(`/checklists/${checklistId}`);
}

export async function forceDeleteChecklist(checklistId: number) {
  return apiDelete(`/checklists/${checklistId}?force=true`);
}
