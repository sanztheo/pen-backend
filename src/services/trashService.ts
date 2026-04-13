/**
 * Trash Service — page archive/restore with cascade
 *
 * Why this exists:
 * - `archiveCascade` marks the root AND all descendants as archived, tagging
 *   descendants with `archivedRootId = root.id` so the trash UI can show only
 *   roots (archivedRootId = NULL) while keeping cascaded children restorable
 *   together with their root.
 * - `archivedPosition` snapshots the root's sibling position at archive time
 *   so `restoreCascade` (Task 3) can put it back into its exact original slot.
 * - Siblings after the root get their `position` decremented to close the
 *   visual gap left behind.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { logger } from "../utils/logger.js";

export const MAX_CASCADE_DEPTH = 100;
export const MAX_CASCADE_NODES = 10_000;
export const BULK_DELETE_MAX = 100;
export const EMPTY_SYNC_MAX = 500; // au-delà → BullMQ (Task 4bis)
export const PURGE_BATCH_SIZE = 1000;
export const TRASH_RETENTION_DAYS = 30;

export interface ArchiveCascadeInput {
  pageId: string;
  workspaceId: string;
}

export interface ArchiveCascadeResult {
  archivedCount: number;
}

export async function archiveCascade({
  pageId,
  workspaceId,
}: ArchiveCascadeInput): Promise<ArchiveCascadeResult> {
  // Serializable isolation — prevents two issues:
  // 1. Concurrent archives at the same parent both decrementing positions stale-read style
  // 2. New child inserted between CTE snapshot and updateMany, becoming an orphan of an archived parent
  // Postgres will raise serialization_failure on conflict — caller (Task 7 handler) should retry once.
  return prisma.$transaction(
    async (tx) => {
      const root = await tx.page.findFirst({
        where: { id: pageId, workspaceId, isArchived: false },
        select: { id: true, parentId: true, position: true },
      });
      if (!root) {
        throw new Error("PAGE_NOT_FOUND_OR_ALREADY_ARCHIVED");
      }

      const descendantIds = await collectDescendantIds(tx, pageId, workspaceId);
      if (descendantIds.length > MAX_CASCADE_NODES) {
        throw new Error("TREE_TOO_LARGE");
      }

      const now = new Date();

      // 1) Snapshot position into archivedPosition, then mark root archived
      await tx.page.update({
        where: { id: pageId },
        data: {
          isArchived: true,
          archivedAt: now,
          archivedRootId: null,
          archivedPosition: root.position,
        },
      });

      // 2) Close the visual gap left by the archive: shift down siblings
      //    positioned after the root (strict >, not >=).
      await tx.page.updateMany({
        where: {
          workspaceId,
          parentId: root.parentId,
          isArchived: false,
          position: { gt: root.position },
        },
        data: { position: { decrement: 1 } },
      });

      // 3) Cascade: mark all descendants as archived, tagged with the root id
      if (descendantIds.length > 0) {
        await tx.page.updateMany({
          where: { id: { in: descendantIds }, workspaceId, isArchived: false },
          data: { isArchived: true, archivedAt: now, archivedRootId: pageId },
        });
      }

      logger.info("[TRASH] archiveCascade", {
        pageId,
        workspaceId,
        descendants: descendantIds.length,
      });

      return { archivedCount: 1 + descendantIds.length };
    },
    { isolationLevel: "Serializable" },
  );
}

export interface RestoreCascadeInput {
  pageId: string;
  workspaceId: string;
}

export interface RestoreCascadeResult {
  restoredCount: number;
}

/**
 * Restores a page from the trash, putting it back at its original sibling
 * position (or at the workspace root if the original parent is gone). All
 * cascade-archived descendants are un-archived too.
 */
