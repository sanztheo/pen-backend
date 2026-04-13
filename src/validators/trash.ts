/**
 * Zod validators for the Corbeille (Trash) feature.
 *
 * Conventions:
 * - workspaceId is required everywhere (multi-workspace isolation).
 * - Composite cursor (archivedAt + id) is all-or-nothing for stable pagination.
 * - Hard caps on bulk operations to keep latency bounded.
 */

import { z } from "zod";

// GET /trash — workspaceId + composite cursor pagination
export const listTrashQuerySchema = z
  .object({
    workspaceId: z.string().uuid(),
    cursorArchivedAt: z.string().datetime().optional(),
    cursorId: z.string().uuid().optional(),
    take: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine((v) => (v.cursorArchivedAt && v.cursorId) || (!v.cursorArchivedAt && !v.cursorId), {
    message: "cursorArchivedAt and cursorId must be provided together",
  });

// POST /trash/bulk-delete
export const bulkDeleteBodySchema = z.object({
  workspaceId: z.string().uuid(),
  ids: z.array(z.string().uuid()).min(1).max(100),
});

// DELETE /trash — empty entire trash for a workspace
export const emptyTrashBodySchema = z.object({
  workspaceId: z.string().uuid(),
});

// POST /pages/:id/archive and POST /pages/:id/restore
export const pageIdParamSchema = z.object({
  id: z.string().uuid(),
});

// POST /projects/:id/restore (and DELETE /projects/:id which archives)
export const projectIdParamSchema = z.object({
  id: z.string().uuid(),
});
