// pen-backend/src/services/agent/tools/pageReadingTools.ts
import { tool } from "ai";
import { z } from "zod";
import { prisma } from "../../../lib/prisma.js";
import { logger } from "../../../utils/logger.js";
import {
  type BlockNoteBlock,
  blocknoteToMarkdown,
  parseBlockNoteSections,
  estimateTokens,
  searchInBlocks,
  SOFT_TOKEN_CAP,
  HARD_TOKEN_CAP,
} from "../utils/blocknoteReader.js";

interface PageReadingToolsContext {
  userId: string;
  workspaceId: string;
}

const FALLBACK_CHUNK_SIZE = 50;

/** Shared: fetch page and parse blocks from DB */
async function fetchPageBlocks(
  pageId: string,
  workspaceId: string,
): Promise<{
  page: { id: string; title: string; projectId: string | null; projectName: string | undefined };
  blocks: BlockNoteBlock[];
} | null> {
  const page = await prisma.page.findFirst({
    where: { id: pageId, workspaceId, isArchived: false },
    select: {
      id: true,
      title: true,
      blockNoteContent: true,
      projectId: true,
      project: { select: { name: true } },
    },
  });

  if (!page) return null;

  let blocks: BlockNoteBlock[] = [];
  if (page.blockNoteContent) {
    const raw =
      typeof page.blockNoteContent === "string"
        ? JSON.parse(page.blockNoteContent)
        : page.blockNoteContent;
    if (Array.isArray(raw)) blocks = raw as BlockNoteBlock[];
  }

  return {
    page: {
      id: page.id,
      title: page.title || "Untitled",
      projectId: page.projectId,
      projectName: page.project?.name,
    },
    blocks,
  };
}

