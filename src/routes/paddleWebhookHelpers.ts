/**
 * 🏓 Paddle Webhook helpers
 * Extracted from paddleWebhooks.ts to keep the route handler under the 300-line budget.
 * Pure functions, no DB access — safe to import anywhere.
 */

import type { SubscriptionNotification, TransactionNotification } from "@paddle/paddle-node-sdk";

/**
 * Custom data passed through Paddle checkout for user identification
 */
export interface PaddleCustomData {
  clerkUserId?: string;
  clerk_user_id?: string;
}

/**
 * Type guard to check if event has subscription data
 */
export function isSubscriptionEvent(event: {
  eventType: string;
  data: unknown;
}): event is { eventType: string; data: SubscriptionNotification } {
  return (
    typeof event.eventType === "string" &&
    event.eventType.startsWith("subscription.") &&
    event.data !== null &&
    typeof event.data === "object"
  );
}

/**
 * Type guard to check if event has transaction data
 */
export function isTransactionEvent(event: {
  eventType: string;
  data: unknown;
}): event is { eventType: string; data: TransactionNotification } {
  return (
    typeof event.eventType === "string" &&
    event.eventType.startsWith("transaction.") &&
    event.data !== null &&
    typeof event.data === "object"
  );
}

/**
 * Safely extract custom data from subscription/transaction data
 */
export function extractCustomData(data: unknown): PaddleCustomData {
  if (data === null || typeof data !== "object") {
    return {};
  }
  const typedData = data as Record<string, unknown>;
  const customData = typedData.customData ?? typedData.custom_data;
  if (customData === null || typeof customData !== "object") {
    return {};
  }
  return customData as PaddleCustomData;
}

/**
 * Safely extract string property from unknown data
 */
export function extractString(
  data: unknown,
  key: string,
  fallbackKey?: string,
): string | undefined {
  if (data === null || typeof data !== "object") {
    return undefined;
  }
  const typedData = data as Record<string, unknown>;
  const value = typedData[key] ?? (fallbackKey ? typedData[fallbackKey] : undefined);
  return typeof value === "string" ? value : undefined;
}
