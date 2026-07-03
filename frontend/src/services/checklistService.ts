import { apiGet, apiPost, apiPut, apiDelete } from "./api";
import { AnswerType, Checklist } from "../types";

type ChecklistItemPayload = {
  question: string;
  answerType: AnswerType;
  options?: string[];
};

export type ChecklistImportPreview = {
  provider: "azure-openai" | "openai" | "fallback";
  title: string;
  sections: Array<{
    title: string;
    items: ChecklistItemPayload[];
  }>;
  warnings?: string[];
};

export async function getChecklists(): Promise<Checklist[]> {
  return apiGet("/checklists");
}

export async function getCommunityTemplates(): Promise<Checklist[]> {
  return apiGet("/checklists/community");
}

export async function previewChecklistImport(payload: {
  fileName: string;
  sheetName: string;
  rows: unknown[][];
}) {
  return apiPost<ChecklistImportPreview>("/checklists/import/preview", payload);
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

export async function shareChecklist(checklistId: number, email: string) {
  return apiPost<{
    success: boolean;
    expiresAt: string;
    emailSent: boolean;
    emailError?: string;
    appMessageCount: number;
  }>(
    `/checklists/${checklistId}/share`,
    { email }
  );
}

export async function shareChecklistWithCommunity(checklistId: number) {
  return apiPost<{ success: boolean; communityTemplateId: number }>(
    `/checklists/${checklistId}/community`,
    {}
  );
}

export async function importCommunityTemplate(communityTemplateId: number) {
  return apiPost<{ success: boolean; checklistId: number; title: string; reused?: boolean }>(
    `/checklists/community/${communityTemplateId}/import`,
    {}
  );
}

export async function importSharedChecklist(token: string) {
  return apiPost<{ success: boolean; checklistId: number; title: string; reused?: boolean }>(
    "/checklists/shared/import",
    { token }
  );
}
