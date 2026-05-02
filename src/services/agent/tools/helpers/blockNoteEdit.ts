import type {
  BlockNoteBlock,
  InlineContent,
} from "../../../../controllers/assistant/helpers/blocknote.js";
import { parseInlineContent } from "../../../../controllers/assistant/helpers/blocknote.js";
import {
  buildNormalizedBlock,
  buildNormalizedSearch,
  MATCHING_STRATEGIES,
  stripMarkdownLineMarkers,
} from "./blockNoteMatch.js";

// =====================================================
// Types
// =====================================================

export interface BlockTextEntry {
  blockIndex: number;
  text: string;
  type: string;
  headingLevel?: number;
}

export type MatchStrategyName =
  | "exactMatch"
  | "trimmedMatch"
  | "caseInsensitiveMatch"
  | "unicodeNormalizedMatch"
  | "whitespaceNormalizedMatch"
  | "markdownStrippedMatch";

export interface FindResult {
  found: boolean;
  matches: Array<{ blockIndex: number; text: string }>;
  /** Which matching strategy produced the result (for logging/debugging) */
  matchLevel?: MatchStrategyName;
  /** When no match is found, the closest matching block text (truncated to 200 chars) */
  closestMatch?: string;
}

export interface ReplaceSectionResult {
  blocks: BlockNoteBlock[];
  found: boolean;
  replacedCount: number;
}

export interface InsertResult {
  blocks: BlockNoteBlock[];
  found: boolean;
}

// =====================================================
// Helpers
// =====================================================

/** Concatenate all text from a block's inline content items */
function concatBlockText(block: BlockNoteBlock): string {
  if (!block.content || block.content.length === 0) return "";

  return block.content
    .map((item: InlineContent) => {
      if (item.type === "text") return item.text;
      if (item.type === "inlineLatex") return item.props.latex;
      return "";
    })
    .join("");
}

/**
 * Concatenate text from a block AND all its nested children recursively.
 * Use this for search/matching where nested content must be visible.
 */
function extractFullBlockText(block: BlockNoteBlock): string {
  const parts: string[] = [concatBlockText(block)];

  if (block.children && block.children.length > 0) {
    for (const child of block.children) {
      parts.push(extractFullBlockText(child));
    }
  }

  return parts.filter(Boolean).join(" ");
}

/**
 * Simple character bigram overlap ratio (0-1).
 * Avoids external deps while giving reasonable fuzzy similarity.
 */
function textSimilarity(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;

  const MAX_SIMILARITY_LEN = 500;
  const lower_a = a.toLowerCase().slice(0, MAX_SIMILARITY_LEN);
  const lower_b = b.toLowerCase().slice(0, MAX_SIMILARITY_LEN);
  if (lower_a === lower_b) return 1;

  const bigramsA = new Set<string>();
  for (let i = 0; i < lower_a.length - 1; i++) {
    bigramsA.add(lower_a.slice(i, i + 2));
  }

  const bigramsB = new Set<string>();
  for (let i = 0; i < lower_b.length - 1; i++) {
    bigramsB.add(lower_b.slice(i, i + 2));
  }

  let intersection = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++;
  }

  const union = bigramsA.size + bigramsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Find the index of a heading block by title (case-insensitive, trimmed) */
function findHeadingIndex(blocks: BlockNoteBlock[], title: string): number {
  const normalizedTitle = title.trim().toLowerCase();
  return blocks.findIndex(
    (b) => b.type === "heading" && concatBlockText(b).trim().toLowerCase() === normalizedTitle,
  );
}

/**
 * Find where a section ends: the next heading of same or higher level, or end of document.
 * Shared by replaceSectionBlocks and insertBlocksAtPosition to avoid logic duplication.
 */
function findSectionEnd(blocks: BlockNoteBlock[], headingIndex: number): number {
  const headingLevel = blocks[headingIndex].props?.level ?? 2;

  for (let i = headingIndex + 1; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === "heading") {
      const level = b.props?.level ?? 2;
      if (level <= headingLevel) return i;
    }
  }

  return blocks.length;
}

// =====================================================
// Public Functions
// =====================================================

