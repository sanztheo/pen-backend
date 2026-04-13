-- Partial expression index for trash cleanupEmbeddingsForPages.
-- Without this, queries filtering RAGSource by metadata->>'pageId' fall back
-- to a sequential scan on the embeddings table — catastrophic at scale.
--
-- Why this lives outside schema.prisma:
--   Prisma DSL does not support expression indexes (function-based or JSON path).
--   Pennote uses `db push` for schema sync, so this DDL is kept as a re-runnable
--   script. Re-run after any `db push --force-reset` or fresh DB provisioning:
--     infisical run --env=dev --path=/Backend -- npx prisma db execute \
--       --file prisma/sql/rag_source_page_id_idx.sql --schema prisma/schema-embeddings.prisma
--
-- IDEMPOTENT: safe to re-run.

CREATE INDEX IF NOT EXISTS "rag_source_page_id_idx"
  ON "rag_sources" ((metadata->>'pageId'))
  WHERE source_type = 'WORKSPACE_PAGE';
