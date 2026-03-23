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

/**
 * BlockNote content item (text segment within a block)
 */
interface BlockNoteContentItem {
  type?: string;
  text?: string;
  styles?: Record<string, unknown>;
}

/**
 * BlockNote table row structure
 */
interface BlockNoteTableRow {
  cells?: BlockNoteContentItem[][];
}

/**
 * BlockNote table content structure
 */
interface BlockNoteTableContent {
  rows?: BlockNoteTableRow[];
}

/**
 * BlockNote block structure
 */
interface BlockNoteBlock {
  id?: string;
  type?: string;
  content?: BlockNoteContentItem[] | BlockNoteTableContent;
  props?: {
    level?: number;
    checked?: boolean;
    language?: string;
    caption?: string;
    [key: string]: unknown;
  };
  children?: BlockNoteBlock[];
}

const listWorkspacePagesSchema = z.object({
  projectId: z.string().optional().describe("Filter by specific project"),
  limit: z.number().min(1).max(100).optional().default(20).describe("Maximum number of pages"),
  search: z.string().optional().describe("Search in page titles"),
  includeArchived: z.boolean().optional().default(false).describe("Include archived pages"),
});

const readWorkspacePageSchema = z.object({
  pageId: z.string().describe("ID of the page to read"),
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
      description: `Lists pages available in the user's workspace. Use this tool to discover which pages can be referenced or read. Returns titles, IDs, and metadata. Useful before using readWorkspacePage to find the right page ID.`,
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

    readWorkspacePage: tool({
      description: `Reads the full content of a workspace page. Use this tool when you need to reference or analyze the content of a specific page. BlockNote content is converted to readable plain text. Use listWorkspacePages first to find the page ID.`,
      inputSchema: readWorkspacePageSchema,
      execute: async ({ pageId }) => {
        logger.log(`🔍 [TOOL:readWorkspacePage] pageId=${pageId}`);

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
              blockNoteContent: true,
              createdAt: true,
              updatedAt: true,
              project: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          });

          if (!page) {
            return {
              error: "Page not found or not accessible. Verify the pageId with listWorkspacePages.",
              content: null,
            };
          }

          let textContent = "";
          try {
            if (page.blockNoteContent) {
              const content =
                typeof page.blockNoteContent === "string"
                  ? JSON.parse(page.blockNoteContent)
                  : page.blockNoteContent;

              if (Array.isArray(content)) {
                textContent = extractTextFromBlockNote(content);
              }
            }
          } catch (e) {
            logger.warn(`⚠️ [TOOL:readWorkspacePage] BlockNote extraction error:`, e);
          }

          logger.log(
            `✅ [TOOL:readWorkspacePage] Page "${page.title}" read (${textContent.length} chars)`,
          );

          return {
            id: page.id,
            title: page.title || "Untitled",
            content: textContent || "(Empty page)",
            contentLength: textContent.length,
            projectId: page.project?.id,
            projectName: page.project?.name,
            createdAt: page.createdAt.toISOString(),
            updatedAt: page.updatedAt.toISOString(),
          };
        } catch (error) {
          logger.error(`❌ [TOOL:readWorkspacePage] Error:`, error);
          return {
            error: "Failed to read page. Verify the pageId with listWorkspacePages.",
            content: null,
          };
        }
      },
    }),

    listWorkspaceProjects: tool({
      description: `Lists projects (folders) in the workspace. Use this tool to discover the workspace structure and find project IDs for filtering pages with listWorkspacePages. Returns project names, IDs, and page counts.`,
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

/**
 * Extracts plain text from BlockNote content
 */
function extractTextFromBlockNote(blocks: BlockNoteBlock[]): string {
  const textParts: string[] = [];

  for (const block of blocks) {
    if (!block) continue;

    switch (block.type) {
      case "paragraph":
      case "heading":
      case "bulletListItem":
      case "numberedListItem":
      case "checkListItem":
        if (block.content && Array.isArray(block.content)) {
          const contentItems = block.content as BlockNoteContentItem[];
          const blockText = contentItems
            .map((item) => item?.text || "")
            .filter(Boolean)
            .join("");
          if (blockText) {
            if (block.type === "heading" && block.props?.level) {
              textParts.push("#".repeat(block.props.level) + " " + blockText);
            } else if (block.type === "bulletListItem") {
              textParts.push("- " + blockText);
            } else if (block.type === "numberedListItem") {
              textParts.push("1. " + blockText);
            } else if (block.type === "checkListItem") {
              const checked = block.props?.checked ? "[x]" : "[ ]";
              textParts.push(checked + " " + blockText);
            } else {
              textParts.push(blockText);
            }
          }
        }
        break;

      case "codeBlock":
        if (block.content && Array.isArray(block.content)) {
          const codeItems = block.content as BlockNoteContentItem[];
          const code = codeItems.map((item) => item?.text || "").join("");
          if (code) {
            const lang = block.props?.language || "";
            textParts.push("```" + lang + "\n" + code + "\n```");
          }
        }
        break;

      case "table": {
        const tableContent = block.content as BlockNoteTableContent | undefined;
        if (tableContent?.rows) {
          for (const row of tableContent.rows) {
            if (row.cells) {
              const cellTexts = row.cells.map((cell) => {
                if (Array.isArray(cell)) {
                  return cell.map((item) => item?.text || "").join("");
                }
                return "";
              });
              textParts.push("| " + cellTexts.join(" | ") + " |");
            }
          }
        }
        break;
      }

      case "image":
        if (block.props?.caption) {
          textParts.push(`[Image: ${block.props.caption}]`);
        }
        break;
    }

    if (block.children && Array.isArray(block.children) && block.children.length > 0) {
      const childText = extractTextFromBlockNote(block.children);
      if (childText) {
        textParts.push(childText);
      }
    }
  }

  return textParts.join("\n\n");
}