/**
 * Walk the blocks array and extract text content per block.
 * Returns an array mapping block index to its concatenated text, type, and optional heading level.
 * Recursively includes text from nested children (indented lists, toggles, etc.).
 * The blockIndex still refers to the top-level block for edit operations.
 */
export function extractTextPerBlock(blocks: BlockNoteBlock[]): BlockTextEntry[] {
  const entries: BlockTextEntry[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const text = extractFullBlockText(block);
    const entry: BlockTextEntry = {
      blockIndex: i,
      text,
      type: block.type,
    };

    if (block.type === "heading" && block.props?.level !== undefined) {
      entry.headingLevel = block.props.level;
    }

    entries.push(entry);
  }

  return entries;
}

/**
 * Find which block(s) contain searchText.
 * Uses a cascade of increasingly permissive matching strategies (continue.dev pattern):
 * 1. Exact substring
 * 2. Trimmed (leading/trailing whitespace)
 * 3. Case-insensitive
 * 4. Whitespace-normalized (collapse + lowercase)
 *
 * Returns the first strategy that produces matches, with matchLevel indicating which one hit.
 */
export function findTextInBlocks(blocks: BlockNoteBlock[], searchText: string): FindResult {
  if (searchText.trim().length === 0) {
    return { found: false, matches: [] };
  }

  const entries = extractTextPerBlock(blocks);
  // Pre-compute normalized variants once so cascade strategies become pure
  // comparisons (no per-block re-normalization across 6 strategy levels).
  const normalizedSearch = buildNormalizedSearch(searchText);
  const normalizedBlocks = entries.map(buildNormalizedBlock);

  for (const strategy of MATCHING_STRATEGIES) {
    const matches = normalizedBlocks.filter((b) => strategy.match(b, normalizedSearch));
    if (matches.length > 0) {
      return {
        found: true,
        matches: matches.map((b) => ({ blockIndex: b.blockIndex, text: b.raw })),
        matchLevel: strategy.name,
      };
    }
  }

  // No strategy matched — find the closest block text for self-correction
  const closestMatch = findClosestBlockText(entries, searchText);
  return { found: false, matches: [], closestMatch };
}

/** Find the block text most similar to searchText (for error messages) */
function findClosestBlockText(entries: BlockTextEntry[], searchText: string): string | undefined {
  let bestScore = 0;
  let bestText: string | undefined;

  for (const entry of entries) {
    if (entry.text.length === 0) continue;
    const score = textSimilarity(entry.text, searchText);
    if (score > bestScore) {
      bestScore = score;
      bestText = entry.text;
    }
  }

  if (!bestText || bestScore < 0.1) return undefined;
  return bestText.length > 200 ? bestText.slice(0, 200) + "..." : bestText;
}

export interface ReplaceTextResult {
  block: BlockNoteBlock;
  changed: boolean;
}

/**
 * Replace oldText with newText inside a single block's content.
 * Preserves existing styles by replacing within individual content items when possible.
 * Falls back to full re-parse only when the match spans multiple items.
 *
 * Returns `{ block, changed }` so callers can detect no-op without paying the
 * cost of `JSON.stringify` equality on potentially large blocks.
 */
export function replaceTextInBlock(
  block: BlockNoteBlock,
  oldText: string,
  newText: string,
): ReplaceTextResult {
  if (!block.content || block.content.length === 0) {
    return { block, changed: false };
  }

  // Try to find the match within a single content item (preserves styles)
  const singleItemResult = replaceInSingleItem(block.content, oldText, newText);
  if (singleItemResult) {
    return { block: { ...block, content: singleItemResult }, changed: true };
  }

  // Try recursive replacement in children if block has nested content
  const childResult = replaceInChildren(block, oldText, newText);
  if (childResult) return { block: childResult, changed: true };

  // Fallback: match spans multiple items — flatten, replace first occurrence, re-parse (loses styles)
  const fullText = concatBlockText(block);
  const replaced = fullText.replace(oldText, newText);
  if (replaced !== fullText) {
    const newContent = parseInlineContent(replaced);
    return {
      block: {
        ...block,
        content: newContent.length > 0 ? newContent : [{ type: "text" as const, text: replaced }],
      },
      changed: true,
    };
  }

  // Final fallback: AI may have included markdown markers (e.g. "### Title")
  // that don't appear in stored block content. Strip and retry.
  const strippedOld = stripMarkdownLineMarkers(oldText);
  const strippedNew = stripMarkdownLineMarkers(newText);
  if (strippedOld !== oldText) {
    const strippedReplaced = fullText.replace(strippedOld, strippedNew);
    if (strippedReplaced !== fullText) {
      const newContent = parseInlineContent(strippedReplaced);
      return {
        block: {
          ...block,
          content:
            newContent.length > 0
              ? newContent
              : [{ type: "text" as const, text: strippedReplaced }],
        },
        changed: true,
      };
    }
  }

  return { block, changed: false };
}

