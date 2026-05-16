import { API_BASE, apiDelete, apiGet, apiPut } from "./api";
import { AnswerType } from "../types";

export type DraftPayload = Record<
  number,
  {
    itemId: number;
    sectionTitle?: string;
    question: string;
    answerType?: AnswerType;
    options?: string[];
    answer: string;
    comment: string;
    photos: string[];
  }
>;

export type SavedDraft = {
  assignmentId: number;
  userId: number;
  form: DraftPayload;
  updatedAt: string;
};

export async function getDraft(assignmentId: number) {
  return apiGet<{ draft: SavedDraft | null }>(`/drafts/${assignmentId}`);
}

export async function saveDraft(assignmentId: number, form: DraftPayload) {
  return apiPut<{ success: boolean; updatedAt: string }>(`/drafts/${assignmentId}`, {
    form,
  });
}

export async function saveDraftKeepalive(
  assignmentId: number,
  form: DraftPayload
) {
  const token = localStorage.getItem("mod_token");

  try {
    await fetch(`${API_BASE}/drafts/${assignmentId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ form }),
      keepalive: true,
    });
  } catch (error) {
    console.error(error);
  }
}

export async function deleteDraft(assignmentId: number) {
  return apiDelete<{ success: boolean }>(`/drafts/${assignmentId}`);
}
