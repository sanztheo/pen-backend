/**
 * Retry helper for Prisma transactions running at Serializable isolation.
 *
 * Why this exists:
 * - Trash archive/restore run under `isolationLevel: "Serializable"` to
 *   prevent concurrent-archive races. Postgres will raise
 *   `serialization_failure` (SQLSTATE 40001, Prisma code P2034) when two
 *   transactions conflict — the contract is "retry the whole tx".
 * - Without this helper, every concurrent conflict surfaces as a 500 to
 *   the user. With it, we retry up to `tries` times with exponential backoff.
 */
import { logger } from "../utils/logger.js";

export interface SerializableRetryOptions {
  tries?: number;
  baseDelayMs?: number;
}

export async function withSerializableRetry<T>(
  fn: () => Promise<T>,
  { tries = 3, baseDelayMs = 50 }: SerializableRetryOptions = {},
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      const code = (e as { code?: string }).code;
      const message = (e as Error)?.message ?? "";
      const isSerializationFailure =
        code === "P2034" || /40001|serialization_failure/.test(message);
      if (!isSerializationFailure || attempt === tries - 1) {
        throw e;
      }
      const delay = baseDelayMs * 2 ** attempt;
      logger.warn("[TRASH] serialization conflict, retrying", {
        attempt: attempt + 1,
        delay,
      });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}
