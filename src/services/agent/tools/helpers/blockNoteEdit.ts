import type {
  BlockNoteBlock,
  InlineContent,
} from "../../../../controllers/assistant/helpers/blocknote.js";
import { parseInlineContent } from "../../../../controllers/assistant/helpers/blocknote.js";

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
  | "whitespaceNormalizedMatch";

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

/** Normalize whitespace: trim + collapse internal spaces */
function normalizeWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/**
 * Normalize Unicode confusables that LLMs commonly swap.
 * Covers curly quotes, apostrophes, dashes, special spaces, ellipsis, etc.
 */
function normalizeUnicode(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A\u02BC\u02B9]/g, "'") // curly/modifier apostrophes → straight
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"') // curly double quotes → straight
    .replace(/[\u2013\u2014\u2015]/g, "-") // en-dash, em-dash, horizontal bar → hyphen
    .replace(/[\u2026]/g, "...") // ellipsis → three dots
    .replace(/[\u00A0\u2007\u202F\u2060]/g, " ") // non-breaking/figure/narrow spaces → regular
    .replace(/[\u00D7]/g, "x") // multiplication sign → x
    .replace(/[\u2212]/g, "-"); // minus sign → hyphen
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
// Matching Strategies (continue.dev cascade pattern)
// Each level adds exactly one relaxation over the previous.
// =====================================================

interface MatchStrategy {
  name: MatchStrategyName;
  match: (blockText: string, searchText: string) => boolean;
}

/** Level 1: Pure exact substring match */
function exactMatch(blockText: string, searchText: string): boolean {
  return blockText.includes(searchText);
}

/** Level 2: Trim leading/trailing whitespace before matching */
function trimmedMatch(blockText: string, searchText: string): boolean {
  return blockText.trim().includes(searchText.trim());
}

/** Level 3: Case-insensitive substring match */
function caseInsensitiveMatch(blockText: string, searchText: string): boolean {
  return blockText.toLowerCase().includes(searchText.toLowerCase());
}

/** Level 4: Normalize Unicode confusables + case-insensitive */
function unicodeNormalizedMatch(blockText: string, searchText: string): boolean {
  return normalizeUnicode(blockText)
    .toLowerCase()
    .includes(normalizeUnicode(searchText).toLowerCase());
}

/** Level 5: Collapse all whitespace + Unicode normalization + lowercase (most permissive) */
function whitespaceNormalizedMatch(blockText: string, searchText: string): boolean {
  const normalizedBlock = normalizeWhitespace(normalizeUnicode(blockText)).toLowerCase();
  const normalizedSearch = normalizeWhitespace(normalizeUnicode(searchText)).toLowerCase();
  return normalizedBlock.includes(normalizedSearch);
}

/** Cascade of increasingly permissive matching strategies */
const MATCHING_STRATEGIES: readonly MatchStrategy[] = [
  { name: "exactMatch", match: exactMatch },
  { name: "trimmedMatch", match: trimmedMatch },
  { name: "caseInsensitiveMatch", match: caseInsensitiveMatch },
  { name: "unicodeNormalizedMatch", match: unicodeNormalizedMatch },
  { name: "whitespaceNormalizedMatch", match: whitespaceNormalizedMatch },
];

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

  for (const strategy of MATCHING_STRATEGIES) {
    const matches = entries.filter((e) => strategy.match(e.text, searchText));
    if (matches.length > 0) {
      return {
        found: true,
        matches: matches.map((e) => ({ blockIndex: e.blockIndex, text: e.text })),
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

/**
 * Replace oldText with newText inside a single block's content.
 * Preserves existing styles by replacing within individual content items when possible.
 * Falls back to full re-parse only when the match spans multiple items.
 */
export function replaceTextInBlock(
  block: BlockNoteBlock,
  oldText: string,
  newText: string,
): BlockNoteBlock {
  if (!block.content || block.content.length === 0) return block;

  // Try to find the match within a single content item (preserves styles)
  const singleItemResult = replaceInSingleItem(block.content, oldText, newText);
  if (singleItemResult) {
    return { ...block, content: singleItemResult };
  }

  // Try recursive replacement in children if block has nested content
  const childResult = replaceInChildren(block, oldText, newText);
  if (childResult) return childResult;

  // Fallback: match spans multiple items — flatten, replace first occurrence, re-parse (loses styles)
  const fullText = concatBlockText(block);
  const replaced = fullText.replace(oldText, newText);
  if (replaced === fullText) return block;

  const newContent = parseInlineContent(replaced);
  return {
    ...block,
    content: newContent.length > 0 ? newContent : [{ type: "text" as const, text: replaced }],
  };
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
    const updatedChild = replaceTextInBlock(child, oldText, newText);

    if (updatedChild !== child) {
      const newChildren = [...block.children];
      newChildren[i] = updatedChild;
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
