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
import { recordDeletionAudit } from "./auditService.js";

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
  const result = await prisma.$transaction(
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

  // Best-effort: clean up embeddings for archived pages (root + cascade descendants).
  // Runs AFTER the transaction commits so a tx rollback doesn't leave the vector
  // DB wiped with no matching archive on the Postgres side. Soft-fails on its
  // own — trash flow must never be blocked by a vector DB outage.
  // Why here and not only on permanent delete: pages in trash shouldn't return
  // RAG results, and embeddings waste vector DB storage for the full 30-day window.
  try {
    const archived = await prisma.page.findMany({
      where: {
        workspaceId,
        OR: [{ id: pageId }, { archivedRootId: pageId }],
      },
      select: { id: true },
    });
    await cleanupEmbeddingsForPages(archived.map((p) => p.id));
  } catch (e) {
    logger.error("[TRASH] post-archive embeddings cleanup failed", {
      pageId,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return result;
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
      // root so we never restore into an invalid tree location. The max-at-target
      // clamp below handles position assignment uniformly for both branches.
      if (targetParentId) {
        const parent = await tx.page.findFirst({
          where: { id: targetParentId, workspaceId, isArchived: false },
          select: { id: true },
        });
        if (!parent) {
          targetParentId = null;
        }
      }

      // Clamp targetPosition to current max + 1 at the destination. If user
      // archived at position 50 but siblings were deleted meanwhile, current
      // max may be 2 — restoring to 50 would leave a hole and a phantom slot.
      // Runs uniformly for original-parent and reanchor-to-root branches.
      const maxAtTarget = await tx.page.aggregate({
        where: { workspaceId, parentId: targetParentId, isArchived: false },
        _max: { position: true },
      });
      const currentMax = maxAtTarget._max.position ?? -1;
      targetPosition = Math.min(targetPosition, currentMax + 1);

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

      // Direct updateMany on the archivedRootId predicate — no need to fetch
      // the descendant id list into memory first. Saves holding 10k UUIDs in
      // the Serializable transaction on large cascades.
      const descendantsResult = await tx.page.updateMany({
        where: { archivedRootId: pageId, workspaceId },
        data: {
          isArchived: false,
          archivedAt: null,
          archivedRootId: null,
          archivedPosition: null,
        },
      });
      const descendantsCount = descendantsResult.count;

      logger.info("[TRASH] restoreCascade", {
        pageId,
        workspaceId,
        descendants: descendantsCount,
        reparentedToRoot: targetParentId === null && root.parentId !== null,
      });

      return { restoredCount: 1 + descendantsCount };
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
    // Index-friendly query: use `= ANY($1::text[])` so Postgres can use the
    // partial expression index `rag_source_page_id_idx` on
    // ((metadata->>'pageId')) WHERE source_type = 'WORKSPACE_PAGE'.
    // Previous impl used an OR array of JSON filters — O(N) query plan size,
    // no index usage, sequential scan of `rag_sources` every call.
    const sources = await prismaEmbeddings.$queryRaw<{ id: string }[]>`
      SELECT id FROM "rag_sources"
      WHERE source_type = 'WORKSPACE_PAGE'
        AND metadata->>'pageId' = ANY(${pageIds}::text[])
    `;
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
  userId?: string;
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
 *
 * Deletion order (critical for durability):
 *   1. Collect root + descendant ids
 *   2. Postgres deleteMany (source of truth — must succeed first)
 *   3. recordDeletionAudit (durable audit row — soft-fail)
 *   4. cleanupEmbeddingsForPages (best-effort vector DB cleanup — soft-fail)
 *
 * Rationale: if we cleaned embeddings before the Postgres delete and the
 * delete failed, we'd have orphaned Postgres rows with no embeddings.
 * By inverting the order we guarantee: Postgres is always the source of
 * truth, and worst-case failure leaves a few orphan embeddings (cleanable
 * by a later reconciliation job).
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

  // 1. Validate ownership — drop cross-workspace or non-root ids silently.
  const roots = await prisma.page.findMany({
    where: {
      id: { in: ids },
      workspaceId,
      isArchived: true,
      archivedRootId: null,
    },
    select: { id: true },
  });
  const validIds = roots.map((r) => r.id);
  if (validIds.length === 0) return { deletedCount: 0 };

  // 2. Collect descendants for audit + embeddings cleanup.
  const descendants = await prisma.page.findMany({
    where: { workspaceId, archivedRootId: { in: validIds } },
    select: { id: true },
  });
  const descendantIds = descendants.map((d) => d.id);
  const allPageIds = [...validIds, ...descendantIds];

  // 3. Atomic delete — Postgres is the source of truth.
  const result = await prisma.page.deleteMany({
    where: {
      workspaceId,
      OR: [{ id: { in: validIds } }, { archivedRootId: { in: validIds } }],
    },
  });

  // 4. After successful delete: durable audit row, then embeddings cleanup.
  await recordDeletionAudit({
    workspaceId,
    userId,
    action: "bulk_delete",
    rootIds: validIds,
    descendantIds,
  });
  await cleanupEmbeddingsForPages(allPageIds);

  logger.info("[TRASH] bulkDelete", {
    workspaceId,
    requested: ids.length,
    deleted: result.count,
  });
  return { deletedCount: result.count };
}

export interface EmptyTrashSyncInput {
  workspaceId: string;
  userId?: string;
}

/**
 * Synchronous empty for small trashes (≤ EMPTY_SYNC_MAX). Above that,
 * the route handler (Task 7) catches `TRASH_TOO_LARGE` and queues a
 * BullMQ job (Task 4bis).
 *
 * Deletion order (see bulkDelete for full rationale):
 *   1. Collect all archived ids (roots + descendants)
 *   2. Postgres deleteMany (source of truth)
 *   3. recordDeletionAudit (durable audit row)
 *   4. cleanupEmbeddingsForPages (best-effort)
 */
export async function emptyTrashSync({
  workspaceId,
  userId,
}: EmptyTrashSyncInput): Promise<{ deletedCount: number }> {
  // Pre-flight count to decide sync vs async route. The handler catches
  // TRASH_TOO_LARGE and reroutes to the BullMQ worker.
  const count = await prisma.page.count({
    where: { workspaceId, isArchived: true },
  });
  if (count > EMPTY_SYNC_MAX) {
    throw new Error("TRASH_TOO_LARGE");
  }
  if (count === 0) {
    return { deletedCount: 0 };
  }

  // Single round-trip DELETE ... RETURNING archived_root_id so we can split
  // roots/descendants for the audit row without a separate findMany. Replaces
  // the previous count + findMany + deleteMany (3 round-trips) with count + 1.
  const deleted = await prisma.$queryRaw<{ id: string; archived_root_id: string | null }[]>`
    DELETE FROM "pages"
    WHERE workspace_id = ${workspaceId}::uuid
      AND is_archived = true
    RETURNING id, archived_root_id
  `;

  const allPageIds = deleted.map((p) => p.id);
  const rootIds = deleted.filter((p) => p.archived_root_id === null).map((p) => p.id);
  const descendantIds = deleted.filter((p) => p.archived_root_id !== null).map((p) => p.id);

  // Durable audit row, then best-effort embeddings cleanup.
  await recordDeletionAudit({
    workspaceId,
    userId,
    action: "empty_trash_sync",
    rootIds,
    descendantIds,
  });
  await cleanupEmbeddingsForPages(allPageIds);

  logger.info("[TRASH] emptyTrashSync", { workspaceId, deleted: deleted.length });
  return { deletedCount: deleted.length };
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
      select: { id: true, workspaceId: true, archivedRootId: true },
      take: PURGE_BATCH_SIZE,
    });
    if (batch.length === 0) break;

    const batchIds = batch.map((p) => p.id);

    // 1. Delete first — Postgres is the source of truth.
    const result = await prisma.page.deleteMany({
      where: { id: { in: batchIds } },
    });

    // 2. Durable audit rows, grouped by workspace (cron spans all workspaces).
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

    // 3. Best-effort vector DB cleanup.
    await cleanupEmbeddingsForPages(batchIds);

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
