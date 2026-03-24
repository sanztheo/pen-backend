/**
 * Shared timeout utility for wrapping external SDK calls.
 * Prevents hung promises from blocking request processing.
 */

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms),
    ),
  ]);
}

/** Clerk SDK calls: 10s (token verify + user fetch) */
export const CLERK_TIMEOUT_MS = 10_000;

/** Paddle SDK calls: 15s (subscription management) */
export const PADDLE_TIMEOUT_MS = 15_000;
