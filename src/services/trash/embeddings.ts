import { logger } from "../../utils/logger.js";

/**
 * Best-effort cleanup of vector DB embeddings for the given page IDs.
 * Soft-fails: logs but doesn't throw — the trash flow must never be blocked
 * by a vector DB outage. A reconciliation job can clean leftovers later.
 *
 * Pages are stored in the embeddings DB as `RAGSource` rows of type
 * `WORKSPACE_PAGE` with `metadata.pageId` pointing at the page UUID.
 *
 * Exported for reuse by the BullMQ empty-trash worker.
 */
export async function cleanupEmbeddingsForPages(pageIds: string[]): Promise<void> {
  if (pageIds.length === 0) return;
  try {
    const { prismaEmbeddings } = await import("../../lib/prismaEmbeddings.js");
    // Index-friendly: `= ANY($1::text[])` lets Postgres hit the partial
    // expression index `rag_source_page_id_idx` on ((metadata->>'pageId'))
    // WHERE source_type = 'WORKSPACE_PAGE'.
    const sources = await prismaEmbeddings.$queryRaw<{ id: string }[]>`
      SELECT id FROM "rag_sources"
      WHERE source_type = 'WORKSPACE_PAGE'
        AND metadata->>'pageId' = ANY(${pageIds}::text[])
    `;
    if (sources.length === 0) return;
    const sourceIds = sources.map((s) => s.id);
    await prismaEmbeddings.$transaction([
      prismaEmbeddings.rAGChunk.deleteMany({ where: { sourceId: { in: sourceIds } } }),
      prismaEmbeddings.rAGSource.deleteMany({ where: { id: { in: sourceIds } } }),
    ]);
    logger.info("[TRASH] embeddings cleanup", { sources: sources.length });
  } catch (e) {
    logger.error("[TRASH] embeddings cleanup failed", {
      error: e instanceof Error ? e.message : String(e),
      pageIds: pageIds.length,
    });
  }
}
