/**
 * Per-pageId in-memory cache of parsed BlockNote blocks.
 *
 * Purpose: when the agent issues several sequential edit tool calls on the
 * same page inside one mutex burst, every call would otherwise re-fetch
 * blockNoteContent from Postgres just to re-parse the JSON it just wrote.
 * The cache lets a freshly-saved version be reused for the next call.
 *
 * Short TTL (5s) — only meant to bridge the burst, not to serve stale data
 * once the mutex releases.
 */

import type { BlockNoteBlock } from "../../../../controllers/assistant/helpers/blocknote.js";

const PAGE_BLOCKS_CACHE_TTL_MS = 5_000;

interface PageBlocksCacheEntry {
  blocks: BlockNoteBlock[];
  page: { id: string; title: string };
  expiresAt: number;
}

const pageBlocksCache = new Map<string, PageBlocksCacheEntry>();

export function getCachedPageBlocks(pageId: string): PageBlocksCacheEntry | null {
  const entry = pageBlocksCache.get(pageId);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    pageBlocksCache.delete(pageId);
    return null;
  }
  return entry;
}

export function setCachedPageBlocks(
  pageId: string,
  page: { id: string; title: string },
  blocks: BlockNoteBlock[],
): void {
  pageBlocksCache.set(pageId, {
    page,
    blocks,
    expiresAt: Date.now() + PAGE_BLOCKS_CACHE_TTL_MS,
  });
}

export function invalidateCachedPageBlocks(pageId: string): void {
  pageBlocksCache.delete(pageId);
}
