import { prisma } from "../../lib/prisma.js";
import { logger } from "../../utils/logger.js";
import { recordDeletionAudit } from "../auditService.js";
import { invalidateUserCaches } from "./cache.js";
import { cleanupEmbeddingsForPages } from "./embeddings.js";
import { EMPTY_SYNC_MAX } from "./constants.js";
import type { EmptyTrashSyncInput } from "./types.js";

/**
 * Synchronous empty for small trashes (≤ EMPTY_SYNC_MAX). Above that,
 * the route handler catches `TRASH_TOO_LARGE` and queues a BullMQ job.
 *
 * Handles both pages and projects: projects are deleted first so their FK
 * cascade wipes descendant projects + their pages, then any remaining
 * archived pages are deleted explicitly.
 */
export async function emptyTrashSync({
  workspaceId,
  userId,
}: EmptyTrashSyncInput): Promise<{ deletedCount: number }> {
  const [pageCount, projectCount] = await Promise.all([
    prisma.page.count({ where: { workspaceId, isArchived: true } }),
    prisma.project.count({ where: { workspaceId, isArchived: true } }),
  ]);
  const total = pageCount + projectCount;
  if (total > EMPTY_SYNC_MAX) {
    throw new Error("TRASH_TOO_LARGE");
  }
  if (total === 0) {
    return { deletedCount: 0 };
  }

  const deletedProjects = await prisma.$queryRaw<{ id: string; archived_root_id: string | null }[]>`
    DELETE FROM "projects"
    WHERE workspace_id = ${workspaceId}::uuid
      AND is_archived = true
    RETURNING id, archived_root_id
  `;

  const deletedPages = await prisma.$queryRaw<{ id: string; archived_root_id: string | null }[]>`
    DELETE FROM "pages"
    WHERE workspace_id = ${workspaceId}::uuid
      AND is_archived = true
    RETURNING id, archived_root_id
  `;

  const pageIds = deletedPages.map((p) => p.id);
  const projectIds = deletedProjects.map((p) => p.id);
  const rootIds = [
    ...deletedPages.filter((p) => p.archived_root_id === null).map((p) => p.id),
    ...deletedProjects.filter((p) => p.archived_root_id === null).map((p) => p.id),
  ];
  const descendantIds = [
    ...deletedPages.filter((p) => p.archived_root_id !== null).map((p) => p.id),
    ...deletedProjects.filter((p) => p.archived_root_id !== null).map((p) => p.id),
  ];

  await recordDeletionAudit({
    workspaceId,
    userId,
    action: "empty_trash_sync",
    rootIds,
    descendantIds,
  });
  await cleanupEmbeddingsForPages(pageIds);
  await invalidateUserCaches(userId);

  logger.info("[TRASH] emptyTrashSync", {
    workspaceId,
    pages: pageIds.length,
    projects: projectIds.length,
  });
  return { deletedCount: pageIds.length + projectIds.length };
}
