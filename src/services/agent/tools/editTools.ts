// Page editing tools — precise edits, full rewrites, section replacements, and insertions
import { tool } from "ai";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma.js";
import { logger } from "../../../utils/logger.js";
import {
  toBlockNoteAuto,
  sanitizeAIGeneratedContent,
} from "../../../controllers/assistant/helpers/blocknote.js";
import type { BlockNoteBlock } from "../../../controllers/assistant/helpers/blocknote.js";
import { invalidateBlockNoteCache } from "../../../lib/redis.js";
import { resetYjsDocument } from "../../../lib/y-prisma.js";
import { ContextCacheService } from "../../../services/quiz/intelligence/index.js";
import {
  findTextInBlocks,
  replaceTextInBlock,
  replaceSectionBlocks,
  insertBlocksAtPosition,
} from "./helpers/blockNoteEdit.js";

interface EditToolsContext {
  userId: string;
  workspaceId: string;
}

// =====================================================
// Constants
// =====================================================

const MAX_CONTENT_LENGTH = 500_000;

// =====================================================
// Schemas
// =====================================================

const editPageContentSchema = z.object({
  pageId: z.string().uuid().describe("ID of the page to edit"),
  oldText: z
    .string()
    .min(1)
    .max(MAX_CONTENT_LENGTH)
    .describe("Exact text to find in the page (copy from readPageSection output)"),
  newText: z
    .string()
    .max(MAX_CONTENT_LENGTH)
    .describe("Replacement text. Empty string to delete the matched text."),
});

const rewritePageContentSchema = z.object({
  pageId: z.string().uuid().describe("ID of the page to rewrite"),
  content: z
    .string()
    .min(1)
    .max(MAX_CONTENT_LENGTH)
    .describe("New full content for the page (replaces everything)"),
});

const replacePageSectionSchema = z.object({
  pageId: z.string().uuid().describe("ID of the page to edit"),
  sectionHeading: z
    .string()
    .min(1)
    .max(1000)
    .describe("Exact heading text of the section to replace"),
  newContent: z
    .string()
    .min(1)
    .max(MAX_CONTENT_LENGTH)
    .describe("New content for this section (replaces everything under the heading)"),
});

const insertInPageSchema = z.object({
  pageId: z.string().uuid().describe("ID of the page to insert content into"),
  content: z.string().min(1).max(MAX_CONTENT_LENGTH).describe("Content to insert"),
  position: z
    .union([
      z.literal("start"),
      z.literal("end"),
      z.object({
        afterHeading: z.string().min(1).max(1000).describe("Insert after this heading text"),
      }),
    ])
    .describe("Where to insert: 'start', 'end', or { afterHeading: 'Section Title' }"),
});

// =====================================================
// Helpers
// =====================================================

/** Fetch a page and parse its blockNoteContent into a BlockNoteBlock array */
async function fetchPageBlocks(
  pageId: string,
  workspaceId: string,
): Promise<
  | {
      success: true;
      page: { id: string; title: string };
      blocks: BlockNoteBlock[];
    }
  | { success: false; error: string }
> {
  const page = await prisma.page.findFirst({
    where: { id: pageId, workspaceId, isArchived: false },
    select: { id: true, title: true, blockNoteContent: true },
  });

  if (!page) {
    return {
      success: false,
      error: "Page not found in this workspace or it has been archived. Verify the pageId.",
    };
  }

  const raw = page.blockNoteContent;
  let blocks: BlockNoteBlock[];

  if (Array.isArray(raw)) {
    blocks = raw as unknown as BlockNoteBlock[];
  } else if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      blocks = Array.isArray(parsed) ? (parsed as BlockNoteBlock[]) : [];
    } catch {
      blocks = [];
    }
  } else {
    blocks = [];
  }

  return {
    success: true,
    page: { id: page.id, title: page.title },
    blocks,
  };
}

/**
 * Snapshot the current page content before an AI edit.
 * Keeps at most MAX_SNAPSHOTS_PER_PAGE per page (FIFO cleanup).
 */
const MAX_SNAPSHOTS_PER_PAGE = 10;

