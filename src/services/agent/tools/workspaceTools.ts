// 📄 Workspace Tools - Vercel AI SDK Format
import { tool } from "ai";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma.js";
import { logger } from "../../../utils/logger.js";

/**
 * User context injected via closure
 */
interface WorkspaceToolsContext {
  userId: string;
  workspaceId: string;
}

const listWorkspacePagesSchema = z.object({
  projectId: z.string().optional().describe("Filter by specific project"),
  limit: z.number().min(1).max(100).optional().default(20).describe("Maximum number of pages"),
  search: z.string().optional().describe("Search in page titles"),
  includeArchived: z.boolean().optional().default(false).describe("Include archived pages"),
});

const listWorkspaceProjectsSchema = z.object({
  limit: z.number().min(1).max(50).optional().default(20).describe("Maximum number of projects"),
});

/**
 * Creates Workspace tools with user context
 */
export function createWorkspaceTools(ctx: WorkspaceToolsContext) {
  return {
    listWorkspacePages: tool({
      description: `Lists pages in the user's workspace. To see ALL pages, call without projectId — do not filter by project unless the user specifically asks for pages in a certain folder. Returns titles, IDs, and metadata. Useful before getPageOutline or readPageSection to find the right page ID.`,
      inputSchema: listWorkspacePagesSchema,
      execute: async ({ projectId, limit, search, includeArchived }) => {
        logger.log(
          `🔍 [TOOL:listWorkspacePages] workspaceId=${ctx.workspaceId}, projectId=${projectId || "all"}`,
        );

        try {
          const whereClause: Prisma.PageWhereInput = {
            workspaceId: ctx.workspaceId,
            isArchived: includeArchived ? undefined : false,
          };

          if (projectId) {
            whereClause.projectId = projectId;
          }

          if (search) {
            whereClause.title = { contains: search, mode: "insensitive" };
          }

          const pages = await prisma.page.findMany({
            where: whereClause,
            select: {
              id: true,
              title: true,
              slug: true,
              projectId: true,
              createdAt: true,
              updatedAt: true,
              project: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
            orderBy: { updatedAt: "desc" },
            take: limit,
          });

          logger.log(`✅ [TOOL:listWorkspacePages] ${pages.length} pages found`);

          return {
            count: pages.length,
            pages: pages.map((p) => ({
              id: p.id,
              title: p.title || "Untitled",
              slug: p.slug,
              projectId: p.projectId,
              projectName: p.project?.name,
              updatedAt: p.updatedAt.toISOString(),
            })),
          };
        } catch (error) {
          logger.error(`❌ [TOOL:listWorkspacePages] Error:`, error);
          return {
            error: "Failed to retrieve workspace pages. Try again.",
            count: 0,
            pages: [],
          };
        }
      },
    }),

    listWorkspaceProjects: tool({
      description: `Lists projects (folders) in the workspace. Returns project names, IDs, and the count of pages inside each project. Note: pagesCount only counts pages assigned to this project — pages without a project are not included. To see all pages, use listWorkspacePages without projectId filter instead.`,
      inputSchema: listWorkspaceProjectsSchema,
      execute: async ({ limit }) => {
        logger.log(`🔍 [TOOL:listWorkspaceProjects] workspaceId=${ctx.workspaceId}`);

        try {
          const projects = await prisma.project.findMany({
            where: {
              workspaceId: ctx.workspaceId,
            },
            select: {
              id: true,
              name: true,
              createdAt: true,
              _count: {
                select: { pages: true },
              },
            },
            orderBy: { name: "asc" },
            take: limit,
          });

          logger.log(`✅ [TOOL:listWorkspaceProjects] ${projects.length} projects found`);

          return {
            count: projects.length,
            projects: projects.map((p) => ({
              id: p.id,
              name: p.name,
              pagesCount: p._count.pages,
            })),
          };
        } catch (error) {
          logger.error(`❌ [TOOL:listWorkspaceProjects] Error:`, error);
          return {
            error: "Failed to retrieve workspace projects. Try again.",
            count: 0,
            projects: [],
          };
        }
      },
    }),
  };
}
