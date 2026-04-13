/**
 * Project (folder) archive/restore with cascade across projects + pages.
 *
 * Why: `prisma.project.delete()` cascade-wipes children via FK — users lose
 * data irrecoverably. Instead, archive marks root + every descendant project
 * and page with `archivedRootId = root.id, archivedRootType = "project"`.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../utils/logger.js";
import { invalidateUserCaches } from "./cache.js";
import { cleanupEmbeddingsForPages } from "./embeddings.js";
import { collectProjectDescendants } from "./collectDescendants.js";
import type {
  ArchiveProjectCascadeInput,
  ArchiveProjectCascadeResult,
  RestoreProjectCascadeInput,
  RestoreProjectCascadeResult,
} from "./types.js";

export async function archiveProjectCascade({
  projectId,
  workspaceId,
  userId,
}: ArchiveProjectCascadeInput): Promise<ArchiveProjectCascadeResult> {
  const result = await prisma.$transaction(
    async (tx) => {
      const root = await tx.project.findFirst({
        where: { id: projectId, workspaceId, isArchived: false },
        select: { id: true, parentId: true, position: true },
      });
      if (!root) {
        throw new Error("PROJECT_NOT_FOUND_OR_ALREADY_ARCHIVED");
      }

      const { projectIds: descProjectIds, pageIds: descPageIds } = await collectProjectDescendants(
        tx,
        projectId,
        workspaceId,
      );

      const now = new Date();

      // 1) Mark root project archived. archivedRootId=null marks it as the
      //    cascade root so listTrash surfaces it at top level.
      await tx.project.update({
        where: { id: projectId },
        data: {
          isArchived: true,
          archivedAt: now,
          archivedRootId: null,
          archivedRootType: null,
          archivedPosition: root.position,
        },
      });

      // 2) Close sibling gap at the root's former level (same pattern as page archive).
      await tx.project.updateMany({
        where: {
          workspaceId,
          parentId: root.parentId,
          isArchived: false,
          position: { gt: root.position },
        },
        data: { position: { decrement: 1 } },
      });

      // 3) Cascade: tag descendant projects
      if (descProjectIds.length > 0) {
        await tx.project.updateMany({
          where: { id: { in: descProjectIds }, workspaceId },
          data: {
            isArchived: true,
            archivedAt: now,
            archivedRootId: projectId,
            archivedRootType: "project",
          },
        });
      }

      // 4) Cascade: tag descendant pages (belonging to the archived projects)
      if (descPageIds.length > 0) {
        await tx.page.updateMany({
          where: { id: { in: descPageIds }, workspaceId },
          data: {
            isArchived: true,
            archivedAt: now,
            archivedRootId: projectId,
            archivedRootType: "project",
          },
        });
      }

      logger.info("[TRASH] archiveProjectCascade", {
        projectId,
        workspaceId,
        projects: 1 + descProjectIds.length,
        pages: descPageIds.length,
      });
      return {
        archivedProjects: 1 + descProjectIds.length,
        archivedPages: descPageIds.length,
      };
    },
    { isolationLevel: "Serializable" },
  );

  // Post-commit embeddings cleanup (pages tagged with this project root).
  try {
    const archived = await prisma.page.findMany({
      where: {
        workspaceId,
        archivedRootId: projectId,
        archivedRootType: "project",
      },
      select: { id: true },
    });
    await cleanupEmbeddingsForPages(archived.map((p) => p.id));
  } catch (e) {
    logger.error("[TRASH] post-archiveProject embeddings cleanup failed", {
      projectId,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  await invalidateUserCaches(userId);
  return result;
}

/**
 * Restores a project from the trash. Project + descendant projects + pages
 * are all un-archived. Re-anchors to workspace root if the original parent
 * project is gone.
 */
export async function restoreProjectCascade({
  projectId,
  workspaceId,
  userId,
}: RestoreProjectCascadeInput): Promise<RestoreProjectCascadeResult> {
  const result = await prisma.$transaction(
    async (tx) => {
      const root = await tx.project.findFirst({
        where: { id: projectId, workspaceId, isArchived: true, archivedRootId: null },
        select: { id: true, parentId: true, archivedPosition: true },
      });
      if (!root) {
        throw new Error("PROJECT_NOT_IN_TRASH");
      }

      let targetParentId = root.parentId;
      if (targetParentId) {
        const parent = await tx.project.findFirst({
          where: { id: targetParentId, workspaceId, isArchived: false },
          select: { id: true },
        });
        if (!parent) targetParentId = null;
      }

      const maxAtTarget = await tx.project.aggregate({
        where: { workspaceId, parentId: targetParentId, isArchived: false },
        _max: { position: true },
      });
      const currentMax = maxAtTarget._max.position ?? -1;
      const targetPosition = Math.min(root.archivedPosition ?? 0, currentMax + 1);

      await tx.$executeRaw(Prisma.sql`
        UPDATE "projects"
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

      await tx.project.update({
        where: { id: projectId },
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

      const projResult = await tx.project.updateMany({
        where: { archivedRootId: projectId, archivedRootType: "project", workspaceId },
        data: {
          isArchived: false,
          archivedAt: null,
          archivedRootId: null,
          archivedRootType: null,
          archivedPosition: null,
        },
      });

      const pageResult = await tx.page.updateMany({
        where: { archivedRootId: projectId, archivedRootType: "project", workspaceId },
        data: {
          isArchived: false,
          archivedAt: null,
          archivedRootId: null,
          archivedRootType: null,
          archivedPosition: null,
        },
      });

      logger.info("[TRASH] restoreProjectCascade", {
        projectId,
        workspaceId,
        projects: 1 + projResult.count,
        pages: pageResult.count,
        reparentedToRoot: targetParentId === null && root.parentId !== null,
      });

      return {
        restoredProjects: 1 + projResult.count,
        restoredPages: pageResult.count,
      };
    },
    { isolationLevel: "Serializable" },
  );

  await invalidateUserCaches(userId);
  return result;
}
