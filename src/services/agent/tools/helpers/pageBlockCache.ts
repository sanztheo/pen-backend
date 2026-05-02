/**
 * Per-page in-memory cache of parsed BlockNote blocks.
 *
 * Purpose: when the agent issues several sequential edit tool calls on the
 * same page inside one mutex burst, every call would otherwise re-fetch
 * blockNoteContent from Postgres just to re-parse the JSON it just wrote.
 * The cache lets a freshly-saved version be reused for the next call.
 *
 * Short TTL (5s) — only meant to bridge the burst, not to serve stale data
 * once the mutex releases.
 *
 * Keyed by `${workspaceId}:${pageId}` — pages are workspace-scoped, and the
 * cache hit must not bypass the workspaceId check that the DB-miss path
 * enforces via `findFirst({ id, workspaceId })`. Mirrors the composite key
 * used by `withPageEditLock`.
 */

import type { BlockNoteBlock } from "../../../../controllers/assistant/helpers/blocknote.js";

const PAGE_BLOCKS_CACHE_TTL_MS = 5_000;

interface PageBlocksCacheEntry {
  blocks: BlockNoteBlock[];
  page: { id: string; title: string };
  expiresAt: number;
}

const pageBlocksCache = new Map<string, PageBlocksCacheEntry>();

function buildKey(workspaceId: string, pageId: string): string {
  return `${workspaceId}:${pageId}`;
}

export function getCachedPageBlocks(
  workspaceId: string,
  pageId: string,
): PageBlocksCacheEntry | null {
  const key = buildKey(workspaceId, pageId);
  const entry = pageBlocksCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    pageBlocksCache.delete(key);
    return null;
  }
  return entry;
}

export function setCachedPageBlocks(
  workspaceId: string,
  pageId: string,
  page: { id: string; title: string },
  blocks: BlockNoteBlock[],
): void {
  pageBlocksCache.set(buildKey(workspaceId, pageId), {
    page,
    blocks,
    expiresAt: Date.now() + PAGE_BLOCKS_CACHE_TTL_MS,
  });
}

export function invalidateCachedPageBlocks(workspaceId: string, pageId: string): void {
  pageBlocksCache.delete(buildKey(workspaceId, pageId));
}