export async function restoreCascade({
  pageId,
  workspaceId,
}: RestoreCascadeInput): Promise<RestoreCascadeResult> {
  return prisma.$transaction(
    async (tx) => {
      const root = await tx.page.findFirst({
        where: { id: pageId, workspaceId, isArchived: true, archivedRootId: null },
        select: { id: true, parentId: true, archivedPosition: true },
      });
      if (!root) {
        throw new Error("PAGE_NOT_IN_TRASH");
      }

      let targetParentId = root.parentId;
      let targetPosition = root.archivedPosition ?? 0;

      // If the original parent vanished or was archived, reanchor to workspace
      // root at the end so we never restore into an invalid tree location.
      if (targetParentId) {
        const parent = await tx.page.findFirst({
          where: { id: targetParentId, workspaceId, isArchived: false },
          select: { id: true },
        });
        if (!parent) {
          targetParentId = null;
          const maxRoot = await tx.page.aggregate({
            where: { workspaceId, parentId: null, isArchived: false },
            _max: { position: true },
          });
          targetPosition = (maxRoot._max.position ?? -1) + 1;
        }
      }

      // Shift +1 siblings whose position >= targetPosition. Raw SQL so we can
      // switch on parent_id null/value and filter by workspace_id explicitly.
      await tx.$executeRaw(Prisma.sql`
        UPDATE "pages"
           SET position = position + 1
         WHERE workspace_id = ${workspaceId}::uuid
           AND ${targetParentId ? Prisma.sql`parent_id = ${targetParentId}::uuid` : Prisma.sql`parent_id IS NULL`}
           AND is_archived = false
           AND position >= ${targetPosition}
      `);

      const descendants = await tx.page.findMany({
        where: { archivedRootId: pageId, workspaceId },
        select: { id: true },
      });

      await tx.page.update({
        where: { id: pageId },
        data: {
          isArchived: false,
          archivedAt: null,
          archivedRootId: null,
          archivedPosition: null,
          parentId: targetParentId,
          position: targetPosition,
        },
      });

      if (descendants.length > 0) {
        await tx.page.updateMany({
          where: { id: { in: descendants.map((d) => d.id) } },
          data: {
            isArchived: false,
            archivedAt: null,
            archivedRootId: null,
            archivedPosition: null,
          },
        });
      }

      logger.info("[TRASH] restoreCascade", {
        pageId,
        workspaceId,
        descendants: descendants.length,
        reparentedToRoot: targetParentId === null && root.parentId !== null,
      });

      return { restoredCount: 1 + descendants.length };
    },
    { isolationLevel: "Serializable" },
  );
}

/**
 * Best-effort cleanup of vector DB embeddings for the given page IDs.
 * Soft-fails: logs but doesn't throw — the trash purge must not be blocked
 * by a vector DB outage. A reconciliation job can clean leftovers later.
 *
 * Pages are stored in the embeddings DB as `RAGSource` rows of type
 * `WORKSPACE_PAGE` with `metadata.pageId` pointing at the page UUID.
 *
 * Exported for reuse by the BullMQ empty-trash worker (Task 4bis).
 */
export async function cleanupEmbeddingsForPages(pageIds: string[]): Promise<void> {
  if (pageIds.length === 0) return;
  try {
    const { prismaEmbeddings } = await import("../lib/prismaEmbeddings.js");
    // `metadata.pageId` is a JSON path — build one OR clause per pageId since
    // Prisma's JSON filter doesn't support `in` on a nested path.
    const sources = await prismaEmbeddings.rAGSource.findMany({
      where: {
        sourceType: "WORKSPACE_PAGE",
        OR: pageIds.map((pageId) => ({
          metadata: { path: ["pageId"], equals: pageId },
        })),
      },
      select: { id: true },
    });
    if (sources.length === 0) return;
    const sourceIds = sources.map((s) => s.id);
    await prismaEmbeddings.$transaction([
      prismaEmbeddings.rAGChunk.deleteMany({ where: { sourceId: { in: sourceIds } } }),
      prismaEmbeddings.rAGSource.deleteMany({ where: { id: { in: sourceIds } } }),
    ]);
    logger.info("[TRASH] embeddings cleanup", { sources: sources.length });
  } catch (e) {
    logger.error("[TRASH] embeddings cleanup failed", {
      error: e instanceof Error ? e.message : String(e),
      pageIds: pageIds.length,
    });
  }
}

