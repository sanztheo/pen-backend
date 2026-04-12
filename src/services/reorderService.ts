/**
 * Reorder Service — shared logic for sidebar organization
 * Used by: organization tools (AI agent) + POST /reorder (frontend drag & drop)
 */
import { prisma } from "../lib/prisma.js";
import { logger } from "../utils/logger.js";

export class ReorderServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ReorderServiceError";
  }
}

// ============================================================================
// CYCLE DETECTION — single CTE query, O(1) roundtrip
// ============================================================================

export async function detectCycle(
  projectId: string,
  targetParentId: string,
  workspaceId: string,
): Promise<boolean> {
  if (projectId === targetParentId) return true;
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id FROM projects
      WHERE id = ${targetParentId}::uuid AND workspace_id = ${workspaceId}::uuid
      UNION ALL
      SELECT p.id, p.parent_id FROM projects p
      INNER JOIN ancestors a ON p.id = a.parent_id
    )
    SELECT id FROM ancestors WHERE id = ${projectId}::uuid LIMIT 1
  `;
  return rows.length > 0;
}

async function detectPageCycle(
  pageId: string,
  targetParentPageId: string,
  workspaceId: string,
): Promise<boolean> {
  if (pageId === targetParentPageId) return true;
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id FROM pages
      WHERE id = ${targetParentPageId}::uuid AND workspace_id = ${workspaceId}::uuid
      UNION ALL
      SELECT p.id, p.parent_id FROM pages p
      INNER JOIN ancestors a ON p.id = a.parent_id
    )
    SELECT id FROM ancestors WHERE id = ${pageId}::uuid LIMIT 1
  `;
  return rows.length > 0;
}

// ============================================================================
// POSITION HELPERS — bulk SQL, 1 query instead of N
// ============================================================================

async function normalizePagePositions(
  projectId: string | null,
  parentId: string | null,
  workspaceId: string,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE pages SET position = sub.rn
    FROM (
      SELECT id, (ROW_NUMBER() OVER (ORDER BY position) - 1)::int AS rn
      FROM pages
      WHERE project_id IS NOT DISTINCT FROM ${projectId}::uuid
        AND parent_id IS NOT DISTINCT FROM ${parentId}::uuid
        AND workspace_id = ${workspaceId}::uuid
        AND is_archived = false
    ) sub
    WHERE pages.id = sub.id AND pages.position != sub.rn
  `;
}

async function normalizeProjectPositions(
  parentId: string | null,
  workspaceId: string,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE projects SET position = sub.rn
    FROM (
      SELECT id, (ROW_NUMBER() OVER (ORDER BY position) - 1)::int AS rn
      FROM projects
      WHERE parent_id IS NOT DISTINCT FROM ${parentId}::uuid
        AND workspace_id = ${workspaceId}::uuid
        AND is_archived = false
    ) sub
    WHERE projects.id = sub.id AND projects.position != sub.rn
  `;
}

// ============================================================================
// MOVE OPERATIONS — atomic transactions
// ============================================================================

export interface MovePageParams {
  pageId: string;
  targetProjectId?: string | null;
  targetParentPageId?: string | null;
  position?: number;
  workspaceId: string;
}

