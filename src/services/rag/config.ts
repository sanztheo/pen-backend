/**
 * Shared RAG pipeline configuration.
 * Centralises env-var reads that were duplicated across 4+ RAG service files.
 */
export const RAG_CONFIG = {
  /** Max parallel embedding calls. index.ts intentionally uses a higher default (10). */
  EMBEDDING_CONCURRENCY: Math.max(1, parseInt(process.env.RAG_EMBEDDING_CONCURRENCY || "2", 10)),
  /** High-throughput concurrency for the main RAG indexer (index.ts). */
  EMBEDDING_CONCURRENCY_HIGH: Math.max(
    1,
    parseInt(process.env.RAG_EMBEDDING_CONCURRENCY || "10", 10),
  ),
  /** Number of prepared vectors to insert per DB batch. */
  DB_BATCH_SIZE: Math.max(1, parseInt(process.env.RAG_DB_BATCH_SIZE || "100", 10)),
} as const;