export interface ListTrashCursor {
  archivedAt: string; // ISO 8601
  id: string;
}

export interface ListTrashInput {
  workspaceId: string;
  cursor?: ListTrashCursor;
  take?: number;
}

export interface ListTrashItem {
  id: string;
  title: string;
  icon: string | null;
  archivedAt: Date | null;
  parentId: string | null;
  parent: { title: string } | null;
}

export interface ListTrashResult {
  items: ListTrashItem[];
  nextCursor: ListTrashCursor | null;
}

/**
 * Paginated trash listing. Returns only archived roots (archivedRootId=null)
 * so the UI shows "N top-level pages in trash" instead of exploding cascades.
 *
 * Uses a composite (archivedAt, id) cursor so pagination is stable even when
 * multiple pages share the same archivedAt timestamp (batch archive).
 */
export async function listTrash({
  workspaceId,
  cursor,
  take = 50,
}: ListTrashInput): Promise<ListTrashResult> {
  const pageSize = Math.min(Math.max(take, 1), 100);

  const cursorWhere: Prisma.PageWhereInput = cursor
    ? {
        OR: [
          { archivedAt: { lt: new Date(cursor.archivedAt) } },
          {
            archivedAt: new Date(cursor.archivedAt),
            id: { lt: cursor.id },
          },
        ],
      }
    : {};

  const items = await prisma.page.findMany({
    where: {
      workspaceId,
      isArchived: true,
      archivedRootId: null,
      ...cursorWhere,
    },
    orderBy: [{ archivedAt: "desc" }, { id: "desc" }],
    take: pageSize + 1,
    select: {
      id: true,
      title: true,
      icon: true,
      archivedAt: true,
      parentId: true,
      parent: { select: { title: true } },
    },
  });

  const hasMore = items.length > pageSize;
  const trimmed = hasMore ? items.slice(0, -1) : items;
  const last = trimmed[trimmed.length - 1];
  return {
    items: trimmed,
    nextCursor:
      hasMore && last?.archivedAt
        ? { archivedAt: last.archivedAt.toISOString(), id: last.id }
        : null,
  };
}

export interface BulkDeleteInput {
  workspaceId: string;
  ids: string[];
}

export interface BulkDeleteResult {
  deletedCount: number;
}

/**
 * Permanently deletes a batch of archived roots and their cascade descendants.
 *
 * Security: re-validates every id is (a) in the caller's workspace, (b) archived,
 * and (c) a root (archivedRootId=null) via findMany BEFORE deleting. Cross-workspace
 * or already-restored ids are silently dropped.
 */
export async function bulkDelete({ workspaceId, ids }: BulkDeleteInput): Promise<BulkDeleteResult> {
  if (ids.length === 0) return { deletedCount: 0 };
  if (ids.length > BULK_DELETE_MAX) {
    throw new Error("BULK_LIMIT_EXCEEDED");
  }

  const roots = await prisma.page.findMany({
    where: {
      id: { in: ids },
      workspaceId,
      isArchived: true,
      archivedRootId: null,
    },
    select: { id: true, title: true },
  });
  const validIds = roots.map((r) => r.id);
  if (validIds.length === 0) return { deletedCount: 0 };

  // GDPR audit trail — log structured record BEFORE destructive op.
  logger.warn("[AUDIT] PAGE_PERMANENTLY_DELETED", {
    workspaceId,
    action: "bulk_delete",
    pages: roots.map((r) => ({ id: r.id, title: r.title })),
  });

  // Best-effort: collect descendant ids for vector DB cleanup. We could rely
  // on Postgres cascade alone, but the embeddings DB is a separate DB — it
  // needs an explicit delete.
  const descendants = await prisma.page.findMany({
    where: { workspaceId, archivedRootId: { in: validIds } },
    select: { id: true },
  });
  const allPageIds = [...validIds, ...descendants.map((d) => d.id)];
  await cleanupEmbeddingsForPages(allPageIds);

  const result = await prisma.page.deleteMany({
    where: {
      workspaceId,
      OR: [{ id: { in: validIds } }, { archivedRootId: { in: validIds } }],
    },
  });
  logger.info("[TRASH] bulkDelete", {
    workspaceId,
    requested: ids.length,
    deleted: result.count,
  });
  return { deletedCount: result.count };
}

