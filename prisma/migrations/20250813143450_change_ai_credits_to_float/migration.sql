-- AlterTable
ALTER TABLE "public"."user_limits" ALTER COLUMN "ai_credits_used" SET DEFAULT 0,
ALTER COLUMN "ai_credits_used" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "ai_credits_limit" SET DEFAULT 50,
ALTER COLUMN "ai_credits_limit" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "pages_limit" SET DEFAULT -1;
