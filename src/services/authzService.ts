/**
 * Authorization helpers for routes that don't have `workspaceId` in the URL.
 *
 * Why this exists:
 * - `verifyWorkspaceAccess` middleware reads workspaceId from req.params/query/body,
 *   which works for `/trash?workspaceId=...` but NOT for `/pages/:id/archive` where
 *   we only have the page id and must resolve its workspace server-side first.
 * - These helpers throw `HttpError` so handlers can map to HTTP status codes
 *   without leaking workspace existence to unauthorized callers (404 vs 403 collapse
 *   into generic responses inside `sendError`).
 */
import { prisma } from "../lib/prisma.js";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * Look up a page's workspaceId by its ID. Throws HttpError(404, "NOT_FOUND")
 * if the page doesn't exist. Includes archived pages so /restore can find them.
 */
export async function loadPageWorkspaceOrThrow(pageId: string): Promise<string> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { workspaceId: true },
  });
  if (!page) {
    throw new HttpError(404, "NOT_FOUND");
  }
  return page.workspaceId;
}

/**
 * Verify the user is owner OR active member of the workspace.
 * Mirrors the OR-clause used by `verifyWorkspaceAccess` middleware so
 * authorization stays consistent across the codebase.
 */
export async function assertUserCanAccessWorkspace(
  userId: string,
  workspaceId: string,
): Promise<void> {
  const ws = await prisma.workspace.findFirst({
    where: {
      id: workspaceId,
      OR: [{ ownerId: userId }, { members: { some: { userId, isActive: true } } }],
    },
    select: { id: true },
  });
  if (!ws) {
    throw new HttpError(403, "FORBIDDEN");
  }
}

/**
 * Load a page's workspaceId, but only if the user has access to it.
 * Throws HttpError(404, "NOT_FOUND") if the page doesn't exist OR the user
 * has no access — the trash `sendError` collapses 403/404 anyway, so emitting
 * 404 directly avoids leaking page-existence to unauthorized callers.
 *
 * Single query — replaces sequential `loadPageWorkspaceOrThrow` +
 * `assertUserCanAccessWorkspace` (halves DB round-trips on archive/restore).
 * Includes archived pages so `/restore` can find them.
 */
export async function loadPageWorkspaceForUserOrThrow(
  pageId: string,
  userId: string,
): Promise<string> {
  const page = await prisma.page.findFirst({
    where: {
      id: pageId,
      workspace: {
        OR: [{ ownerId: userId }, { members: { some: { userId, isActive: true } } }],
      },
    },
    select: { workspaceId: true },
  });
  if (!page) {
    throw new HttpError(404, "NOT_FOUND");
  }
  return page.workspaceId;
}

/**
 * Project equivalent of loadPageWorkspaceForUserOrThrow. Includes archived
 * projects so /projects/:id/restore can find a trashed project. Same 404
 * collapse pattern — never leaks project existence to unauthorized callers.
 */
export async function loadProjectWorkspaceForUserOrThrow(
  projectId: string,
  userId: string,
): Promise<string> {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      workspace: {
        OR: [{ ownerId: userId }, { members: { some: { userId, isActive: true } } }],
      },
    },
    select: { workspaceId: true },
  });
  if (!project) {
    throw new HttpError(404, "NOT_FOUND");
  }
  return project.workspaceId;
}