export interface EmptyTrashSyncInput {
  workspaceId: string;
}

/**
 * Synchronous empty for small trashes (≤ EMPTY_SYNC_MAX). Above that,
 * the route handler (Task 7) catches `TRASH_TOO_LARGE` and queues a
 * BullMQ job (Task 4bis).
 */
export async function emptyTrashSync({
  workspaceId,
}: EmptyTrashSyncInput): Promise<{ deletedCount: number }> {
  const count = await prisma.page.count({
    where: { workspaceId, isArchived: true },
  });
  if (count > EMPTY_SYNC_MAX) {
    throw new Error("TRASH_TOO_LARGE");
  }

  const archivedPages = await prisma.page.findMany({
    where: { workspaceId, isArchived: true },
    select: { id: true },
  });
  await cleanupEmbeddingsForPages(archivedPages.map((p) => p.id));

  logger.warn("[AUDIT] PAGE_PERMANENTLY_DELETED", {
    workspaceId,
    action: "empty_trash_sync",
    count,
  });
  const result = await prisma.page.deleteMany({
    where: { workspaceId, isArchived: true },
  });
  logger.info("[TRASH] emptyTrashSync", { workspaceId, deleted: result.count });
  return { deletedCount: result.count };
}

/**
 * GDPR retention — hard-deletes every page whose `archivedAt` is older than
 * `TRASH_RETENTION_DAYS`. Runs in batches (cron-friendly) to keep lock footprint
 * low and yield the DB pool between batches.
 */
export async function purgeOlderThan30Days(): Promise<{ deletedCount: number }> {
  const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 3600 * 1000);
  let totalDeleted = 0;

  // Loop until a batch comes back smaller than the batch size — then we're done.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const batch = await prisma.page.findMany({
      where: { isArchived: true, archivedAt: { lt: cutoff } },
      select: { id: true },
      take: PURGE_BATCH_SIZE,
    });
    if (batch.length === 0) break;

    const batchIds = batch.map((p) => p.id);
    await cleanupEmbeddingsForPages(batchIds);

    const result = await prisma.page.deleteMany({
      where: { id: { in: batchIds } },
    });
    totalDeleted += result.count;
    logger.info("[TRASH] purge batch", { batch: result.count, total: totalDeleted });

    if (batch.length < PURGE_BATCH_SIZE) break;
    // Yield the pool so other requests can interleave between batches.
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  logger.info("[TRASH] purgeOlderThan30Days", {
    cutoff: cutoff.toISOString(),
    totalDeleted,
  });
  return { deletedCount: totalDeleted };
}

/**
 * Recursively collects all descendant page IDs under `rootId`.
 * Security: filters `workspace_id` in BOTH branches of the CTE to prevent
 * cross-workspace IDOR via a crafted parent_id chain.
 */
async function collectDescendantIds(
  tx: Prisma.TransactionClient,
  rootId: string,
  workspaceId: string,
): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE tree AS (
      SELECT id, 1 AS depth FROM "pages"
        WHERE parent_id = ${rootId}::uuid
          AND workspace_id = ${workspaceId}::uuid
          AND is_archived = false
      UNION ALL
      SELECT p.id, t.depth + 1 FROM "pages" p
        INNER JOIN tree t ON p.parent_id = t.id
        WHERE p.workspace_id = ${workspaceId}::uuid
          AND p.is_archived = false
          AND t.depth < ${MAX_CASCADE_DEPTH}
    )
    SELECT id FROM tree LIMIT ${MAX_CASCADE_NODES + 1}
  `;
  return rows.map((r) => r.id);
}
