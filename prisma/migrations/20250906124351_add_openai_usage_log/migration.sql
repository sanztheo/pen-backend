-- CreateTable
CREATE TABLE "public"."openai_usage_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "quota_key" VARCHAR(100) NOT NULL DEFAULT 'global',
    "model" VARCHAR(100) NOT NULL,
    "prompt_tokens" INTEGER NOT NULL,
    "completion_tokens" INTEGER NOT NULL,
    "estimated_cost" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "openai_usage_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "openai_usage_log_quota_key_created_at_idx" ON "public"."openai_usage_log"("quota_key", "created_at");

-- CreateIndex
CREATE INDEX "openai_usage_log_created_at_idx" ON "public"."openai_usage_log"("created_at");