export function createPageReadingTools(ctx: PageReadingToolsContext) {
  // Request-scoped cache — lives only for the duration of one streamText call
  const pageCache = new Map<string, Awaited<ReturnType<typeof fetchPageBlocks>>>();

  async function cachedFetchPageBlocks(
    pageId: string,
    workspaceId: string,
  ): Promise<Awaited<ReturnType<typeof fetchPageBlocks>>> {
    const key = `${workspaceId}:${pageId}`;
    if (!pageCache.has(key)) {
      pageCache.set(key, await fetchPageBlocks(pageId, workspaceId));
    }
    return pageCache.get(key)!;
  }

  return {
    getPageOutline: tool({
      description: `Returns the structure of a workspace page: section headings, block ranges, and estimated token counts. ALWAYS call this BEFORE reading page content to understand the page size and decide whether to read it fully or by section. If totalTokens < 32000, you can call readPageSection without parameters to read the whole page. If totalTokens > 32000, read specific sections.`,
      inputSchema: z.object({
        pageId: z.string().uuid().describe("ID of the page to outline"),
      }),
      execute: async ({ pageId }) => {
        logger.log(`[TOOL:getPageOutline] pageId=${pageId}`);

        try {
          const result = await cachedFetchPageBlocks(pageId, ctx.workspaceId);
          if (!result) {
            return {
              error:
                "Page not found or not accessible. Use listWorkspacePages to find the correct ID.",
            };
          }

          const outline = parseBlockNoteSections(result.blocks);

          logger.log(
            `[TOOL:getPageOutline] "${result.page.title}" — ${outline.totalBlocks} blocks, ~${outline.totalTokens} tokens, ${outline.sections.length} sections`,
          );

          return {
            pageId: result.page.id,
            title: result.page.title,
            totalBlocks: outline.totalBlocks,
            totalTokens: outline.totalTokens,
            exceedsSoftCap: outline.totalTokens > SOFT_TOKEN_CAP,
            exceedsHardCap: outline.totalTokens > HARD_TOKEN_CAP,
            sections: outline.sections.map((s) => ({
              heading: s.heading,
              level: s.level,
              blockRange: `${s.startBlock}–${s.endBlock}`,
              tokens: s.tokens,
            })),
            hint:
              outline.totalTokens > SOFT_TOKEN_CAP
                ? "Page exceeds 32k tokens. Read specific sections using sectionName or offset+limit parameters."
                : "Page is small enough to read in full. Call readPageSection with just the pageId.",
          };
        } catch (error) {
          logger.error(`[TOOL:getPageOutline] Error:`, error);
          return { error: "Failed to analyze page structure." };
        }
      },
    }),

    readPageSection: tool({
      description: `Reads page content as Markdown with [block:N] annotations. Three modes:
1. Full read (no section/offset/limit): reads entire page if under 32k tokens
2. By section name: reads a specific section from getPageOutline
3. By block range: reads blocks from offset to offset+limit
Call getPageOutline first to check page size and available sections.`,
      inputSchema: z.object({
        pageId: z.string().uuid().describe("ID of the page to read"),
        sectionName: z
          .string()
          .optional()
          .describe("Exact section heading from getPageOutline to read"),
        offset: z.number().int().min(0).optional().describe("Start block index (0-based)"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Number of blocks to read from offset"),
      }),
      execute: async ({ pageId, sectionName, offset, limit }) => {
        logger.log(
          `[TOOL:readPageSection] pageId=${pageId}, section=${sectionName || "all"}, offset=${offset}, limit=${limit}`,
        );

        try {
          const result = await cachedFetchPageBlocks(pageId, ctx.workspaceId);
          if (!result) {
            return { error: "Page not found or not accessible." };
          }

          const { blocks, page } = result;
          let selectedBlocks: BlockNoteBlock[];
          let readMode: string;

          if (sectionName) {
            const outline = parseBlockNoteSections(blocks);
            const section = outline.sections.find(
              (s) => s.heading.toLowerCase() === sectionName.toLowerCase(),
            );
            if (!section) {
              return {
                error: `Section "${sectionName}" not found. Available sections: ${outline.sections.map((s) => s.heading).join(", ")}`,
              };
            }
            selectedBlocks = blocks.slice(section.startBlock, section.endBlock + 1);
            readMode = `section "${sectionName}" (blocks ${section.startBlock}–${section.endBlock})`;
          } else if (offset !== undefined) {
            const safeOffset = Math.max(0, Math.min(offset, blocks.length - 1));
            const safeLimit = limit || FALLBACK_CHUNK_SIZE;
            const end = Math.min(safeOffset + safeLimit, blocks.length);
            selectedBlocks = blocks.slice(safeOffset, end);
            readMode = `blocks ${safeOffset}–${end - 1} of ${blocks.length}`;
          } else {
            // Mode 1: Full read — render once with annotations, check size on that
            const fullMarkdown = blocknoteToMarkdown(blocks, { annotate: true });
            const totalTokens = estimateTokens(fullMarkdown);

            if (totalTokens > HARD_TOKEN_CAP) {
              return {
                error: `Page exceeds safety limit (~${totalTokens} tokens). Use getPageOutline to identify sections and read them individually.`,
                totalTokens,
                hint: "Call getPageOutline first, then readPageSection with sectionName or offset+limit.",
              };
            }

            if (totalTokens > SOFT_TOKEN_CAP) {
              const outline = parseBlockNoteSections(blocks);
              return {
                error: `Page is too large for full read (~${totalTokens} tokens, limit: ${SOFT_TOKEN_CAP}). Read by section instead.`,
                totalTokens,
                sections: outline.sections.map((s) => ({
                  heading: s.heading,
                  blockRange: `${s.startBlock}–${s.endBlock}`,
                  tokens: s.tokens,
                })),
                hint: "Use sectionName or offset+limit to read specific parts.",
              };
            }

            // Size is OK — reuse the already-rendered markdown
            const tokens = totalTokens;
            logger.log(
              `[TOOL:readPageSection] "${page.title}" — full page (${blocks.length} blocks), ~${tokens} tokens`,
            );

            const safeFullMarkdown = fullMarkdown.replace(
              /<\/user_page_content>/gi,
              "&lt;/user_page_content&gt;",
            );
            return {
              pageId: page.id,
              title: page.title,
              readMode: `full page (${blocks.length} blocks)`,
              content: `<user_page_content>\n${safeFullMarkdown}\n</user_page_content>`,
              tokens,
              totalBlocks: blocks.length,
            };
          }

          const markdown = blocknoteToMarkdown(selectedBlocks, { annotate: true });
          const tokens = estimateTokens(markdown);

          logger.log(`[TOOL:readPageSection] "${page.title}" — ${readMode}, ~${tokens} tokens`);

          const safeMarkdown = markdown.replace(
            /<\/user_page_content>/gi,
            "&lt;/user_page_content&gt;",
          );
          return {
            pageId: page.id,
            title: page.title,
            readMode,
            content: `<user_page_content>\n${safeMarkdown}\n</user_page_content>`,
            tokens,
            totalBlocks: blocks.length,
          };
        } catch (error) {
          logger.error(`[TOOL:readPageSection] Error:`, error);
          return { error: "Failed to read page content." };
        }
      },
    }),

    searchPageContent: tool({
      description: `Searches for text within a page. Returns matching blocks with surrounding context and block indices. Use to find specific information without reading the entire page.`,
      inputSchema: z.object({
        pageId: z.string().uuid().describe("ID of the page to search"),
        query: z.string().min(1).max(500).describe("Text to search for (case-insensitive)"),
      }),
      execute: async ({ pageId, query }) => {
        const safeQuery = query.replace(/[\r\n]/g, " ");
        logger.log(`[TOOL:searchPageContent] pageId=${pageId}, query="${safeQuery}"`);

        try {
          const result = await cachedFetchPageBlocks(pageId, ctx.workspaceId);
          if (!result) {
            return { error: "Page not found or not accessible." };
          }

          const matches = searchInBlocks(result.blocks, query);

          logger.log(
            `[TOOL:searchPageContent] "${result.page.title}" — ${matches.length} matches for "${query}"`,
          );

          return {
            pageId: result.page.id,
            title: result.page.title,
            query,
            matchCount: matches.length,
            matches: matches.slice(0, 20).map((m) => ({
              blockIndex: m.blockIndex,
              blockType: m.blockType,
              snippet: m.matchSnippet,
            })),
            hint:
              matches.length > 0
                ? `Found ${matches.length} match(es). Use readPageSection with offset to read around block ${matches[0].blockIndex}.`
                : "No matches found. Try a different search term.",
          };
        } catch (error) {
          logger.error(`[TOOL:searchPageContent] Error:`, error);
          return { error: "Failed to search page content." };
        }
      },
    }),
  };
}
