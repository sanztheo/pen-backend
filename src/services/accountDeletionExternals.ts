/**
 * GDPR cascade for systems Prisma cannot reach (PRE-MORTEM #27).
 *
 * Runs BEFORE the Prisma transaction in `AccountDeletionService` so that:
 *   - We still hold the userId / paddleCustomerId (the transaction will
 *     wipe them on success).
 *   - A failure in any external system is logged and tracked but does
 *     NOT block the local deletion — once the user has clicked Delete,
 *     we must not leave them with an orphaned local account because
 *     Cloudinary returned 502.
 *
 * Each external call:
 *   - Has a hard timeout (AbortSignal.timeout) at the underlying client.
 *   - Reports its outcome ("ok" | "failed" | "skipped") so the final
 *     log line gives ops a single grep target.
 *
 * Embeddings DB: `RAGSource` carries `userId`, `RAGSession` carries
 * `userId`. `RAGChunk` cascades from `RAGSource` (onDelete: Cascade in
 * `schema-embeddings.prisma`), so deleting sources is enough.
 */

import { prisma } from "../lib/prisma.js";
import { prismaEmbeddings } from "../lib/prismaEmbeddings.js";
import { logger } from "../utils/logger.js";
import { deleteUserCloudinaryAssets } from "./upload/cloudinary.js";
import { deleteAllUserMemories } from "./mem0/mem0Client.js";
import { PaddleBillingService } from "./billing/paddleBilling.js";

export type CascadeOutcome = "ok" | "failed" | "skipped";

export interface ExternalCascadeReport {
  cloudinary: CascadeOutcome;
  embeddings: CascadeOutcome;
  paddle: CascadeOutcome;
  mem0: CascadeOutcome;
}

/**
 * Best-effort cascade. Returns a report; never throws.
 * Caller decides what to do if a leg failed (today: log + continue).
 */
export async function runExternalCascade(userId: string): Promise<ExternalCascadeReport> {
  const report: ExternalCascadeReport = {
    cloudinary: "skipped",
    embeddings: "skipped",
    paddle: "skipped",
    mem0: "skipped",
  };

  // ─── 1. Cloudinary assets ─────────────────────────────
  try {
    const { deletedCount } = await deleteUserCloudinaryAssets(userId);
    report.cloudinary = "ok";
    logger.log(`[ACCOUNT_DELETION] Cloudinary purge ok userId=${userId} deleted=${deletedCount}`);
  } catch (error: unknown) {
    report.cloudinary = "failed";
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`[ACCOUNT_DELETION] Cloudinary purge failed userId=${userId}: ${msg}`);
  }

  // ─── 2. Embeddings (RAGSource + RAGSession) ───────────
  try {
    const [sources, sessions] = await Promise.all([
      prismaEmbeddings.rAGSource.deleteMany({ where: { userId } }),
      prismaEmbeddings.rAGSession.deleteMany({ where: { userId } }),
    ]);
    report.embeddings = "ok";
    logger.log(
      `[ACCOUNT_DELETION] Embeddings purge ok userId=${userId} sources=${sources.count} sessions=${sessions.count}`,
    );
  } catch (error: unknown) {
    report.embeddings = "failed";
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`[ACCOUNT_DELETION] Embeddings purge failed userId=${userId}: ${msg}`);
  }

  // ─── 3. Paddle customer archive ───────────────────────
  // Read paddleCustomerId BEFORE the Prisma cascade nukes the row.
  try {
    const sub = await prisma.userSubscription.findUnique({
      where: { userId },
      select: { paddleCustomerId: true },
    });
    if (!sub?.paddleCustomerId) {
      report.paddle = "skipped";
      logger.log(`[ACCOUNT_DELETION] Paddle skipped userId=${userId} (no paddleCustomerId)`);
    } else {
      await PaddleBillingService.archiveCustomer(sub.paddleCustomerId);
      report.paddle = "ok";
    }
  } catch (error: unknown) {
    report.paddle = "failed";
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`[ACCOUNT_DELETION] Paddle archive failed userId=${userId}: ${msg}`);
  }

  // ─── 4. Mem0 memories ─────────────────────────────────
  try {
    const ok = await deleteAllUserMemories(userId);
    report.mem0 = ok ? "ok" : "failed";
  } catch (error: unknown) {
    // deleteAllUserMemories is documented as never-throws, but be defensive.
    report.mem0 = "failed";
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`[ACCOUNT_DELETION] Mem0 purge failed userId=${userId}: ${msg}`);
  }

  return report;
}
