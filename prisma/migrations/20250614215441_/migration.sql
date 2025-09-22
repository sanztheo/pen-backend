-- AlterTable
ALTER TABLE "blocks" ADD COLUMN     "deleted_at" TIMESTAMPTZ(6),
ADD COLUMN     "is_deleted" BOOLEAN NOT NULL DEFAULT false;
