/**
 * Trash subsystem — shared types.
 *
 * `TrashEntityType` discriminates rows returned by `listTrash` and drives
 * frontend rendering (icon, restore endpoint). The archived_root_type column
 * on pages/projects uses the same values — keep them in sync.
 */
export type TrashEntityType = "page" | "project";

export interface ArchiveCascadeInput {
  pageId: string;
  workspaceId: string;
  userId?: string;
}

export interface ArchiveCascadeResult {
  archivedCount: number;
}

export interface RestoreCascadeInput {
  pageId: string;
  workspaceId: string;
  userId?: string;
}

export interface RestoreCascadeResult {
  restoredCount: number;
}

export interface ArchiveProjectCascadeInput {
  projectId: string;
  workspaceId: string;
  userId?: string;
}

export interface ArchiveProjectCascadeResult {
  archivedProjects: number;
  archivedPages: number;
}

export interface RestoreProjectCascadeInput {
  projectId: string;
  workspaceId: string;
  userId?: string;
}

export interface RestoreProjectCascadeResult {
  restoredProjects: number;
  restoredPages: number;
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
  type: TrashEntityType;
}

export interface ListTrashResult {
  items: ListTrashItem[];
  nextCursor: ListTrashCursor | null;
}

export interface BulkDeleteInput {
  workspaceId: string;
  ids: string[];
  userId?: string;
}

export interface BulkDeleteResult {
  deletedCount: number;
}

export interface EmptyTrashSyncInput {
  workspaceId: string;
  userId?: string;
}
