import { apiGet, apiPost } from "./api";
import { BillingCycle, BillingSummary, Subscription, SubscriptionStatus } from "../types";

export function getBillingSummary() {
  return apiGet<BillingSummary>("/billing/summary");
}

export function createSubscription(payload: {
  organizationId: number;
  planId: number;
  billingCycle: BillingCycle;
  status: Exclude<SubscriptionStatus, "canceled">;
  paymentMethod?: string;
  externalCustomerId?: string;
  externalSubscriptionId?: string;
}) {
  return apiPost<{ success: boolean; subscription: Subscription; subscriptionId: number }>(
    "/billing/subscriptions",
    payload
  );
}

export function cancelSubscription(id: number) {
  return apiPost<{ success: boolean }>(`/billing/subscriptions/${id}/cancel`, {});
}

export function renewCurrentSubscription(payload: {
  planId: number;
  billingCycle: BillingCycle;
  paymentMethod?: string;
}) {
  return apiPost<{ success: boolean; subscription: Subscription; subscriptionId: number }>(
    "/billing/current/renew",
    payload
  );
}

export function cancelCurrentSubscription() {
  return apiPost<{ success: boolean }>("/billing/current/cancel", {});
}

export function initializeIyzicoCheckout(payload: {
  planId: number;
  billingCycle: BillingCycle;
}) {
  return apiPost<{
    success: boolean;
    token: string;
    tokenExpireTime?: number;
    checkoutFormContent: string;
    paymentPageUrl?: string;
    conversationId: string;
    paymentId?: number;
  }>("/billing/iyzico/checkout", payload);
}
