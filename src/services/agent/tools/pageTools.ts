// 📄 Page Tools - Page creation and management via agent
import { tool } from "ai";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma.js";
import { nanoid } from "nanoid";
import { logger } from "../../../utils/logger.js";
import {
  toBlockNoteAuto,
  sanitizeAIGeneratedContent,
} from "../../../controllers/assistant/helpers/blocknote.js";

/**
 * User context injected via closure
 */
interface PageToolsContext {
  userId: string;
  workspaceId: string;
}

// Helper to transform empty strings to undefined
const emptyToUndefined = (val: unknown) => (val === "" || val === null ? undefined : val);

const createPageSchema = z.object({
  title: z.string().min(1).max(255).describe("Title of the page to create"),
  content: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .optional()
      .describe("Initial page content as text (will be converted to BlockNote format)"),
  ),
  projectId: z.preprocess(
    emptyToUndefined,
    z.string().uuid().optional().describe("ID of the project to create the page in (optional)"),
  ),
  icon: z.preprocess(
    emptyToUndefined,
    z.string().max(10).optional().describe("Emoji or icon for the page (e.g. '📝')"),
  ),
});

const checkPageExistsSchema = z.object({
  pageId: z.string().uuid().describe("ID of the page to check"),
});

/**
 * Creates page management tools with user context
 */
export function createPageTools(ctx: PageToolsContext) {
  return {
    createPage: tool({
      description: `Creates a new page in the user's workspace. Use this tool when the user asks to create a page, document, or notes. The page can be created at workspace root or inside a specific project. Returns the page ID, title, and URL.`,
      inputSchema: createPageSchema,
      execute: async ({ title, content, projectId, icon }) => {
        logger.log(`🔍 [TOOL:createPage] title="${title}", projectId=${projectId || "root"}`);

        try {
          if (projectId) {
            const project = await prisma.project.findFirst({
              where: {
                id: projectId,
                workspaceId: ctx.workspaceId,
              },
            });
            if (!project) {
              return {
                success: false,
                error:
                  "Project not found in this workspace. Use listWorkspaceProjects to find valid project IDs.",
                pageId: null,
              };
            }
          }

          const lastPage = await prisma.page.findFirst({
            where: {
              workspaceId: ctx.workspaceId,
              projectId: projectId || null,
              parentId: null,
            },
            orderBy: { position: "desc" },
            select: { position: true },
          });
          const position = (lastPage?.position ?? -1) + 1;

          const baseSlug = title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 50);
          const slug = `${baseSlug}-${Date.now()}-${nanoid(4)}`;

          const blockNoteContent = content
            ? (toBlockNoteAuto(
                sanitizeAIGeneratedContent(content),
              ) as unknown as Prisma.InputJsonValue)
            : null;

          const page = await prisma.page.create({
            data: {
              title,
              slug,
              position,
              workspaceId: ctx.workspaceId,
              projectId: projectId || null,
              createdBy: ctx.userId,
              icon: icon || null,
              blockNoteContent: blockNoteContent ?? undefined,
            },
            select: {
              id: true,
              title: true,
              slug: true,
              icon: true,
              createdAt: true,
              projectId: true,
            },
          });

          logger.log(`✅ [TOOL:createPage] Page created: "${page.title}" (ID: ${page.id})`);

          return {
            success: true,
            pageId: page.id,
            title: page.title,
            slug: page.slug,
            icon: page.icon,
            url: `/page/${page.id}`,
            projectId: page.projectId || null,
            projectName: null,
            createdAt: page.createdAt.toISOString(),
          };
        } catch (error) {
          logger.error(`❌ [TOOL:createPage] Error:`, error);
          return {
            success: false,
            error: "Failed to create page. Try again or check if the projectId is valid.",
            pageId: null,
          };
        }
      },
    }),

    checkPageExists: tool({
      description: `Checks if a page still exists in the workspace. Use this tool to verify that a previously created page has not been deleted before referencing it.`,
      inputSchema: checkPageExistsSchema,
      execute: async ({ pageId }) => {
        logger.log(`🔍 [TOOL:checkPageExists] pageId=${pageId}`);

        try {
          const page = await prisma.page.findFirst({
            where: {
              id: pageId,
              workspaceId: ctx.workspaceId,
              isArchived: false,
            },
            select: {
              id: true,
              title: true,
              slug: true,
              icon: true,
            },
          });

          if (!page) {
            return {
              exists: false,
              pageId,
              message: "Page not found or deleted",
            };
          }

          return {
            exists: true,
            pageId: page.id,
            title: page.title,
            slug: page.slug,
            icon: page.icon,
            url: `/page/${page.id}`,
          };
        } catch (error) {
          logger.error(`❌ [TOOL:checkPageExists] Error:`, error);
          return {
            exists: false,
            pageId,
            error: "Failed to check page existence. Try again.",
          };
        }
      },
    }),
  };
}
