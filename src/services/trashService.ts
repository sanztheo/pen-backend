/**
 * Trash Service — barrel re-exports
 *
 * The implementation lives in `./trash/*` split by concern (archive, restore,
 * list, bulk delete, purge, etc.). This file exists to preserve the existing
 * `../services/trashService.js` import path used by controllers, jobs, tests.
 */
export { archiveCascade, restoreCascade } from "./trash/archivePage.js";
export { archiveProjectCascade, restoreProjectCascade } from "./trash/archiveProject.js";
export { restoreChildFromProject } from "./trash/restoreChild.js";
export { listTrash, listTrashChildren } from "./trash/list.js";
export { bulkDelete } from "./trash/bulkDelete.js";
export { emptyTrashSync } from "./trash/emptyTrash.js";
export { purgeOlderThan30Days } from "./trash/purge.js";
export { cleanupEmbeddingsForPages } from "./trash/embeddings.js";
export {
  MAX_CASCADE_DEPTH,
  MAX_CASCADE_NODES,
  BULK_DELETE_MAX,
  EMPTY_SYNC_MAX,
  PURGE_BATCH_SIZE,
  TRASH_RETENTION_DAYS,
} from "./trash/constants.js";
export type {
  ArchiveCascadeInput,
  ArchiveCascadeResult,
  RestoreCascadeInput,
  RestoreCascadeResult,
  ArchiveProjectCascadeInput,
  ArchiveProjectCascadeResult,
  RestoreProjectCascadeInput,
  RestoreProjectCascadeResult,
  ListTrashCursor,
  ListTrashInput,
  ListTrashItem,
  ListTrashResult,
  BulkDeleteInput,
  BulkDeleteResult,
  EmptyTrashSyncInput,
  TrashEntityType,
} from "./trash/types.js";
