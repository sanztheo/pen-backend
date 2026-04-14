/**
 * Extracts plain text from BlockNote page content.
 * Used by the quiz pipeline to build course text from selected pages.
 */

import { logger } from "../../utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BlockNoteContentItem {
  text?: string;
  type?: string;
}

interface BlockNoteBlock {
  type?: string;
  content?: BlockNoteContentItem[] | unknown;
}

interface PageRecord {
  id: string;
  title: string;
  blockNoteContent: unknown;
}

// ---------------------------------------------------------------------------
// Main Function
// ---------------------------------------------------------------------------

/**
 * Extract plain text from an array of page records.
 * Filters paragraph blocks from blockNoteContent and concatenates their text.
 *
 * @param pages - Array of page records with blockNoteContent
 * @returns Object with courseText (concatenated) and courseTitle (first page title)
 */
export function extractPageText(pages: PageRecord[]): {
  courseText: string;
  courseTitle: string;
} {
  if (pages.length === 0) {
    throw new Error("[extractPageText] No pages provided");
  }

  const textParts: string[] = [];

  for (const page of pages) {
    const pageText = extractSinglePageText(page);
    if (pageText.length > 0) {
      textParts.push(`--- ${page.title} ---\n${pageText}`);
    }
  }

  const courseText = textParts.join("\n\n");
  const courseTitle = pages.map((p) => p.title).join(" + ");

  logger.log(`[extractPageText] Extracted ${courseText.length} chars from ${pages.length} page(s)`);

  return { courseText, courseTitle };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractSinglePageText(page: PageRecord): string {
  if (!page.blockNoteContent) {
    logger.warn(`[extractPageText] Page "${page.title}" has no blockNoteContent`);
    return page.title;
  }

  try {
    const content =
      typeof page.blockNoteContent === "string"
        ? JSON.parse(page.blockNoteContent)
        : page.blockNoteContent;

    if (!Array.isArray(content)) {
      return page.title;
    }

    const paragraphs = (content as BlockNoteBlock[])
      .filter((block) => block?.type === "paragraph" && block?.content)
      .map((block) =>
        Array.isArray(block.content)
          ? (block.content as BlockNoteContentItem[]).map((item) => item?.text ?? "").join("")
          : "",
      )
      .filter(Boolean);

    if (paragraphs.length === 0) {
      return page.title;
    }

    return page.title + "\n\n" + paragraphs.join("\n\n");
  } catch (error) {
    logger.warn(
      `[extractPageText] Error parsing page "${page.title}": ${error instanceof Error ? error.message : String(error)}`,
    );
    return page.title;
  }
}
