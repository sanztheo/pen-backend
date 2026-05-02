/**
 * Cascade text-matching strategies used by `findTextInBlocks`.
 *
 * Each strategy adds exactly one relaxation over the previous (continue.dev pattern).
 * Strategies operate on PRE-NORMALIZED variants so a single findTextInBlocks call
 * normalizes each block exactly once across all 6 cascade levels.
 */

import type { BlockTextEntry, MatchStrategyName } from "./blockNoteEdit.js";

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
    .replace(/[\u2018\u2019\u201A\u02BC\u02B9]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014\u2015]/g, "-")
    .replace(/[\u2026]/g, "...")
    .replace(/[\u00A0\u2007\u202F\u2060]/g, " ")
    .replace(/[\u00D7]/g, "x")
    .replace(/[\u2212]/g, "-");
}

/**
 * Strip leading markdown line markers from each line of `text`.
 * Handles: ATX headings (# – ######), bullet lists (-, *, +), ordered lists (1.),
 * blockquotes (>), task list checkboxes ([ ]/[x]).
 */
export function stripMarkdownLineMarkers(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*#{1,6}\s+/, "")
        .replace(/^\s*[-*+]\s+(?:\[[ xX]\]\s+)?/, "")
        .replace(/^\s*\d+\.\s+/, "")
        .replace(/^\s*>\s?/, ""),
    )
    .join("\n");
}

export interface NormalizedBlock {
  blockIndex: number;
  raw: string;
  trimmed: string;
  lower: string;
  unicodeLower: string;
  whitespace: string;
}

export interface NormalizedSearch {
  raw: string;
  trimmed: string;
  lower: string;
  unicodeLower: string;
  whitespace: string;
  /** stripped variant — undefined when stripping is a no-op (skip cascade level 6) */
  whitespaceStripped: string | undefined;
}

interface MatchStrategy {
  name: MatchStrategyName;
  match: (block: NormalizedBlock, search: NormalizedSearch) => boolean;
}

export function buildNormalizedSearch(searchText: string): NormalizedSearch {
  const stripped = stripMarkdownLineMarkers(searchText);
  const whitespaceStripped =
    stripped === searchText
      ? undefined
      : normalizeWhitespace(normalizeUnicode(stripped)).toLowerCase();
  return {
    raw: searchText,
    trimmed: searchText.trim(),
    lower: searchText.toLowerCase(),
    unicodeLower: normalizeUnicode(searchText).toLowerCase(),
    whitespace: normalizeWhitespace(normalizeUnicode(searchText)).toLowerCase(),
    whitespaceStripped,
  };
}

export function buildNormalizedBlock(entry: BlockTextEntry): NormalizedBlock {
  return {
    blockIndex: entry.blockIndex,
    raw: entry.text,
    trimmed: entry.text.trim(),
    lower: entry.text.toLowerCase(),
    unicodeLower: normalizeUnicode(entry.text).toLowerCase(),
    whitespace: normalizeWhitespace(normalizeUnicode(entry.text)).toLowerCase(),
  };
}

/** Level 1: Pure exact substring match */
function exactMatch(block: NormalizedBlock, search: NormalizedSearch): boolean {
  return block.raw.includes(search.raw);
}

/** Level 2: Trim leading/trailing whitespace before matching */
function trimmedMatch(block: NormalizedBlock, search: NormalizedSearch): boolean {
  return block.trimmed.includes(search.trimmed);
}

/** Level 3: Case-insensitive substring match */
function caseInsensitiveMatch(block: NormalizedBlock, search: NormalizedSearch): boolean {
  return block.lower.includes(search.lower);
}

/** Level 4: Normalize Unicode confusables + case-insensitive */
function unicodeNormalizedMatch(block: NormalizedBlock, search: NormalizedSearch): boolean {
  return block.unicodeLower.includes(search.unicodeLower);
}

/** Level 5: Collapse all whitespace + Unicode normalization + lowercase */
function whitespaceNormalizedMatch(block: NormalizedBlock, search: NormalizedSearch): boolean {
  return block.whitespace.includes(search.whitespace);
}

/** Level 6: Strip markdown line markers from searchText before whitespace-normalized match */
function markdownStrippedMatch(block: NormalizedBlock, search: NormalizedSearch): boolean {
  if (search.whitespaceStripped === undefined) return false;
  return block.whitespace.includes(search.whitespaceStripped);
}

export const MATCHING_STRATEGIES: readonly MatchStrategy[] = [
  { name: "exactMatch", match: exactMatch },
  { name: "trimmedMatch", match: trimmedMatch },
  { name: "caseInsensitiveMatch", match: caseInsensitiveMatch },
  { name: "unicodeNormalizedMatch", match: unicodeNormalizedMatch },
  { name: "whitespaceNormalizedMatch", match: whitespaceNormalizedMatch },
  { name: "markdownStrippedMatch", match: markdownStrippedMatch },
];
