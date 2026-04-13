/**
 * Trash subsystem — shared limits and retention constants.
 */
export const MAX_CASCADE_DEPTH = 100;
export const MAX_CASCADE_NODES = 10_000;
export const BULK_DELETE_MAX = 100;
// Beyond this threshold, emptyTrash is rerouted to the BullMQ worker.
export const EMPTY_SYNC_MAX = 500;
export const PURGE_BATCH_SIZE = 1000;
export const TRASH_RETENTION_DAYS = 30;
