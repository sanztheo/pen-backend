-- AlterTable
ALTER TABLE "quizzes" ADD COLUMN     "has_documents" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "source_documents" JSONB;
