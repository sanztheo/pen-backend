/*
  Warnings:

  - The primary key for the `quiz_sequences` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- AlterTable
ALTER TABLE "quiz_sequences" DROP CONSTRAINT "quiz_sequences_pkey",
ALTER COLUMN "id" SET DATA TYPE TEXT,
ADD CONSTRAINT "quiz_sequences_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "quizzes" ALTER COLUMN "sequence_id" SET DATA TYPE TEXT;
