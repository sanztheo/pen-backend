import { prisma } from "../../lib/prisma.js";
import { logger } from "../../utils/logger.js";
import { recordDeletionAudit } from "../auditService.js";
import { cleanupEmbeddingsForPages } from "./embeddings.js";
import { PURGE_BATCH_SIZE, TRASH_RETENTION_DAYS } from "./constants.js";

/**
 * GDPR retention — hard-deletes every archived item whose `archivedAt` is
 * older than `TRASH_RETENTION_DAYS`. Batched to keep lock footprint low and
 * yield the DB pool between batches.
 *
 * Two passes:
 *  1. Expired project roots first — FK cascade wipes their descendant
 *     projects + pages automatically.
 *  2. Expired page rows — handles standalone archived pages.
 */
export async function purgeOlderThan30Days(): Promise<{ deletedCount: number }> {
  const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 3600 * 1000);
  let totalDeleted = 0;

  const expiredProjects = await prisma.project.findMany({
    where: { isArchived: true, archivedRootId: null, archivedAt: { lt: cutoff } },
    select: { id: true, workspaceId: true },
    take: PURGE_BATCH_SIZE,
  });
  if (expiredProjects.length > 0) {
    const projectIds = expiredProjects.map((p) => p.id);
    const projectResult = await prisma.project.deleteMany({
      where: { id: { in: projectIds } },
    });
    const byWs = new Map<string, string[]>();
    for (const p of expiredProjects) {
      byWs.set(p.workspaceId, [...(byWs.get(p.workspaceId) ?? []), p.id]);
    }
    for (const [workspaceId, roots] of byWs) {
      await recordDeletionAudit({
        workspaceId,
        action: "purge_30d",
        rootIds: roots,
        descendantIds: [],
      });
    }
    totalDeleted += projectResult.count;
    logger.info("[TRASH] purge projects batch", { projects: projectResult.count });
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const batch = await prisma.page.findMany({
      where: { isArchived: true, archivedAt: { lt: cutoff } },
      select: { id: true, workspaceId: true, archivedRootId: true },
      take: PURGE_BATCH_SIZE,
    });
    if (batch.length === 0) break;

    const batchIds = batch.map((p) => p.id);
    const result = await prisma.page.deleteMany({
      where: { id: { in: batchIds } },
    });

    const byWorkspace = new Map<string, { roots: string[]; descendants: string[] }>();
    for (const p of batch) {
      const entry = byWorkspace.get(p.workspaceId) ?? { roots: [], descendants: [] };
      if (p.archivedRootId === null) entry.roots.push(p.id);
      else entry.descendants.push(p.id);
      byWorkspace.set(p.workspaceId, entry);
    }
    for (const [workspaceId, { roots, descendants }] of byWorkspace) {
      await recordDeletionAudit({
        workspaceId,
        action: "purge_30d",
        rootIds: roots,
        descendantIds: descendants,
      });
    }

    await cleanupEmbeddingsForPages(batchIds);

    totalDeleted += result.count;
    logger.info("[TRASH] purge batch", { batch: result.count, total: totalDeleted });

    if (batch.length < PURGE_BATCH_SIZE) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  logger.info("[TRASH] purgeOlderThan30Days", {
    cutoff: cutoff.toISOString(),
    totalDeleted,
  });
  return { deletedCount: totalDeleted };
}