/** Try replacing oldText in nested children blocks recursively */
function replaceInChildren(
  block: BlockNoteBlock,
  oldText: string,
  newText: string,
): BlockNoteBlock | null {
  if (!block.children || block.children.length === 0) return null;

  for (let i = 0; i < block.children.length; i++) {
    const child = block.children[i];
    const childResult = replaceTextInBlock(child, oldText, newText);

    if (childResult.changed) {
      const newChildren = [...block.children];
      newChildren[i] = childResult.block;
      return { ...block, children: newChildren };
    }
  }

  return null;
}

/** Try replacing oldText within a single content item, preserving all styles */
function replaceInSingleItem(
  content: InlineContent[],
  oldText: string,
  newText: string,
): InlineContent[] | null {
  for (let i = 0; i < content.length; i++) {
    const item = content[i];
    if (item.type !== "text") continue;
    if (!item.text.includes(oldText)) continue;

    // Found the match in a single item — replace first occurrence and preserve styles
    const newItems = [...content];
    newItems[i] = { ...item, text: item.text.replace(oldText, newText) };
    return newItems;
  }
  return null;
}

/**
 * Replace the content blocks under a specific heading section.
 * Finds a heading matching sectionTitle (case-insensitive trim), then replaces
 * all blocks between it and the next heading of same or higher level (or end of document).
 * The heading itself is preserved; only the content blocks after it are replaced.
 */
export function replaceSectionBlocks(
  blocks: BlockNoteBlock[],
  sectionTitle: string,
  newBlocks: BlockNoteBlock[],
): ReplaceSectionResult {
  const headingIndex = findHeadingIndex(blocks, sectionTitle);

  if (headingIndex === -1) {
    return { blocks: [...blocks], found: false, replacedCount: 0 };
  }

  const endIndex = findSectionEnd(blocks, headingIndex);
  const replacedCount = endIndex - headingIndex - 1;

  // Build new array: before + heading + newBlocks + after
  const result = [...blocks.slice(0, headingIndex + 1), ...newBlocks, ...blocks.slice(endIndex)];

  return { blocks: result, found: true, replacedCount };
}

/**
 * Insert newBlocks at a specific position in the blocks array.
 * - "start": prepend before all existing blocks
 * - "end": append after all existing blocks
 * - { afterHeading: "title" }: insert at the end of the heading's section (before next same/higher-level heading)
 *
 * Returns { blocks, found } so callers can detect when a heading was not found.
 */
export function insertBlocksAtPosition(
  blocks: BlockNoteBlock[],
  newBlocks: BlockNoteBlock[],
  position: "start" | "end" | { afterHeading: string },
): InsertResult {
  if (position === "start") {
    return { blocks: [...newBlocks, ...blocks], found: true };
  }

  if (position === "end") {
    return { blocks: [...blocks, ...newBlocks], found: true };
  }

  // { afterHeading: "title" } — insert at end of section, not right after heading
  const headingIndex = findHeadingIndex(blocks, position.afterHeading);

  if (headingIndex === -1) {
    return { blocks: [...blocks], found: false };
  }

  const sectionEnd = findSectionEnd(blocks, headingIndex);

  return {
    blocks: [...blocks.slice(0, sectionEnd), ...newBlocks, ...blocks.slice(sectionEnd)],
    found: true,
  };
}
