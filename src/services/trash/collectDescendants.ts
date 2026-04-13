import { Prisma } from "@prisma/client";
import { MAX_CASCADE_DEPTH, MAX_CASCADE_NODES } from "./constants.js";

/**
 * Recursively collects all descendant page IDs under `rootId`.
 * Security: filters `workspace_id` in BOTH branches of the CTE to prevent
 * cross-workspace IDOR via a crafted parent_id chain.
 */
export async function collectDescendantPageIds(
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

/**
 * Collects every descendant of a project root (used by archiveProjectCascade):
 * - All descendant projects via `projects.parent_id` recursion
 * - All non-archived pages inside those projects
 * - All non-archived sub-pages reachable via `pages.parent_id` from those pages
 *
 * Throws "TREE_TOO_LARGE" if total nodes exceed MAX_CASCADE_NODES.
 * The `parent_id` frontier loop on pages exists as belt-and-suspenders for
 * pages whose `project_id` is null but whose parent page lives in the project.
 */
export async function collectProjectDescendants(
  tx: Prisma.TransactionClient,
  rootProjectId: string,
  workspaceId: string,
): Promise<{ projectIds: string[]; pageIds: string[] }> {
  // 1) Descendant projects via CTE recursion on parent_id
  const childProjects = await tx.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE project_tree AS (
      SELECT id, 1 AS depth FROM "projects"
        WHERE parent_id = ${rootProjectId}::uuid
          AND workspace_id = ${workspaceId}::uuid
          AND is_archived = false
      UNION ALL
      SELECT p.id, t.depth + 1 FROM "projects" p
        INNER JOIN project_tree t ON p.parent_id = t.id
        WHERE p.workspace_id = ${workspaceId}::uuid
          AND p.is_archived = false
          AND t.depth < ${MAX_CASCADE_DEPTH}
    )
    SELECT id FROM project_tree LIMIT ${MAX_CASCADE_NODES + 1}
  `;
  const descendantProjectIds = childProjects.map((p) => p.id);
  const allProjectIds = [rootProjectId, ...descendantProjectIds];

  if (descendantProjectIds.length > MAX_CASCADE_NODES) {
    throw new Error("TREE_TOO_LARGE");
  }

  // 2) Direct pages whose project_id is in the tree
  const directPages = await tx.page.findMany({
    where: {
      workspaceId,
      isArchived: false,
      projectId: { in: allProjectIds },
    },
    select: { id: true },
  });

  const pageIds = new Set<string>(directPages.map((p) => p.id));
  let frontier = Array.from(pageIds);

  // 3) Frontier loop — catch sub-pages whose project_id might be null
  //    but whose parent_id chain leads back into the archived project.
  while (frontier.length > 0) {
    const children = await tx.page.findMany({
      where: {
        workspaceId,
        isArchived: false,
        parentId: { in: frontier },
        id: { notIn: Array.from(pageIds) },
      },
      select: { id: true },
    });
    if (children.length === 0) break;
    frontier = children.map((c) => c.id);
    for (const id of frontier) pageIds.add(id);
    if (pageIds.size > MAX_CASCADE_NODES) {
      throw new Error("TREE_TOO_LARGE");
    }
  }

  return { projectIds: descendantProjectIds, pageIds: Array.from(pageIds) };
}
