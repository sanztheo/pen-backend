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
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../utils/logger.js";
import { invalidateUserCaches } from "./cache.js";
import { MAX_CASCADE_DEPTH, MAX_CASCADE_NODES } from "./constants.js";

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

      // 3. Un-archive the child.
      //    - For a page: single update (no descendants tracked on pages).
      //    - For a project: cascade over the full sub-tree so restoring a
      //      sub-folder also restores its own pages and sub-projects.
      //      Without this, sub-folder restore returns an empty folder.
      let restoredCount = 1;

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
        // Collect the archived sub-tree under `childId` that was archived
        // together with the original root (same archivedRootId). We walk the
        // archived rows via parent_id / project_id chains — the hierarchy
        // columns are preserved at archive time, only the is_archived flag
        // changes.
        const subProjectRows = await tx.$queryRaw<{ id: string }[]>`
          WITH RECURSIVE sub_project_tree AS (
            SELECT id, 1 AS depth FROM "projects"
              WHERE parent_id = ${childId}::uuid
                AND workspace_id = ${workspaceId}::uuid
                AND is_archived = true
                AND archived_root_id = ${archivedRootId}::uuid
            UNION ALL
            SELECT p.id, t.depth + 1 FROM "projects" p
              INNER JOIN sub_project_tree t ON p.parent_id = t.id
              WHERE p.workspace_id = ${workspaceId}::uuid
                AND p.is_archived = true
                AND p.archived_root_id = ${archivedRootId}::uuid
                AND t.depth < ${MAX_CASCADE_DEPTH}
          )
          SELECT id FROM sub_project_tree LIMIT ${MAX_CASCADE_NODES + 1}
        `;
        const subProjectIds = subProjectRows.map((r) => r.id);
        if (subProjectIds.length > MAX_CASCADE_NODES) {
          throw new Error("TREE_TOO_LARGE");
        }
        const allProjectIds = [childId, ...subProjectIds];

        const subPageRows = await tx.$queryRaw<{ id: string }[]>`
          WITH RECURSIVE sub_page_tree AS (
            SELECT id, 1 AS depth FROM "pages"
              WHERE project_id = ANY(${allProjectIds}::uuid[])
                AND workspace_id = ${workspaceId}::uuid
                AND is_archived = true
                AND archived_root_id = ${archivedRootId}::uuid
            UNION ALL
            SELECT p.id, t.depth + 1 FROM "pages" p
              INNER JOIN sub_page_tree t ON p.parent_id = t.id
              WHERE p.workspace_id = ${workspaceId}::uuid
                AND p.is_archived = true
                AND p.archived_root_id = ${archivedRootId}::uuid
                AND t.depth < ${MAX_CASCADE_DEPTH}
          )
          SELECT id FROM sub_page_tree LIMIT ${MAX_CASCADE_NODES + 1}
        `;
        const subPageIds = subPageRows.map((r) => r.id);
        if (subPageIds.length > MAX_CASCADE_NODES) {
          throw new Error("TREE_TOO_LARGE");
        }

        const projectUpdate = await tx.project.updateMany({
          where: {
            id: { in: allProjectIds },
            workspaceId,
            isArchived: true,
          },
          data: {
            isArchived: false,
            archivedAt: null,
            archivedRootId: null,
            archivedRootType: null,
            archivedPosition: null,
          },
        });

        const pageUpdate =
          subPageIds.length > 0
            ? await tx.page.updateMany({
                where: {
                  id: { in: subPageIds },
                  workspaceId,
                  isArchived: true,
                },
                data: {
                  isArchived: false,
                  archivedAt: null,
                  archivedRootId: null,
                  archivedRootType: null,
                  archivedPosition: null,
                },
              })
            : { count: 0 };

        restoredCount = projectUpdate.count + pageUpdate.count;
      }

      logger.info("[TRASH] restoreChildFromProject", {
        childId,
        childType,
        rootProjectId: archivedRootId,
        parentRestored,
        restoredCount,
        workspaceId,
      });

      return {
        restoredCount,
        parentProjectRestored: parentRestored,
        parentProjectId: archivedRootId,
      };
    },
    { isolationLevel: "Serializable" },
  );

  await invalidateUserCaches(userId);
  return result;
}
