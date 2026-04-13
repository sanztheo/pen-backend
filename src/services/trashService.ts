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
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { logger } from "../utils/logger.js";

const MAX_CASCADE_DEPTH = 100;
const MAX_CASCADE_NODES = 10_000;

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
  return prisma.$transaction(async (tx) => {
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
        NOT: { id: root.id },
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
  });
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
    SELECT id FROM tree
  `;
  return rows.map((r) => r.id);
}
