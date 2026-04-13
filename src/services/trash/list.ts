import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import type { ListTrashInput, ListTrashItem, ListTrashResult, TrashEntityType } from "./types.js";

interface TrashRowRaw {
  id: string;
  title: string;
  icon: string | null;
  archived_at: Date | null;
  parent_id: string | null;
  parent_title: string | null;
  type: TrashEntityType;
}

/**
 * Paginated trash listing. Returns archived roots (archivedRootId=null) from
 * BOTH pages and projects tables via UNION ALL, so a user can see their
 * top-level trash entries in a single list discriminated by `type`.
 *
 * Cursor: composite (archivedAt, id) for stable pagination on batch archives.
 */
export async function listTrash({
  workspaceId,
  cursor,
  take = 50,
}: ListTrashInput): Promise<ListTrashResult> {
  const pageSize = Math.min(Math.max(take, 1), 100);

  const cursorClause = cursor
    ? Prisma.sql`WHERE (archived_at, id) < (${new Date(cursor.archivedAt)}::timestamptz, ${cursor.id}::uuid)`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<TrashRowRaw[]>`
    WITH trash_union AS (
      SELECT
        p.id,
        p.title,
        p.icon,
        p.archived_at,
        p.parent_id,
        (SELECT title FROM "pages" WHERE id = p.parent_id) AS parent_title,
        'page'::text AS type
      FROM "pages" p
      WHERE p.workspace_id = ${workspaceId}::uuid
        AND p.is_archived = true
        AND p.archived_root_id IS NULL
      UNION ALL
      SELECT
        pr.id,
        pr.name AS title,
        NULL::varchar AS icon,
        pr.archived_at,
        pr.parent_id,
        (SELECT name FROM "projects" WHERE id = pr.parent_id) AS parent_title,
        'project'::text AS type
      FROM "projects" pr
      WHERE pr.workspace_id = ${workspaceId}::uuid
        AND pr.is_archived = true
        AND pr.archived_root_id IS NULL
      UNION ALL
      -- Ghost projects: already restored but still have archived children.
      -- Shown so user can restore remaining children via "restore folder".
      SELECT
        gp.id,
        gp.name AS title,
        NULL::varchar AS icon,
        (SELECT MAX(sub.archived_at) FROM (
          SELECT archived_at FROM "pages" WHERE archived_root_id = gp.id AND is_archived = true
          UNION ALL
          SELECT archived_at FROM "projects" WHERE archived_root_id = gp.id AND is_archived = true
        ) sub) AS archived_at,
        gp.parent_id,
        (SELECT name FROM "projects" WHERE id = gp.parent_id) AS parent_title,
        'project'::text AS type
      FROM "projects" gp
      WHERE gp.workspace_id = ${workspaceId}::uuid
        AND gp.is_archived = false
        AND EXISTS (
          SELECT 1 FROM "pages" WHERE archived_root_id = gp.id AND is_archived = true
          UNION ALL
          SELECT 1 FROM "projects" WHERE archived_root_id = gp.id AND is_archived = true
        )
    )
    SELECT * FROM trash_union
    ${cursorClause}
    ORDER BY archived_at DESC, id DESC
    LIMIT ${pageSize + 1}
  `;

  const hasMore = rows.length > pageSize;
  const trimmed = hasMore ? rows.slice(0, -1) : rows;
  const items: ListTrashItem[] = trimmed.map((row) => ({
    id: row.id,
    title: row.title,
    icon: row.icon,
    archivedAt: row.archived_at,
    parentId: row.parent_id,
    parent: row.parent_title ? { title: row.parent_title } : null,
    type: row.type,
  }));
  const last = trimmed[trimmed.length - 1];
  return {
    items,
    nextCursor:
      hasMore && last?.archived_at
        ? { archivedAt: last.archived_at.toISOString(), id: last.id }
        : null,
  };
}

/**
 * Returns the direct descendants of a trash root (used by the popover's
 * expand-a-folder feature). Both page-rooted and project-rooted cascades
 * are supported — the caller passes the root id and the matching type is
 * looked up automatically via `archivedRootId`.
 *
 * The query returns a flat list of projects + pages, ordered by type
 * (projects first) then title. The UI renders them indented under the root.
 */
export async function listTrashChildren({
  workspaceId,
  rootId,
}: {
  workspaceId: string;
  rootId: string;
}): Promise<ListTrashItem[]> {
  const rows = await prisma.$queryRaw<TrashRowRaw[]>`
    SELECT
      pr.id,
      pr.name AS title,
      NULL::varchar AS icon,
      pr.archived_at,
      pr.parent_id,
      (SELECT name FROM "projects" WHERE id = pr.parent_id) AS parent_title,
      'project'::text AS type
    FROM "projects" pr
    WHERE pr.workspace_id = ${workspaceId}::uuid
      AND pr.is_archived = true
      AND pr.archived_root_id = ${rootId}::uuid
    UNION ALL
    SELECT
      p.id,
      p.title,
      p.icon,
      p.archived_at,
      p.parent_id,
      (SELECT title FROM "pages" WHERE id = p.parent_id) AS parent_title,
      'page'::text AS type
    FROM "pages" p
    WHERE p.workspace_id = ${workspaceId}::uuid
      AND p.is_archived = true
      AND p.archived_root_id = ${rootId}::uuid
    ORDER BY type ASC, title ASC
  `;

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    icon: row.icon,
    archivedAt: row.archived_at,
    parentId: row.parent_id,
    parent: row.parent_title ? { title: row.parent_title } : null,
    type: row.type,
  }));
}
