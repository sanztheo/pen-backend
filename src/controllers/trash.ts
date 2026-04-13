/**
 * HTTP handlers for the Corbeille (Trash) feature.
 *
 * Split out from controllers/page.ts (already > 1000 lines per backend
 * convention "fichiers < 300 lignes") to keep trash logic isolated and
 * easier to test in Task 8.
 *
 * Authorization model:
 * - `/pages/:id/archive` and `/pages/:id/restore` resolve workspaceId from
 *   the page row (loadPageWorkspaceOrThrow) then assert membership.
 * - `/pages/trash*` endpoints rely on `verifyWorkspaceAccess` middleware
 *   which reads workspaceId from query/body.
 *
 * Errors are funneled through `sendError` to return GENERIC codes (NOT_FOUND,
 * FORBIDDEN, INTERNAL) — never leak workspace existence or service-internal
 * messages.
 */
import type { Request, Response } from "express";
import { logger } from "../utils/logger.js";
import {
  archiveCascade,
  restoreCascade,
  listTrash,
  bulkDelete,
  emptyTrashSync,
} from "../services/trashService.js";
import { withSerializableRetry } from "../services/withSerializableRetry.js";
import { emptyTrashQueue } from "../jobs/emptyTrashJob.js";
import {
  listTrashQuerySchema,
  bulkDeleteBodySchema,
  emptyTrashBodySchema,
  pageIdParamSchema,
} from "../validators/trash.js";
import { loadPageWorkspaceForUserOrThrow, HttpError } from "../services/authzService.js";

function sendError(res: Response, e: unknown, op: string, ctx: Record<string, unknown>): Response {
  if (e instanceof HttpError) {
    // Security: collapse 403 (forbidden workspace) and 404 (missing page)
    // into a single generic NOT_FOUND response so the client cannot tell
    // whether a given page id exists in another workspace — otherwise this
    // endpoint leaks an enumeration oracle. Real reason is logged server-side.
    if (e.status === 403 || e.status === 404) {
      logger.info(`[TRASH] ${op} access denied`, {
        ...ctx,
        status: e.status,
        reason: e.message,
      });
      return res.status(404).json({ error: "NOT_FOUND" });
    }
    logger.info(`[TRASH] ${op} ${e.message}`, { ...ctx, status: e.status });
    return res.status(e.status).json({ error: e.message });
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (msg === "PAGE_NOT_FOUND_OR_ALREADY_ARCHIVED" || msg === "PAGE_NOT_IN_TRASH") {
    logger.info(`[TRASH] ${op} not-found`, { ...ctx, reason: msg });
    return res.status(404).json({ error: "NOT_FOUND" });
  }
  if (msg === "BULK_LIMIT_EXCEEDED") {
    return res.status(400).json({ error: "TOO_MANY_IDS", max: 100 });
  }
  if (msg === "TREE_TOO_LARGE") {
    return res.status(400).json({ error: "TREE_TOO_LARGE" });
  }
  logger.error(`[TRASH] ${op} failed`, { ...ctx, error: msg });
  return res.status(500).json({ error: "INTERNAL" });
}

export async function archivePageHandler(req: Request, res: Response): Promise<Response> {
  const parsed = pageIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAGE_ID" });
  }
  const { id } = parsed.data;
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "UNAUTHENTICATED" });
  }
  try {
    // Single-query auth: load page workspaceId gated on user access.
    // Collapses the previous loadPageWorkspaceOrThrow + assertUserCanAccessWorkspace
    // into one findFirst — halves DB round-trips on every archive call.
    const workspaceId = await loadPageWorkspaceForUserOrThrow(id, userId);
    // Retry on Postgres serialization_failure — the Serializable isolation
    // level used by archiveCascade can conflict with concurrent archives at
    // the same parent and the contract is "retry the whole tx".
    const result = await withSerializableRetry(() => archiveCascade({ pageId: id, workspaceId }));
    return res.status(200).json({ success: true, ...result });
  } catch (e) {
    return sendError(res, e, "archive", { id, userId });
  }
}

export async function restorePageHandler(req: Request, res: Response): Promise<Response> {
  const parsed = pageIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAGE_ID" });
  }
  const { id } = parsed.data;
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "UNAUTHENTICATED" });
  }
  try {
    // Single-query auth: see archivePageHandler for rationale.
    const workspaceId = await loadPageWorkspaceForUserOrThrow(id, userId);
    // Same retry contract as archive — see archivePageHandler above.
    const result = await withSerializableRetry(() => restoreCascade({ pageId: id, workspaceId }));
    return res.status(200).json({ success: true, ...result });
  } catch (e) {
    return sendError(res, e, "restore", { id, userId });
  }
}

export async function listTrashHandler(req: Request, res: Response): Promise<Response> {
  const parsed = listTrashQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_QUERY", details: parsed.error.flatten() });
  }
  const query = parsed.data;
  try {
    // verifyWorkspaceAccess middleware has already validated user → workspace membership
    const cursor =
      query.cursorArchivedAt && query.cursorId
        ? { archivedAt: query.cursorArchivedAt, id: query.cursorId }
        : undefined;
    const result = await listTrash({
      workspaceId: query.workspaceId,
      take: query.take,
      cursor,
    });
    return res.status(200).json(result);
  } catch (e) {
    return sendError(res, e, "listTrash", { workspaceId: query.workspaceId });
  }
}

export async function bulkDeleteTrashHandler(req: Request, res: Response): Promise<Response> {
  const parsed = bulkDeleteBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_BODY", details: parsed.error.flatten() });
  }
  const { workspaceId, ids } = parsed.data;
  const userId = req.user?.id;
  try {
    const result = await bulkDelete({ workspaceId, ids, userId });
    return res.status(200).json({ success: true, ...result });
  } catch (e) {
    return sendError(res, e, "bulkDelete", { workspaceId, count: ids.length, userId });
  }
}

export async function emptyTrashHandler(req: Request, res: Response): Promise<Response> {
  const parsed = emptyTrashBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_BODY", details: parsed.error.flatten() });
  }
  const { workspaceId } = parsed.data;
  const userId = req.user?.id;
  try {
    try {
      const result = await emptyTrashSync({ workspaceId, userId });
      return res.status(200).json({ success: true, mode: "sync", ...result });
    } catch (innerErr) {
      const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
      if (msg === "TRASH_TOO_LARGE") {
        // Above EMPTY_SYNC_MAX → enqueue BullMQ job (Task 4bis worker handles it).
        // Pass userId so the async worker's DeletionAuditLog row identifies
        // the real caller (not just the workspace).
        const job = await emptyTrashQueue.add(
          "empty-trash",
          { workspaceId, userId },
          {
            attempts: 3,
            backoff: { type: "exponential", delay: 2000 },
            removeOnComplete: { age: 3600 },
          },
        );
        logger.info("[TRASH] emptyTrash queued", { workspaceId, jobId: job.id, userId });
        return res.status(202).json({ success: true, mode: "async", jobId: job.id });
      }
      throw innerErr;
    }
  } catch (e) {
    return sendError(res, e, "emptyTrash", { workspaceId, userId });
  }
}
