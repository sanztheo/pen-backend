/**
 * Page archive/restore with cascade on the page hierarchy only.
 * Project-rooted archives live in `archiveProject.ts`.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../utils/logger.js";
import { invalidateUserCaches } from "./cache.js";
import { cleanupEmbeddingsForPages } from "./embeddings.js";
import { collectDescendantPageIds } from "./collectDescendants.js";
import { MAX_CASCADE_NODES } from "./constants.js";
import type {
  ArchiveCascadeInput,
  ArchiveCascadeResult,
  RestoreCascadeInput,
  RestoreCascadeResult,
} from "./types.js";

export async function archiveCascade({
  pageId,
  workspaceId,
  userId,
}: ArchiveCascadeInput): Promise<ArchiveCascadeResult> {
  // Serializable isolation — prevents two issues:
  // 1. Concurrent archives at the same parent both decrementing positions stale-read style
  // 2. New child inserted between CTE snapshot and updateMany, becoming an orphan
  // Postgres raises serialization_failure on conflict — caller must retry.
  const result = await prisma.$transaction(
    async (tx) => {
      const root = await tx.page.findFirst({
        where: { id: pageId, workspaceId, isArchived: false },
        select: { id: true, parentId: true, position: true },
      });
      if (!root) {
        throw new Error("PAGE_NOT_FOUND_OR_ALREADY_ARCHIVED");
      }

      const descendantIds = await collectDescendantPageIds(tx, pageId, workspaceId);
      if (descendantIds.length > MAX_CASCADE_NODES) {
        throw new Error("TREE_TOO_LARGE");
      }

      const now = new Date();

      await tx.page.update({
        where: { id: pageId },
        data: {
          isArchived: true,
          archivedAt: now,
          archivedRootId: null,
          archivedRootType: null,
          archivedPosition: root.position,
        },
      });

      // Close the visual gap left behind by decrementing later siblings.
      await tx.page.updateMany({
        where: {
          workspaceId,
          parentId: root.parentId,
          isArchived: false,
          position: { gt: root.position },
        },
        data: { position: { decrement: 1 } },
      });

      // Tag descendants with archivedRootType="page" — disambiguates from
      // project-rooted cascades since archivedRootId is polymorphic.
      if (descendantIds.length > 0) {
        await tx.page.updateMany({
          where: { id: { in: descendantIds }, workspaceId, isArchived: false },
          data: {
            isArchived: true,
            archivedAt: now,
            archivedRootId: pageId,
            archivedRootType: "page",
          },
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

  // Post-commit embeddings cleanup. Runs after the tx so a rollback doesn't
  // leave the vector DB wiped with no matching archive. Soft-fails.
  try {
    const archived = await prisma.page.findMany({
      where: {
        workspaceId,
        OR: [{ id: pageId }, { archivedRootId: pageId, archivedRootType: "page" }],
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

  await invalidateUserCaches(userId);
  return result;
}

/**
 * Restores a page from the trash, putting it back at its original sibling
 * position (or at the workspace root if the original parent is gone). All
 * cascade-archived descendants (archivedRootType="page") are un-archived too.
 *
 * If the page is a descendant of a project archive (archivedRootType="project"),
 * delegates to restoreChildFromProject which also restores the parent project.
 */
export async function restoreCascade({
  pageId,
  workspaceId,
  userId,
}: RestoreCascadeInput): Promise<RestoreCascadeResult> {
  // Check if this is a child page inside a project archive — delegate if so.
  const maybChild = await prisma.page.findFirst({
    where: { id: pageId, workspaceId, isArchived: true },
    select: { archivedRootId: true, archivedRootType: true },
  });
  if (maybChild?.archivedRootId && maybChild.archivedRootType === "project") {
    const { restoreChildFromProject } = await import("./restoreChild.js");
    const childResult = await restoreChildFromProject({
      childId: pageId,
      childType: "page",
      workspaceId,
      userId,
    });
    return { restoredCount: childResult.restoredCount };
  }

  const result = await prisma.$transaction(
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

      // Re-anchor to workspace root if original parent vanished / was archived.
      if (targetParentId) {
        const parent = await tx.page.findFirst({
          where: { id: targetParentId, workspaceId, isArchived: false },
          select: { id: true },
        });
        if (!parent) {
          targetParentId = null;
        }
      }

      // Clamp targetPosition to current max + 1 — avoids phantom slots if
      // siblings were deleted between archive and restore.
      const maxAtTarget = await tx.page.aggregate({
        where: { workspaceId, parentId: targetParentId, isArchived: false },
        _max: { position: true },
      });
      const currentMax = maxAtTarget._max.position ?? -1;
      targetPosition = Math.min(targetPosition, currentMax + 1);

      // Shift +1 siblings at or beyond targetPosition.
      await tx.$executeRaw(Prisma.sql`
        UPDATE "pages"
           SET position = position + 1
         WHERE workspace_id = ${workspaceId}::uuid
           AND ${
             targetParentId
               ? Prisma.sql`parent_id = ${targetParentId}::uuid`
               : Prisma.sql`parent_id IS NULL`
           }
           AND is_archived = false
           AND position >= ${targetPosition}
      `);

      await tx.page.update({
        where: { id: pageId },
        data: {
          isArchived: false,
          archivedAt: null,
          archivedRootId: null,
          archivedRootType: null,
          archivedPosition: null,
          parentId: targetParentId,
          position: targetPosition,
        },
      });

      // Un-archive page-rooted descendants only. Project-rooted cascades
      // belong to restoreProjectCascade.
      const descendantsResult = await tx.page.updateMany({
        where: { archivedRootId: pageId, archivedRootType: "page", workspaceId },
        data: {
          isArchived: false,
          archivedAt: null,
          archivedRootId: null,
          archivedRootType: null,
          archivedPosition: null,
        },
      });

      logger.info("[TRASH] restoreCascade", {
        pageId,
        workspaceId,
        descendants: descendantsResult.count,
        reparentedToRoot: targetParentId === null && root.parentId !== null,
      });

      return { restoredCount: 1 + descendantsResult.count };
    },
    { isolationLevel: "Serializable" },
  );

  await invalidateUserCaches(userId);
  return result;
}
