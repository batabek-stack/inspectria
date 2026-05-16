import { apiGet, apiPost, apiPut } from "./api";
import { Organization, User } from "../types";

export function getOrganizations() {
  return apiGet<Organization[]>("/organizations");
}

export function createOrganization(payload: {
  name: string;
  plan?: string;
  adminUsername?: string;
  adminPassword?: string;
  adminName?: string;
}) {
  return apiPost<{ success: boolean; organization: Organization }>(
    "/organizations",
    payload
  );
}

export function updateOrganization(
  id: number,
  payload: Partial<{
    name: string;
    plan: string;
    active: boolean;
  }>
) {
  return apiPut<{ success: boolean; organization: Organization }>(
    `/organizations/${id}`,
    payload
  );
}

export function getOrganizationUsers(id: number) {
  return apiGet<User[]>(`/organizations/${id}/users`);
}
