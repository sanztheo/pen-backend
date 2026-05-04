/**
 * Internal helpers for `AccountDeletionService`.
 * Extracted to keep the orchestrating service file under 300 lines.
 */

import { redis } from "../lib/redis.js";

const REDIS_SCAN_BATCH_SIZE = 100;

/** Type guard for Clerk API errors with a status property. */
export function isClerkApiError(error: unknown): error is { status: number } {
  return typeof error === "object" && error !== null && "status" in error;
}

/** Redact email for logs — shows first 3 chars only. */
export function redactEmail(email: string): string {
  const atIndex = email.indexOf("@");
  if (atIndex <= 3) return `***${email.slice(atIndex)}`;
  return `${email.slice(0, 3)}***${email.slice(atIndex)}`;
}

/** SCAN-based key lookup (avoids KEYS in production). */
export async function scanRedisKeys(pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [nextCursor, batch] = await redis.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      REDIS_SCAN_BATCH_SIZE,
    );
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== "0");
  return keys;
}
