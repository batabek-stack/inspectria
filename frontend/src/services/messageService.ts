import { apiGet, apiPost } from "./api";
import { AppMessage } from "../types";

export async function getMessages() {
  return apiGet<{ messages: AppMessage[]; unreadCount: number }>("/messages");
}

export async function sendAppMessage(payload: {
  recipientUserIds: number[];
  title: string;
  body: string;
}) {
  return apiPost<{
    success: boolean;
    sentCount: number;
    emailSentCount?: number;
    emailFailedCount?: number;
    emailError?: string;
  }>("/messages", payload);
}

export async function markMessageRead(messageId: number) {
  return apiPost<{ success: boolean }>(`/messages/${messageId}/read`, {});
}

export async function importTemplateFromMessage(messageId: number) {
  return apiPost<{ success: boolean; checklistId: number; title: string }>(
    `/messages/${messageId}/import-template`,
    {}
  );
}
