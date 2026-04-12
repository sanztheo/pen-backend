/**
 * Organization Tools — AI agent sidebar management
 * Create, rename, move, delete folders and pages. All destructive ops use soft-delete.
 */
import { tool } from "ai";
import { z } from "zod";
import { prisma } from "../../../lib/prisma.js";
import { logger } from "../../../utils/logger.js";
import {
  movePage,
  moveProject,
  reorderItems,
  archivePageTree,
  archiveProjectTree,
  countProjectTreeItems,
  ReorderServiceError,
} from "../../reorderService.js";
import { invalidateSidebarCache } from "../../../lib/redis.js";

interface OrganizationToolsContext {
  userId: string;
  workspaceId: string;
}

const MAX_DESTRUCTIVE_OPS = 10;
const LARGE_DELETE_THRESHOLD = 20;

function formatError(error: unknown): { success: false; error: string } {
  if (error instanceof ReorderServiceError) {
    return { success: false, error: `${error.code}: ${error.message}` };
  }
  logger.error("[TOOL:organization] Unexpected error:", error);
  return { success: false, error: "Operation failed. Try again." };
}

export function createOrganizationTools(ctx: OrganizationToolsContext, skipApproval = false) {
  let destructiveOps = 0;

  /** Invalidate Redis sidebar cache so next GET /content returns fresh data */
  async function invalidateCache(): Promise<void> {
    await invalidateSidebarCache(ctx.userId);
  }

  function checkDestructiveLimit(): string | undefined {
    if (destructiveOps >= MAX_DESTRUCTIVE_OPS) {
      return `Safety limit reached: ${MAX_DESTRUCTIVE_OPS} destructive operations in this session. Ask the user to start a new message to continue.`;
    }
    destructiveOps++;
    return undefined;
  }

  return {
    createProject: tool({
      description:
        "Creates a new folder in the workspace. Use getWorkspaceStructure first to see existing folders. Returns the folder ID and name.",
      inputSchema: z.object({
        name: z.string().min(1).max(100).trim().describe("Name of the new folder"),
        parentProjectId: z
          .string()
          .uuid()
          .optional()
          .describe("Parent folder ID for nesting. Omit for workspace root."),
      }),
      needsApproval: !skipApproval,
      execute: async ({ name, parentProjectId }) => {
        logger.log(`[TOOL:createProject] name="${name}", parent=${parentProjectId ?? "root"}`);
        try {
          if (parentProjectId) {
            const parent = await prisma.project.findFirst({
              where: { id: parentProjectId, workspaceId: ctx.workspaceId, isArchived: false },
              select: { id: true },
            });
            if (!parent)
              return {
                success: false,
                error: "Parent folder not found. Use getWorkspaceStructure to find valid IDs.",
              };
          }

          const lastProject = await prisma.project.findFirst({
            where: {
              parentId: parentProjectId ?? null,
              workspaceId: ctx.workspaceId,
              isArchived: false,
            },
            orderBy: { position: "desc" },
            select: { position: true },
          });

          const project = await prisma.project.create({
            data: {
              name,
              workspaceId: ctx.workspaceId,
              createdBy: ctx.userId,
              parentId: parentProjectId ?? null,
              position: (lastProject?.position ?? -1) + 1,
            },
            select: { id: true, name: true, parentId: true },
          });

          logger.log(`[TOOL:createProject] Created: "${project.name}" (${project.id})`);
          await invalidateCache();
          return {
            success: true,
            projectId: project.id,
            name: project.name,
            parentId: project.parentId,
          };
        } catch (error) {
          return formatError(error);
        }
      },
    }),

    renameProject: tool({
      description: "Renames an existing folder. Use getWorkspaceStructure to find the folder ID.",
      inputSchema: z.object({
        projectId: z.string().uuid().describe("ID of the folder to rename"),
        newName: z.string().min(1).max(100).trim().describe("New folder name"),
      }),
      needsApproval: !skipApproval,
      execute: async ({ projectId, newName }) => {
        logger.log(`[TOOL:renameProject] ${projectId} -> "${newName}"`);
        try {
          const result = await prisma.project.updateMany({
            where: { id: projectId, workspaceId: ctx.workspaceId, isArchived: false },
            data: { name: newName },
          });
          if (result.count === 0)
            return { success: false, error: "Folder not found in workspace." };
          await invalidateCache();
          return { success: true, projectId, newName };
        } catch (error) {
          return formatError(error);
        }
      },
    }),

    renamePage: tool({
      description: "Renames an existing page. Use getWorkspaceStructure to find the page ID.",
      inputSchema: z.object({
        pageId: z.string().uuid().describe("ID of the page to rename"),
        newTitle: z.string().min(1).max(200).trim().describe("New page title"),
      }),
      needsApproval: !skipApproval,
      execute: async ({ pageId, newTitle }) => {
        logger.log(`[TOOL:renamePage] ${pageId} -> "${newTitle}"`);
        try {
          const result = await prisma.page.updateMany({
            where: { id: pageId, workspaceId: ctx.workspaceId, isArchived: false },
            data: { title: newTitle },
          });
          if (result.count === 0) return { success: false, error: "Page not found in workspace." };
          await invalidateCache();
          return { success: true, pageId, newTitle };
        } catch (error) {
          return formatError(error);
        }
      },
    }),

    movePage: tool({
      description:
        "Moves a page to a different location: into a folder, under another page, or to workspace root. Sub-pages move with it. Use getWorkspaceStructure first to find valid IDs.",
      inputSchema: z.object({
        pageId: z.string().uuid().describe("ID of the page to move"),
        targetProjectId: z
          .string()
          .uuid()
          .nullable()
          .optional()
          .describe("Target folder ID. null = workspace root. Omit to keep current folder."),
        targetParentPageId: z
          .string()
          .uuid()
          .nullable()
          .optional()
          .describe("Nest under this page. Takes priority — folder inherited from parent."),
        position: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Position in target container. Omit to place at end."),
      }),
      needsApproval: !skipApproval,
      execute: async ({ pageId, targetProjectId, targetParentPageId, position }) => {
        const limitError = checkDestructiveLimit();
        if (limitError) return { success: false, error: limitError };

        logger.log(
          `[TOOL:movePage] ${pageId} -> project=${targetProjectId ?? "keep"}, parent=${targetParentPageId ?? "none"}`,
        );
        try {
          const result = await movePage({
            pageId,
            targetProjectId,
            targetParentPageId,
            position,
            workspaceId: ctx.workspaceId,
          });
          await invalidateCache();
          return {
            success: true,
            pageId,
            movedCount: result.movedCount,
            message: `Page moved (${result.movedCount} pages affected)`,
          };
        } catch (error) {
          return formatError(error);
        }
      },
    }),

    moveProject: tool({
      description:
        "Moves a folder into another folder or to workspace root. Contents stay inside. Use getWorkspaceStructure first.",
      inputSchema: z.object({
        projectId: z.string().uuid().describe("ID of the folder to move"),
        targetParentProjectId: z
          .string()
          .uuid()
          .nullable()
          .optional()
          .describe("Target parent folder ID. null = workspace root."),
        position: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Position in target container. Omit to place at end."),
      }),
      needsApproval: !skipApproval,
      execute: async ({ projectId, targetParentProjectId, position }) => {
        const limitError = checkDestructiveLimit();
        if (limitError) return { success: false, error: limitError };

        logger.log(`[TOOL:moveProject] ${projectId} -> parent=${targetParentProjectId ?? "root"}`);
        try {
          await moveProject({
            projectId,
            targetParentProjectId,
            position,
            workspaceId: ctx.workspaceId,
          });
          await invalidateCache();
          return { success: true, projectId, message: "Folder moved successfully" };
        } catch (error) {
          return formatError(error);
        }
      },
    }),

    reorderItems: tool({
      description:
        "Reorders pages or projects within the same container. All items must share the same parent. Max 50 items.",
      inputSchema: z.object({
        items: z
          .array(
            z.object({
              id: z.string().uuid(),
              type: z.enum(["page", "project"]),
              position: z.number().int().min(0),
            }),
          )
          .min(1)
          .max(50)
          .describe("Items to reorder. All must be in the same container."),
      }),
      needsApproval: !skipApproval,
      execute: async ({ items }) => {
        logger.log(`[TOOL:reorderItems] ${items.length} items`);
        try {
          await reorderItems({ items, workspaceId: ctx.workspaceId });
          await invalidateCache();
          return {
            success: true,
            reorderedCount: items.length,
            message: `${items.length} items reordered`,
          };
        } catch (error) {
          return formatError(error);
        }
      },
    }),

    deletePage: tool({
      description:
        "Deletes a page (moves to trash). Sub-pages are also archived. This is reversible — nothing is permanently deleted. Only use when the user explicitly asks to delete or remove a page.",
      inputSchema: z.object({
        pageId: z.string().uuid().describe("ID of the page to delete (moves to trash)"),
      }),
      needsApproval: true, // Always require approval for destructive ops, ignore skipApproval
      execute: async ({ pageId }) => {
        const limitError = checkDestructiveLimit();
        if (limitError) return { success: false, error: limitError };

        logger.log(`[TOOL:deletePage] ${pageId}`);
        try {
          const result = await archivePageTree(pageId, ctx.workspaceId);
          await invalidateCache();
          return {
            success: true,
            pageId,
            title: result.title,
            archivedCount: result.archivedCount,
            message:
              result.archivedCount > 1
                ? `Deleted "${result.title}" and ${result.archivedCount - 1} sub-pages (moved to trash)`
                : `Deleted "${result.title}" (moved to trash)`,
          };
        } catch (error) {
          return formatError(error);
        }
      },
    }),

    deleteProject: tool({
      description:
        "Deletes a folder and all its contents (moves to trash). All pages and sub-folders inside are archived. This is reversible. Only use when the user explicitly asks to delete or remove a folder.",
      inputSchema: z.object({
        projectId: z
          .string()
          .uuid()
          .describe("ID of the folder to delete (moves to trash with all contents)"),
        confirmLargeDeletion: z
          .boolean()
          .optional()
          .describe(
            "Required when folder contains > 20 items. Set to true after informing the user.",
          ),
      }),
      needsApproval: true, // Always require approval for destructive ops, ignore skipApproval
      execute: async ({ projectId, confirmLargeDeletion }) => {
        const limitError = checkDestructiveLimit();
        if (limitError) return { success: false, error: limitError };

        logger.log(`[TOOL:deleteProject] ${projectId}`);
        try {
          // Check size for large deletion guard
          const counts = await countProjectTreeItems(projectId, ctx.workspaceId);
          if (counts.total > LARGE_DELETE_THRESHOLD && !confirmLargeDeletion) {
            return {
              success: false,
              error: `This folder contains ${counts.projectCount} sub-folders and ${counts.pageCount} pages (${counts.total} total). Call again with confirmLargeDeletion: true to proceed.`,
              requiresConfirmation: true,
              itemCount: counts.total,
            };
          }

          const result = await archiveProjectTree(projectId, ctx.workspaceId);
          await invalidateCache();
          return {
            success: true,
            projectId,
            name: result.name,
            archivedCount: result.archivedCount,
            message: `Deleted folder "${result.name}" and ${result.archivedCount - 1} items (moved to trash)`,
          };
        } catch (error) {
          return formatError(error);
        }
      },
    }),
  };
}
