import { apiDelete, apiGet, apiPost, apiPut } from "./api";
import { User } from "../types";

export function getUsers() {
  return apiGet<User[]>("/users");
}

export function createUser(payload: {
  username: string;
  password: string;
  name: string;
  email: string;
  role: "admin" | "user";
  organizationId?: number;
}) {
  return apiPost<{
    success: boolean;
    userId: number;
    welcomeEmailSent: boolean;
    welcomeEmailError?: string;
  }>("/users", payload);
}

export function updateUser(
  id: number,
  payload: Partial<{
    username: string;
    password: string;
    name: string;
    email: string;
    role: "admin" | "user";
    active: boolean;
    approvalStatus: "pending" | "approved" | "rejected";
  }>
) {
  return apiPut<{
    success: boolean;
    user: User;
    welcomeEmailSent: boolean;
    welcomeEmailError?: string;
  }>(`/users/${id}`, payload);
}

export function createPasswordResetLink(id: number) {
  return apiPost<{
    success: boolean;
    resetUrl: string;
    expiresAt: string;
    delivery: "manual";
    emailReminder: string;
  }>(`/users/${id}/password-reset-link`, {});
}

export function createTemporaryPassword(id: number) {
  return apiPost<{
    success: boolean;
    username: string;
    temporaryPassword: string;
  }>(`/users/${id}/temporary-password`, {});
}

export function deleteUser(id: number) {
  return apiDelete<{ success: boolean }>(`/users/${id}`);
}
