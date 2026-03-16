-- AlterTable: add nullable source column to openai_usage_log
ALTER TABLE "openai_usage_log" ADD COLUMN "source" VARCHAR(50);

-- CreateIndex: composite index for GROUP BY source + time range queries
CREATE INDEX "openai_usage_log_source_created_at_idx" ON "openai_usage_log"("source", "created_at");

-- CreateIndex: btree index on usage_records metadata->>'action' for credits-by-source queries
CREATE INDEX "idx_usage_records_metadata_action" ON "usage_records" ((metadata->>'action'));
