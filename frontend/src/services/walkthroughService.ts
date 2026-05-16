import { apiDelete, apiGet, apiPost, apiPut } from "./api";
import { Walkthrough, WalkthroughSection } from "../types";

export type WalkthroughPayload = {
  title: string;
  location?: string;
  status?: "draft" | "completed";
  sections: WalkthroughSection[];
};

export function getWalkthroughs() {
  return apiGet<Walkthrough[]>("/walkthroughs");
}

export function createWalkthrough(payload: WalkthroughPayload) {
  return apiPost<{ success: boolean; walkthrough: Walkthrough }>("/walkthroughs", payload);
}

export function updateWalkthrough(id: number, payload: WalkthroughPayload) {
  return apiPut<{ success: boolean; walkthrough: Walkthrough }>(`/walkthroughs/${id}`, payload);
}

export function completeWalkthrough(id: number) {
  return apiPost<{ success: boolean; walkthrough: Walkthrough }>(`/walkthroughs/${id}/complete`, {});
}

export function deleteWalkthrough(id: number) {
  return apiDelete<{ success: boolean }>(`/walkthroughs/${id}`);
}
