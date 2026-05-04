/**
 * Per-pageId in-memory mutex. Serializes concurrent read-modify-write
 * operations on the same page to prevent last-write-wins races when the
 * agent runs multiple edit tool calls in parallel against the same page.
 *
 * Single-instance only (Railway 1 replica today). If the backend goes
 * horizontal, replace with a Redis-based distributed lock — otherwise
 * concurrent writers on different replicas will still race.
 *
 * Cancellation semantics (PRE-MORTEM #16, #18):
 * - When the hard timeout fires we abort the AbortController passed to `fn`
 *   and remove the lock entry from the Map BEFORE rejecting, so a stuck
 *   operation cannot wedge the per-page queue or hold a stale lock entry
 *   if the holder ever crashes between `set` and the `finally`.
 * - This is BEST-EFFORT: Prisma 5 only has limited AbortSignal support
 *   on raw queries — most query builder calls will continue running in
 *   the background after abort. We free the queue side; we cannot kill
 *   an in-flight query. Subsequent writers may therefore overlap a
 *   still-running prior write. Acceptable trade-off given single-replica
 *   and the alternative (permanent 60s wedge) is strictly worse.
 */

import { logger } from "../../../../utils/logger.js";

const PAGE_LOCK_TIMEOUT_MS = 60_000;
const SOFT_CAP_WARN_SIZE = 10_000;

const pageLocks = new Map<string, Promise<unknown>>();

/**
 * Function executed under the page lock. Receives an `AbortSignal` that
 * fires when the hard timeout is reached. Implementations SHOULD pass
 * the signal to any cancellable downstream call (fetch, AbortSignal-aware
 * Prisma raw query) but the signal is optional — backward compatible
 * with callers that ignore it.
 */
export type PageEditFn<T> = (signal: AbortSignal) => Promise<T>;

export async function withPageEditLock<T>(pageId: string, fn: PageEditFn<T>): Promise<T> {
  // Soft cap: log if the lock map grows unbounded — usually indicates a leak,
  // since locks self-clean on resolution and now also on timeout.
  if (pageLocks.size > SOFT_CAP_WARN_SIZE) {
    logger.warn("[pageEditMutex] Lock map exceeded soft cap", {
      size: pageLocks.size,
      cap: SOFT_CAP_WARN_SIZE,
    });
  }

  const previous = pageLocks.get(pageId) ?? Promise.resolve();
  const controller = new AbortController();

  const run = async (): Promise<T> => {
    let timeoutId: NodeJS.Timeout | undefined;
    try {
      // Race fn() against a hard timeout so a stuck operation cannot
      // permanently wedge the per-page queue.
      const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          // Free the lock entry BEFORE rejecting so a crashed/stuck holder
          // cannot leave a pending Promise referenced in the Map for the
          // rest of the process lifetime (#16).
          if (pageLocks.get(pageId) === tail) {
            pageLocks.delete(pageId);
          }
          // Best-effort cancel of the in-flight work (#18). Prisma may
          // ignore this; fetch/HTTP and signal-aware code will not.
          controller.abort("PAGE_LOCK_TIMEOUT");
          reject(new Error("PAGE_LOCK_TIMEOUT"));
        }, PAGE_LOCK_TIMEOUT_MS);
      });
      try {
        return await Promise.race([fn(controller.signal), timeout]);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    } finally {
      // Defensive cleanup: also runs on normal completion or non-timeout
      // rejection. The timeout branch already removed the entry, but
      // calling delete twice is a no-op.
      if (pageLocks.get(pageId) === tail) {
        pageLocks.delete(pageId);
      }
    }
  };

  const tail: Promise<T> = previous.then(run, run);
  pageLocks.set(pageId, tail);
  return tail;
}
