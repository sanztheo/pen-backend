import { prisma } from "../../lib/prisma.js";
import { logger } from "../../utils/logger.js";
import { recordDeletionAudit } from "../auditService.js";
import { invalidateUserCaches } from "./cache.js";
import { cleanupEmbeddingsForPages } from "./embeddings.js";
import { BULK_DELETE_MAX } from "./constants.js";
import type { BulkDeleteInput, BulkDeleteResult } from "./types.js";

/**
 * Permanently deletes a batch of archived roots (pages + projects) and their
 * cascade descendants.
 *
 * Security: re-validates every id is (a) in the caller's workspace, (b) archived,
 * and (c) a root (archivedRootId=null) via findMany BEFORE deleting. Cross-workspace
 * or already-restored ids are silently dropped.
 *
 * Deletion order (durability-critical):
 *   1. Collect root + descendant ids from BOTH pages and projects
 *   2. DELETE projects first — FK cascade wipes child projects + their pages
 *   3. DELETE page roots + page-rooted descendants explicitly
 *   4. Durable audit row + best-effort embeddings cleanup
 */
export async function bulkDelete({
  workspaceId,
  ids,
  userId,
}: BulkDeleteInput): Promise<BulkDeleteResult> {
  if (ids.length === 0) return { deletedCount: 0 };
  if (ids.length > BULK_DELETE_MAX) {
    throw new Error("BULK_LIMIT_EXCEEDED");
  }

  const [pageRoots, projectRoots] = await Promise.all([
    prisma.page.findMany({
      where: { id: { in: ids }, workspaceId, isArchived: true, archivedRootId: null },
      select: { id: true },
    }),
    prisma.project.findMany({
      where: { id: { in: ids }, workspaceId, isArchived: true, archivedRootId: null },
      select: { id: true },
    }),
  ]);
  const validPageIds = pageRoots.map((r) => r.id);
  const validProjectIds = projectRoots.map((r) => r.id);
  if (validPageIds.length === 0 && validProjectIds.length === 0) {
    return { deletedCount: 0 };
  }

  // Collect descendants for audit + embeddings cleanup (pages only — projects
  // are wiped by FK cascade and we don't track vector embeddings for them).
  const [pageDescendants, projectPageDescendants] = await Promise.all([
    validPageIds.length > 0
      ? prisma.page.findMany({
          where: {
            workspaceId,
            archivedRootId: { in: validPageIds },
            archivedRootType: "page",
          },
          select: { id: true },
        })
      : Promise.resolve([] as { id: string }[]),
    validProjectIds.length > 0
      ? prisma.page.findMany({
          where: {
            workspaceId,
            archivedRootId: { in: validProjectIds },
            archivedRootType: "project",
          },
          select: { id: true },
        })
      : Promise.resolve([] as { id: string }[]),
  ]);
  const allPageIds = [
    ...validPageIds,
    ...pageDescendants.map((d) => d.id),
    ...projectPageDescendants.map((d) => d.id),
  ];

  let deletedCount = 0;
  await prisma.$transaction(async (tx) => {
    if (validProjectIds.length > 0) {
      const r = await tx.project.deleteMany({
        where: { id: { in: validProjectIds }, workspaceId },
      });
      deletedCount += r.count;
    }
    if (validPageIds.length > 0) {
      const r = await tx.page.deleteMany({
        where: {
          workspaceId,
          OR: [
            { id: { in: validPageIds } },
            { archivedRootId: { in: validPageIds }, archivedRootType: "page" },
          ],
        },
      });
      deletedCount += r.count;
    }
  });

  await recordDeletionAudit({
    workspaceId,
    userId,
    action: "bulk_delete",
    rootIds: [...validPageIds, ...validProjectIds],
    descendantIds: [
      ...pageDescendants.map((d) => d.id),
      ...projectPageDescendants.map((d) => d.id),
    ],
  });
  await cleanupEmbeddingsForPages(allPageIds);
  await invalidateUserCaches(userId);

  logger.info("[TRASH] bulkDelete", {
    workspaceId,
    requested: ids.length,
    pages: validPageIds.length,
    projects: validProjectIds.length,
    deleted: deletedCount,
  });
  return { deletedCount };
}
