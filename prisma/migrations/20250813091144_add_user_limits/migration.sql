-- CreateTable
CREATE TABLE "user_limits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" VARCHAR(255) NOT NULL,
    "ai_credits_used" INTEGER NOT NULL DEFAULT 0,
    "ai_credits_limit" INTEGER NOT NULL DEFAULT 50,
    "workspaces_used" INTEGER NOT NULL DEFAULT 0,
    "workspaces_limit" INTEGER NOT NULL DEFAULT 2,
    "projects_used" INTEGER NOT NULL DEFAULT 0,
    "projects_limit" INTEGER NOT NULL DEFAULT 4,
    "custom_quizzes_used" INTEGER NOT NULL DEFAULT 0,
    "custom_quizzes_limit" INTEGER NOT NULL DEFAULT 5,
    "preset_sequences_used" INTEGER NOT NULL DEFAULT 0,
    "preset_sequences_limit" INTEGER NOT NULL DEFAULT 1,
    "last_reset_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reset_type" VARCHAR(20) NOT NULL DEFAULT 'monthly',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_limits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_limits_user_id_key" ON "user_limits"("user_id");

-- CreateIndex
CREATE INDEX "user_limits_user_id_idx" ON "user_limits"("user_id");

-- AddForeignKey
ALTER TABLE "user_limits" ADD CONSTRAINT "user_limits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
