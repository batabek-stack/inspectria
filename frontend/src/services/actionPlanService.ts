import { apiDelete, apiGet, apiPost, apiPut } from "./api";
import { ActionPlanItem, ActionPlanStatus } from "../types";

export type ActionPlanDraftItem = {
  item: string;
  action: string;
  remarks: string;
  responsibleEmails: string[];
  dueDate: string;
  status: ActionPlanStatus;
  photos: string[];
};

export function getActionPlans() {
  return apiGet<ActionPlanItem[]>("/action-plans");
}

export function createActionPlans(organizationId: number, items: ActionPlanDraftItem[]) {
  return apiPost<{ success: boolean; items: ActionPlanItem[]; emailError?: string }>(
    "/action-plans",
    { organizationId, items }
  );
}

export function updateActionPlan(
  id: number,
  payload: { remarks: string; status: ActionPlanStatus }
) {
  return apiPut<{ success: boolean }>(`/action-plans/${id}`, payload);
}

export function deleteActionPlan(id: number) {
  return apiDelete<{ success: boolean }>(`/action-plans/${id}`);
}

export function deleteAllActionPlans(organizationId: number) {
  return apiDelete<{ success: boolean }>(`/action-plans?organizationId=${organizationId}`);
}
