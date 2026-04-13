/**
 * GDPR-durable deletion audit trail.
 *
 * Why this exists:
 * - `logger.warn("[AUDIT] ...")` writes to process stdout which Railway/
 *   Datadog retain for 7–30 days. GDPR Art. 30 requires durable records of
 *   processing activities (including deletion) — we need a row in Postgres
 *   that survives log rotation.
 * - Audit writes are `soft-fail`: if the audit insert fails, we log the
 *   failure and continue — we never roll back a user's delete because the
 *   audit log was momentarily unavailable (that would be worse UX and does
 *   not make the delete "unhappen").
 *
 * The caller MUST invoke this AFTER the successful destructive operation,
 * not before, so the audit row reflects an actual state change.
 */
import { prisma } from "../lib/prisma.js";
import { logger } from "../utils/logger.js";

export type DeletionAuditAction =
  | "bulk_delete"
  | "empty_trash_sync"
  | "empty_trash_async"
  | "purge_30d";

export interface DeletionAuditInput {
  workspaceId: string;
  userId?: string;
  action: DeletionAuditAction;
  rootIds: string[];
  descendantIds: string[];
}

export async function recordDeletionAudit(input: DeletionAuditInput): Promise<void> {
  try {
    await prisma.deletionAuditLog.create({
      data: {
        workspaceId: input.workspaceId,
        userId: input.userId,
        action: input.action,
        rootIds: input.rootIds,
        descendantIds: input.descendantIds,
        totalCount: input.rootIds.length + input.descendantIds.length,
      },
    });
  } catch (e) {
    // Soft-fail: never block the delete on audit log failure.
    logger.error("[AUDIT] failed to record deletion audit", {
      error: e instanceof Error ? e.message : String(e),
      workspaceId: input.workspaceId,
      action: input.action,
      totalCount: input.rootIds.length + input.descendantIds.length,
    });
  }
}
