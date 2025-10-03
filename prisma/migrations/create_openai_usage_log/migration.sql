-- CreateTable
CREATE TABLE "openai_usage_log" (
    "id" TEXT NOT NULL,
    "quota_key" TEXT NOT NULL DEFAULT 'global',
    "model" TEXT NOT NULL,
    "prompt_tokens" INTEGER NOT NULL,
    "completion_tokens" INTEGER NOT NULL,
    "estimated_cost" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "openai_usage_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "openai_usage_log_quota_key_created_at_idx" ON "openai_usage_log"("quota_key", "created_at");
CREATE INDEX "openai_usage_log_created_at_idx" ON "openai_usage_log"("created_at");

-- Add cleanup job for old data (optional)
COMMENT ON TABLE "openai_usage_log" IS 'Log des usages OpenAI pour la gestion des quotas';