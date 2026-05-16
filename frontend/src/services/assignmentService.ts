import { apiGet, apiPost } from "./api";
import { Assignment } from "../types";

export function getAssignments() {
  return apiGet<Assignment[]>("/assignments");
}

export function createAssignment(checklistId: number, assignedToUserId: number) {
  return apiPost("/assignments", { checklistId, assignedToUserId });
}
