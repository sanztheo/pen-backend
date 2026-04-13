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