export async function movePage(params: MovePageParams): Promise<{ movedCount: number }> {
  const { pageId, workspaceId } = params;
  const targetParentPageId = params.targetParentPageId;
  let targetProjectId = params.targetProjectId;

  // --- Validation (read-only, outside transaction) ---
  const page = await prisma.page.findFirst({
    where: { id: pageId, workspaceId, isArchived: false },
    select: { id: true, projectId: true, parentId: true },
  });
  if (!page) throw new ReorderServiceError("PAGE_NOT_FOUND", "Page not found in workspace");

  let newParentId: string | null = targetParentPageId ?? null;
  let newProjectId: string | null;

  if (targetParentPageId) {
    const parent = await prisma.page.findFirst({
      where: { id: targetParentPageId, workspaceId, isArchived: false },
      select: { id: true, projectId: true },
    });
    if (!parent)
      throw new ReorderServiceError("PARENT_PAGE_NOT_FOUND", "Target parent page not found");
    if (targetProjectId && parent.projectId && targetProjectId !== parent.projectId) {
      throw new ReorderServiceError(
        "INCONSISTENT_TARGETS",
        `Parent page belongs to project ${parent.projectId}, but targetProjectId is ${targetProjectId}`,
      );
    }
    newProjectId = parent.projectId;
    if (await detectPageCycle(pageId, targetParentPageId, workspaceId)) {
      throw new ReorderServiceError(
        "CYCLE_DETECTED",
        "Cannot move a page under itself or its descendant",
      );
    }
  } else if (targetProjectId !== undefined) {
    newProjectId = targetProjectId ?? null;
    if (newProjectId) {
      const project = await prisma.project.findFirst({
        where: { id: newProjectId, workspaceId, isArchived: false },
        select: { id: true },
      });
      if (!project) throw new ReorderServiceError("PROJECT_NOT_FOUND", "Target project not found");
    }
  } else {
    newProjectId = page.projectId;
    newParentId = page.parentId;
  }

  const srcProjectId = page.projectId;
  const srcParentId = page.parentId;

  // --- Mutation (atomic transaction) ---
  const descendantCount = await prisma.$transaction(async (tx) => {
    let pos: number;
    if (params.position !== undefined) {
      await tx.page.updateMany({
        where: {
          projectId: newProjectId,
          parentId: newParentId,
          workspaceId,
          isArchived: false,
          position: { gte: params.position },
        },
        data: { position: { increment: 1 } },
      });
      pos = params.position;
    } else {
      const last = await tx.page.findFirst({
        where: { projectId: newProjectId, parentId: newParentId, workspaceId, isArchived: false },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      pos = (last?.position ?? -1) + 1;
    }

    await tx.page.update({
      where: { id: pageId },
      data: { projectId: newProjectId, parentId: newParentId, position: pos },
    });

    let descCount = 0;
    if (newProjectId !== srcProjectId) {
      if (newProjectId) {
        descCount = await tx.$executeRaw`
          WITH RECURSIVE tree AS (
            SELECT id FROM pages WHERE parent_id = ${pageId}::uuid AND workspace_id = ${workspaceId}::uuid
            UNION ALL
            SELECT p.id FROM pages p INNER JOIN tree t ON p.parent_id = t.id
          )
          UPDATE pages SET project_id = ${newProjectId}::uuid, updated_at = NOW() WHERE id IN (SELECT id FROM tree)
        `;
      } else {
        descCount = await tx.$executeRaw`
          WITH RECURSIVE tree AS (
            SELECT id FROM pages WHERE parent_id = ${pageId}::uuid AND workspace_id = ${workspaceId}::uuid
            UNION ALL
            SELECT p.id FROM pages p INNER JOIN tree t ON p.parent_id = t.id
          )
          UPDATE pages SET project_id = NULL, updated_at = NOW() WHERE id IN (SELECT id FROM tree)
        `;
      }
    }
    return descCount;
  });

  // Normalize source container (fill gap left by moved page)
  await normalizePagePositions(srcProjectId, srcParentId, workspaceId);

  logger.log(`[REORDER_SERVICE] movePage ${pageId}: ${descendantCount} descendants updated`);
  return { movedCount: 1 + descendantCount };
}

export interface MoveProjectParams {
  projectId: string;
  targetParentProjectId?: string | null;
  position?: number;
  workspaceId: string;
}

export async function moveProject(params: MoveProjectParams): Promise<void> {
  const { projectId, workspaceId } = params;
  const targetParentId = params.targetParentProjectId ?? null;

  const project = await prisma.project.findFirst({
    where: { id: projectId, workspaceId, isArchived: false },
    select: { id: true, parentId: true },
  });
  if (!project) throw new ReorderServiceError("PROJECT_NOT_FOUND", "Project not found");

  if (targetParentId) {
    const parent = await prisma.project.findFirst({
      where: { id: targetParentId, workspaceId, isArchived: false },
      select: { id: true },
    });
    if (!parent)
      throw new ReorderServiceError("PARENT_NOT_FOUND", "Target parent project not found");
    if (await detectCycle(projectId, targetParentId, workspaceId)) {
      throw new ReorderServiceError("CYCLE_DETECTED", "Cannot move project: would create a cycle");
    }
  }

  const srcParentId = project.parentId;

  // Atomic: shift + update
  await prisma.$transaction(async (tx) => {
    let pos: number;
    if (params.position !== undefined) {
      await tx.project.updateMany({
        where: {
          parentId: targetParentId,
          workspaceId,
          isArchived: false,
          position: { gte: params.position },
        },
        data: { position: { increment: 1 } },
      });
      pos = params.position;
    } else {
      const last = await tx.project.findFirst({
        where: { parentId: targetParentId, workspaceId, isArchived: false },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      pos = (last?.position ?? -1) + 1;
    }
    await tx.project.update({
      where: { id: projectId },
      data: { parentId: targetParentId, position: pos },
    });
  });

  await normalizeProjectPositions(srcParentId, workspaceId);
  logger.log(`[REORDER_SERVICE] moveProject ${projectId}`);
}

export interface ReorderItemsParams {
  items: { id: string; type: "page" | "project"; position: number }[];
  workspaceId: string;
}

export async function reorderItems(params: ReorderItemsParams): Promise<void> {
  const { items, workspaceId } = params;
  const pageIds = items.filter((i) => i.type === "page").map((i) => i.id);
  const projectIds = items.filter((i) => i.type === "project").map((i) => i.id);

  if (pageIds.length > 0 && projectIds.length > 0) {
    throw new ReorderServiceError(
      "MIXED_TYPES",
      "Cannot reorder pages and projects in the same call",
    );
  }

  if (pageIds.length > 0) {
    const pages = await prisma.page.findMany({
      where: { id: { in: pageIds }, workspaceId, isArchived: false },
      select: { id: true, projectId: true, parentId: true },
      take: 50,
    });
    if (pages.length !== pageIds.length) {
      throw new ReorderServiceError("ITEMS_NOT_FOUND", "Some pages not found in workspace");
    }
    const containers = new Set(
      pages.map((p) => `${p.projectId ?? "null"}:${p.parentId ?? "null"}`),
    );
    if (containers.size > 1) {
      throw new ReorderServiceError("MIXED_CONTAINERS", "All pages must be in the same container");
    }
    await prisma.$transaction(
      items.map((item) =>
        prisma.page.update({ where: { id: item.id }, data: { position: item.position } }),
      ),
    );
  } else {
    const projects = await prisma.project.findMany({
      where: { id: { in: projectIds }, workspaceId, isArchived: false },
      select: { id: true, parentId: true },
      take: 50,
    });
    if (projects.length !== projectIds.length) {
      throw new ReorderServiceError("ITEMS_NOT_FOUND", "Some projects not found in workspace");
    }
    const containers = new Set(projects.map((p) => p.parentId ?? "null"));
    if (containers.size > 1) {
      throw new ReorderServiceError(
        "MIXED_CONTAINERS",
        "All projects must be in the same container",
      );
    }
    await prisma.$transaction(
      items.map((item) =>
        prisma.project.update({ where: { id: item.id }, data: { position: item.position } }),
      ),
    );
  }
  logger.log(`[REORDER_SERVICE] reorderItems: ${items.length} items`);
}

// ============================================================================
// ARCHIVE OPERATIONS — recursive CTE, O(1-2) queries
// ============================================================================

export async function archivePageTree(
  pageId: string,
  workspaceId: string,
): Promise<{ archivedCount: number; title: string }> {
  const page = await prisma.page.findFirst({
    where: { id: pageId, workspaceId, isArchived: false },
    select: { id: true, title: true },
  });
  if (!page) throw new ReorderServiceError("PAGE_NOT_FOUND", "Page not found in workspace");

  const count = await prisma.$executeRaw`
    WITH RECURSIVE tree AS (
      SELECT id FROM pages WHERE id = ${pageId}::uuid AND workspace_id = ${workspaceId}::uuid
      UNION ALL
      SELECT p.id FROM pages p INNER JOIN tree t ON p.parent_id = t.id
    )
    UPDATE pages SET is_archived = true, updated_at = NOW()
    WHERE id IN (SELECT id FROM tree) AND is_archived = false
  `;

  logger.log(`[REORDER_SERVICE] archivePageTree: ${count} pages archived (root: ${pageId})`);
  return { archivedCount: count, title: page.title };
}

export async function countProjectTreeItems(
  projectId: string,
  workspaceId: string,
): Promise<{ projectCount: number; pageCount: number; total: number }> {
  const result = await prisma.$queryRaw<[{ project_count: bigint; page_count: bigint }]>`
    WITH RECURSIVE tree AS (
      SELECT id FROM projects WHERE id = ${projectId}::uuid AND workspace_id = ${workspaceId}::uuid
      UNION ALL
      SELECT p.id FROM projects p INNER JOIN tree t ON p.parent_id = t.id
    )
    SELECT
      (SELECT COUNT(*)::bigint FROM tree) AS project_count,
      (SELECT COUNT(*)::bigint FROM pages WHERE project_id IN (SELECT id FROM tree)
        AND workspace_id = ${workspaceId}::uuid AND is_archived = false) AS page_count
  `;
  const pc = Number(result[0].project_count);
  const pgc = Number(result[0].page_count);
  return { projectCount: pc, pageCount: pgc, total: pc + pgc };
}

export async function archiveProjectTree(
  projectId: string,
  workspaceId: string,
): Promise<{ archivedCount: number; name: string }> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, workspaceId, isArchived: false },
    select: { id: true, name: true },
  });
  if (!project) throw new ReorderServiceError("PROJECT_NOT_FOUND", "Project not found");

  const [projectCount, pageCount] = await prisma.$transaction([
    prisma.$executeRaw`
      WITH RECURSIVE tree AS (
        SELECT id FROM projects WHERE id = ${projectId}::uuid AND workspace_id = ${workspaceId}::uuid
        UNION ALL
        SELECT p.id FROM projects p INNER JOIN tree t ON p.parent_id = t.id
      )
      UPDATE projects SET is_archived = true, updated_at = NOW()
      WHERE id IN (SELECT id FROM tree) AND is_archived = false
    `,
    prisma.$executeRaw`
      WITH RECURSIVE ptree AS (
        SELECT id FROM projects WHERE id = ${projectId}::uuid AND workspace_id = ${workspaceId}::uuid
        UNION ALL
        SELECT p.id FROM projects p INNER JOIN ptree t ON p.parent_id = t.id
      ),
      page_tree AS (
        SELECT id FROM pages WHERE project_id IN (SELECT id FROM ptree) AND workspace_id = ${workspaceId}::uuid
        UNION ALL
        SELECT p.id FROM pages p INNER JOIN page_tree t ON p.parent_id = t.id
      )
      UPDATE pages SET is_archived = true, updated_at = NOW()
      WHERE id IN (SELECT id FROM page_tree) AND is_archived = false
    `,
  ]);

  logger.log(`[REORDER_SERVICE] archiveProjectTree: ${projectCount} projects, ${pageCount} pages`);
  return { archivedCount: projectCount + pageCount, name: project.name };
}
