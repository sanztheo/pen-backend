-- AlterTable
ALTER TABLE "quizzes" ADD COLUMN     "current_subject_index" INTEGER DEFAULT 0,
ADD COLUMN     "subject_based" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "subjects" JSONB;
