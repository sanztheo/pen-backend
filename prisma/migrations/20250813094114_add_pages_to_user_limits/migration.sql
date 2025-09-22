-- AlterTable
ALTER TABLE "public"."user_limits" ADD COLUMN     "pages_limit" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "pages_used" INTEGER NOT NULL DEFAULT 0;
