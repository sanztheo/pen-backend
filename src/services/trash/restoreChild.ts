/**
 * Restore a single child (page or sub-project) from within an archived
 * project tree. This also restores the root project so the child has a
 * live parent to return to — but leaves remaining siblings archived.
 *
 * Flow:
 * 1. Un-archive the root project (if still archived)
 * 2. Un-archive the selected child only
 * 3. Remaining siblings keep archivedRootId → still show in trash
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../utils/logger.js";
import { invalidateUserCaches } from "./cache.js";

interface RestoreChildInput {
  childId: string;
  childType: "page" | "project";
  workspaceId: string;
  userId?: string;
}

interface RestoreChildResult {
  restoredCount: number;
  parentProjectRestored: boolean;
  parentProjectId: string | null;
}

export async function restoreChildFromProject({
  childId,
  childType,
  workspaceId,
  userId,
}: RestoreChildInput): Promise<RestoreChildResult> {
  const result = await prisma.$transaction(
    async (tx) => {
      // 1. Find the child and its root
      let archivedRootId: string | null = null;

      if (childType === "page") {
        const child = await tx.page.findFirst({
          where: { id: childId, workspaceId, isArchived: true },
          select: { id: true, archivedRootId: true, archivedRootType: true },
        });
        if (!child?.archivedRootId || child.archivedRootType !== "project") {
          throw new Error("CHILD_NOT_IN_PROJECT_ARCHIVE");
        }
        archivedRootId = child.archivedRootId;
      } else {
        const child = await tx.project.findFirst({
          where: { id: childId, workspaceId, isArchived: true },
          select: { id: true, archivedRootId: true, archivedRootType: true },
        });
        if (!child?.archivedRootId || child.archivedRootType !== "project") {
          throw new Error("CHILD_NOT_IN_PROJECT_ARCHIVE");
        }
        archivedRootId = child.archivedRootId;
      }

      // 2. Un-archive the root project if still archived
      let parentRestored = false;
      const rootProject = await tx.project.findFirst({
        where: { id: archivedRootId, workspaceId },
        select: { id: true, isArchived: true, parentId: true, archivedPosition: true },
      });

      if (rootProject?.isArchived) {
        // Re-anchor to workspace root if original parent is gone/archived
        let targetParentId = rootProject.parentId;
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
        const targetPosition = (maxAtTarget._max.position ?? -1) + 1;

        await tx.project.update({
          where: { id: archivedRootId },
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
        parentRestored = true;
      }

      // 3. Un-archive the child only
      if (childType === "page") {
        await tx.page.update({
          where: { id: childId },
          data: {
            isArchived: false,
            archivedAt: null,
            archivedRootId: null,
            archivedRootType: null,
            archivedPosition: null,
          },
        });
      } else {
        await tx.project.update({
          where: { id: childId },
          data: {
            isArchived: false,
            archivedAt: null,
            archivedRootId: null,
            archivedRootType: null,
            archivedPosition: null,
          },
        });
      }

      logger.info("[TRASH] restoreChildFromProject", {
        childId,
        childType,
        rootProjectId: archivedRootId,
        parentRestored,
        workspaceId,
      });

      return {
        restoredCount: 1,
        parentProjectRestored: parentRestored,
        parentProjectId: archivedRootId,
      };
    },
    { isolationLevel: "Serializable" },
  );

  await invalidateUserCaches(userId);
  return result;
}