async function snapshotBeforeSave(
  pageId: string,
  workspaceId: string,
  toolName: string,
): Promise<void> {
  const page = await prisma.page.findFirst({
    where: { id: pageId, workspaceId },
    select: { blockNoteContent: true },
  });
  if (!page?.blockNoteContent) return;

  await prisma.pageEditSnapshot.create({
    data: {
      pageId,
      content: page.blockNoteContent as Prisma.InputJsonValue,
      toolName,
    },
  });

  // Cleanup old snapshots beyond the limit
  const old = await prisma.pageEditSnapshot.findMany({
    where: { pageId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
    skip: MAX_SNAPSHOTS_PER_PAGE,
  });
  if (old.length > 0) {
    await prisma.pageEditSnapshot.deleteMany({
      where: { id: { in: old.map((s) => s.id) } },
    });
  }
}

/**
 * Save updated blocks to a page.
 * No optimistic locking — the approval delay between read and write
 * causes false positives with Yjs sync updating updatedAt.
 */
const MAX_BLOCKS_PAYLOAD_BYTES = 5_000_000;

export async function savePageBlocks(
  pageId: string,
  workspaceId: string,
  blocks: BlockNoteBlock[],
  toolName?: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const serialized = JSON.stringify(blocks);
  if (serialized.length > MAX_BLOCKS_PAYLOAD_BYTES) {
    return {
      success: false,
      error: `Page content exceeds maximum size (${Math.round(serialized.length / 1_000_000)}MB). Try editing smaller sections.`,
    };
  }

  if (toolName) {
    try {
      await snapshotBeforeSave(pageId, workspaceId, toolName);
    } catch (err) {
      logger.warn(`[savePageBlocks] Snapshot failed for ${pageId}:`, err);
    }
  }

  const result = await prisma.page.updateMany({
    where: { id: pageId, workspaceId },
    data: {
      blockNoteContent: blocks as unknown as Prisma.InputJsonValue,
      updatedAt: new Date(),
    },
  });

  if (result.count === 0) {
    return {
      success: false,
      error: "Page not found or you don't have access. Verify the pageId.",
    };
  }

  try {
    await Promise.all([invalidateBlockNoteCache(pageId), resetYjsDocument(pageId)]);
  } catch (cacheErr) {
    logger.error(`[savePageBlocks] Cache/Yjs invalidation failed for ${pageId}:`, cacheErr);
  }
  ContextCacheService.invalidateForPages([pageId]).catch((err) => {
    logger.warn(`[savePageBlocks] ContextCache invalidation failed:`, err);
  });

  return { success: true };
}

// =====================================================
// Factory
// =====================================================

/**
 * Creates page editing tools with user context.
 * All tools operate on pages within the user's workspace.
 *
 * Tool order: safest first, most destructive last (mitigates position bias).
 */
export function createEditTools(ctx: EditToolsContext) {
  return {
    // --------------------------------------------------
    // Tool 1: editPageContent (targeted text replacement)
    // --------------------------------------------------
    editPageContent: tool({
      description: `Replace a specific piece of text in a page. This is the default tool for targeted changes — a few words, a sentence, or a paragraph.

Precondition: call getPageOutline then readPageSection first, then call this tool immediately. Do not search the web or Wikipedia before editing.

When to use:
- "corrige X par Y", "change X to Y", "remplace X par Y" → this tool
- "corrige les fautes", "fix the typos" → this tool (call multiple times if needed)
- "supprime cette phrase" → this tool with empty newText
- Small, targeted changes: a few words to a paragraph

When NOT to use:
- "complète", "ajoute", "continue", "add" → use insertInPage instead
- "traduis toute la page" → use rewritePageContent instead
- "refais l'introduction" → use replacePageSection instead
- If the user wants NEW content added, not existing text changed → use insertInPage

Copy oldText EXACTLY from readPageSection output — do not paraphrase or approximate.`,
      inputSchema: editPageContentSchema,
      needsApproval: true,
      execute: async ({ pageId, oldText, newText }) => {
        logger.log("[TOOL:editPageContent] Editing page", {
          userId: ctx.userId,
          pageId,
          oldText: oldText.slice(0, 50),
        });

        try {
          const result = await fetchPageBlocks(pageId, ctx.workspaceId);
          if (!result.success) {
            return { success: false, error: result.error };
          }

          const { page, blocks } = result;
          const findResult = findTextInBlocks(blocks, oldText);

          if (!findResult.found) {
            return {
              success: false,
              error:
                "Text not found in page. The page may have been modified since you last read it.",
              suggestion:
                "Call getPageOutline then readPageSection to see the current content, then copy the exact text you want to change.",
              ...(findResult.closestMatch ? { closestMatch: findResult.closestMatch } : {}),
            };
          }

          if (findResult.matches.length > 1) {
            return {
              success: false,
              error: `Ambiguous match: found ${findResult.matches.length} blocks containing this text.`,
              suggestion:
                "Include more surrounding context in oldText so it matches exactly one location. Use readPageSection to find the unique text.",
            };
          }

          const matchIndex = findResult.matches[0].blockIndex;
          const updatedBlock = replaceTextInBlock(blocks[matchIndex], oldText, newText);

          if (JSON.stringify(updatedBlock) === JSON.stringify(blocks[matchIndex])) {
            return {
              success: false,
              error: `Found the text (via ${findResult.matchLevel}) but the exact replacement failed. The text may differ in casing or whitespace.`,
              suggestion:
                "Copy the exact text from readPageSection output, preserving case and spacing.",
            };
          }

          blocks[matchIndex] = updatedBlock;

          const saveResult = await savePageBlocks(
            pageId,
            ctx.workspaceId,
            blocks,
            "editPageContent",
          );
          if (!saveResult.success) return saveResult;

          logger.log("[TOOL:editPageContent] Edited block", {
            userId: ctx.userId,
            pageId,
            title: page.title,
            blockIndex: matchIndex,
            matchLevel: findResult.matchLevel,
          });
          return {
            success: true,
            pageId,
            title: page.title,
            editedBlockIndex: matchIndex,
            _instruction:
              "Success. Confirm briefly to the user in their language. Do not re-call this tool on the same page.",
          };
        } catch (error) {
          logger.error("[TOOL:editPageContent] Error", { userId: ctx.userId, pageId, error });
          return {
            success: false,
            error: "Edit failed due to an internal error while saving changes.",
            suggestion:
              "Call getPageOutline to verify the page still exists and is accessible, then retry the edit.",
          };
        }
      },
    }),

    // --------------------------------------------------
    // Tool 2: insertInPage (add content — existing content stays untouched)
    // --------------------------------------------------
    insertInPage: tool({
      description: `Add new content to a page without removing or replacing anything. This is the right tool whenever the user wants to add, complete, continue, or expand a page. Existing page content stays untouched.

Precondition: call getPageOutline then readPageSection first, then call this tool immediately. Do not search the web or Wikipedia before editing.

When to use — this is the default for adding content:
- "complète cette page", "complete this page" → this tool with position "end"
- "ajoute un paragraphe", "add a section" → this tool
- "continue", "expand", "développe" → this tool
- "ajoute après [heading]" → this tool with afterHeading
- Any request to ADD new content without replacing existing text → this tool

When NOT to use:
- Replacing existing text (use editPageContent)
- Rewriting a section (use replacePageSection)
- Rewriting the entire page (use rewritePageContent)

Supports positions: 'start', 'end', or { afterHeading: 'Section Title' }. Use getPageOutline to see existing headings when using afterHeading.`,
      inputSchema: insertInPageSchema,
      needsApproval: true,
      execute: async ({ pageId, content, position }) => {
        logger.log("[TOOL:insertInPage] Inserting content", {
          userId: ctx.userId,
          pageId,
          position,
        });

        try {
          const result = await fetchPageBlocks(pageId, ctx.workspaceId);
          if (!result.success) {
            return { success: false, error: result.error };
          }

          const { page, blocks } = result;
          const sanitized = sanitizeAIGeneratedContent(content);
          const convertedBlocks = await toBlockNoteAuto(sanitized);

          const insertResult = insertBlocksAtPosition(blocks, convertedBlocks, position);

          if (typeof position === "object" && "afterHeading" in position && !insertResult.found) {
            return {
              success: false,
              error: `Heading "${position.afterHeading}" not found in the page.`,
              suggestion:
                "Call getPageOutline to see the available headings, then copy the exact heading text. Or use position 'end' to append at the bottom.",
            };
          }

          const saveResult = await savePageBlocks(
            pageId,
            ctx.workspaceId,
            insertResult.blocks,
            "insertInPage",
          );
          if (!saveResult.success) return saveResult;

          logger.log("[TOOL:insertInPage] Inserted blocks", {
            userId: ctx.userId,
            pageId,
            title: page.title,
            insertedBlocks: convertedBlocks.length,
          });
          return {
            success: true,
            pageId,
            title: page.title,
            insertedBlocks: convertedBlocks.length,
            _instruction:
              "Success. Confirm briefly to the user in their language. Do not re-call this tool on the same page.",
          };
        } catch (error) {
          logger.error("[TOOL:insertInPage] Error", { userId: ctx.userId, pageId, error });
          return {
            success: false,
            error: "Insert failed due to an internal error while saving the new content.",
            suggestion: "Verify the page exists with getPageOutline, then retry the insertion.",
          };
        }
      },
    }),

    // --------------------------------------------------
    // Tool 3: replacePageSection (replace content under a heading)
    // --------------------------------------------------
    replacePageSection: tool({
      description: `Replace everything under a specific heading in a page. Finds the heading (case-insensitive), replaces all blocks between it and the next same-or-higher-level heading. The heading itself is preserved.

Precondition: call getPageOutline then readPageSection first, then call this tool immediately. Do not search the web or Wikipedia before editing.

When to use:
- "refais l'introduction", "rewrite the conclusion" → this tool
- "traduis cette section", "translate this section" → this tool
- Replacing outdated content under a specific heading

When NOT to use:
- Changing a few words or sentences (use editPageContent)
- Rewriting the entire page (use rewritePageContent)
- Adding new content without replacing existing text (use insertInPage)
- "corrige les fautes" (targeted fixes → use editPageContent)`,
      inputSchema: replacePageSectionSchema,
      needsApproval: true,
      execute: async ({ pageId, sectionHeading, newContent }) => {
        logger.log("[TOOL:replacePageSection] Replacing section", {
          userId: ctx.userId,
          pageId,
          sectionHeading,
        });

        try {
          const result = await fetchPageBlocks(pageId, ctx.workspaceId);
          if (!result.success) {
            return { success: false, error: result.error };
          }

          const { page, blocks } = result;
          const sanitized = sanitizeAIGeneratedContent(newContent);
          const convertedBlocks = await toBlockNoteAuto(sanitized);

          const sectionResult = replaceSectionBlocks(blocks, sectionHeading, convertedBlocks);

          if (!sectionResult.found) {
            return {
              success: false,
              error: `Section heading "${sectionHeading}" not found in the page.`,
              suggestion:
                "Call getPageOutline to see the available headings, then copy the exact heading text.",
            };
          }

          const saveResult = await savePageBlocks(
            pageId,
            ctx.workspaceId,
            sectionResult.blocks,
            "replacePageSection",
          );
          if (!saveResult.success) return saveResult;

          logger.log("[TOOL:replacePageSection] Replaced section", {
            userId: ctx.userId,
            pageId,
            title: page.title,
            sectionHeading,
            blocksReplaced: sectionResult.replacedCount,
          });
          return {
            success: true,
            pageId,
            title: page.title,
            sectionFound: true,
            blocksReplaced: sectionResult.replacedCount,
            _instruction:
              "Success. Confirm briefly to the user in their language. Do not re-call this tool on the same page.",
          };
        } catch (error) {
          logger.error("[TOOL:replacePageSection] Error", { userId: ctx.userId, pageId, error });
          return {
            success: false,
            error: "Section replacement failed due to an internal error while saving.",
            suggestion: "Verify the page and heading exist with getPageOutline, then retry.",
          };
        }
      },
    }),

    // --------------------------------------------------
    // Tool 4: rewritePageContent (full replacement — last resort)
    // --------------------------------------------------
    rewritePageContent: tool({
      description: `Replace the entire content of a page. All existing content is permanently lost. Only use this when the user explicitly asks for a full page rewrite or full page translation.

Precondition: call getPageOutline then readPageSection first, then call this tool immediately. Do not search the web or Wikipedia before editing.

When to use (only these cases):
- "traduis toute la page", "translate the entire page"
- "refais TOUT", "rewrite the whole page from scratch"
- The user explicitly says "rewrite everything" or "recommence tout"

When NOT to use:
- "complète", "ajoute", "continue", "add" → use insertInPage
- "corrige", "fix", "change X to Y" → use editPageContent
- "refais la conclusion" (one section → use replacePageSection)
- "améliore cette page" (vague → use editPageContent or replacePageSection on specific parts)
- If unsure which tool to use → do not use this tool. Choose editPageContent or insertInPage instead.

This is the most destructive editing tool. Prefer smaller-scope alternatives.`,
      inputSchema: rewritePageContentSchema,
      needsApproval: true,
      execute: async ({ pageId, content }) => {
        logger.log("[TOOL:rewritePageContent] Rewriting page", { userId: ctx.userId, pageId });

        try {
          const page = await prisma.page.findFirst({
            where: { id: pageId, workspaceId: ctx.workspaceId, isArchived: false },
            select: { id: true, title: true },
          });

          if (!page) {
            return {
              success: false,
              error: "Page not found in this workspace or it has been archived. Verify the pageId.",
            };
          }

          const sanitized = sanitizeAIGeneratedContent(content);
          const newBlocks = await toBlockNoteAuto(sanitized);

          const saveResult = await savePageBlocks(
            pageId,
            ctx.workspaceId,
            newBlocks,
            "rewritePageContent",
          );
          if (!saveResult.success) return saveResult;

          logger.log("[TOOL:rewritePageContent] Rewrote page", {
            userId: ctx.userId,
            pageId,
            title: page.title,
            blocksCount: newBlocks.length,
          });
          return {
            success: true,
            pageId,
            title: page.title,
            blocksCount: newBlocks.length,
            _instruction:
              "Success. Confirm briefly to the user in their language. Do not re-call this tool on the same page.",
          };
        } catch (error) {
          logger.error("[TOOL:rewritePageContent] Error", { userId: ctx.userId, pageId, error });
          return {
            success: false,
            error: "Rewrite failed due to an internal error while saving the new content.",
            suggestion:
              "Verify the page exists with getPageOutline, then retry. If the content is very large, try splitting into smaller sections.",
          };
        }
      },
    }),
  };
}
