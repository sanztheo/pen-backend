/**
 * Per-pageId in-memory mutex. Serializes concurrent read-modify-write
 * operations on the same page to prevent last-write-wins races when the
 * agent runs multiple edit tool calls in parallel against the same page.
 *
 * Single-instance only (Railway 1 replica today). If the backend goes
 * horizontal, replace with a Redis-based distributed lock — otherwise
 * concurrent writers on different replicas will still race.
 */

import { logger } from "../../../../utils/logger.js";

const PAGE_LOCK_TIMEOUT_MS = 60_000;
const SOFT_CAP_WARN_SIZE = 10_000;

const pageLocks = new Map<string, Promise<unknown>>();

export async function withPageEditLock<T>(pageId: string, fn: () => Promise<T>): Promise<T> {
  // Soft cap: log if the lock map grows unbounded — usually indicates a leak,
  // since locks self-clean on resolution and now also on timeout.
  if (pageLocks.size > SOFT_CAP_WARN_SIZE) {
    logger.warn("[pageEditMutex] Lock map exceeded soft cap", {
      size: pageLocks.size,
      cap: SOFT_CAP_WARN_SIZE,
    });
  }

  const previous = pageLocks.get(pageId) ?? Promise.resolve();

  const run = async (): Promise<T> => {
    try {
      // Race fn() against a hard timeout so a stuck operation cannot
      // permanently wedge the per-page queue.
      let timeoutId: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error("PAGE_LOCK_TIMEOUT"));
        }, PAGE_LOCK_TIMEOUT_MS);
      });
      try {
        return await Promise.race([fn(), timeout]);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    } finally {
      if (pageLocks.get(pageId) === tail) {
        pageLocks.delete(pageId);
      }
    }
  };

  const tail: Promise<T> = previous.then(run, run);
  pageLocks.set(pageId, tail);
  return tail;
}
