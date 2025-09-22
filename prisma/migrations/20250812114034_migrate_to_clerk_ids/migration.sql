/*
  Warnings:

  - The primary key for the `users` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- DropForeignKey
ALTER TABLE "activity_logs" DROP CONSTRAINT "activity_logs_user_id_fkey";

-- DropForeignKey
ALTER TABLE "pages" DROP CONSTRAINT "pages_created_by_fkey";

-- DropForeignKey
ALTER TABLE "projects" DROP CONSTRAINT "projects_created_by_fkey";

-- DropForeignKey
ALTER TABLE "quiz_sequences" DROP CONSTRAINT "quiz_sequences_user_id_fkey";

-- DropForeignKey
ALTER TABLE "quiz_templates" DROP CONSTRAINT "quiz_templates_user_id_fkey";

-- DropForeignKey
ALTER TABLE "quizzes" DROP CONSTRAINT "quizzes_user_id_fkey";

-- DropForeignKey
ALTER TABLE "user_quiz_preferences" DROP CONSTRAINT "user_quiz_preferences_user_id_fkey";

-- DropForeignKey
ALTER TABLE "workspace_members" DROP CONSTRAINT "workspace_members_invited_by_fkey";

-- DropForeignKey
ALTER TABLE "workspace_members" DROP CONSTRAINT "workspace_members_user_id_fkey";

-- DropForeignKey
ALTER TABLE "workspaces" DROP CONSTRAINT "workspaces_owner_id_fkey";

-- AlterTable
ALTER TABLE "activity_logs" ALTER COLUMN "user_id" SET DATA TYPE VARCHAR(255);

-- AlterTable
ALTER TABLE "pages" ALTER COLUMN "created_by" SET DATA TYPE VARCHAR(255);

-- AlterTable
ALTER TABLE "projects" ALTER COLUMN "created_by" SET DATA TYPE VARCHAR(255);

-- AlterTable
ALTER TABLE "quiz_sequences" ALTER COLUMN "user_id" SET DATA TYPE VARCHAR(255);

-- AlterTable
ALTER TABLE "quiz_templates" ALTER COLUMN "user_id" SET DATA TYPE VARCHAR(255);

-- AlterTable
ALTER TABLE "quizzes" ALTER COLUMN "user_id" SET DATA TYPE VARCHAR(255);

-- AlterTable
ALTER TABLE "user_quiz_preferences" ALTER COLUMN "user_id" SET DATA TYPE VARCHAR(255);

-- AlterTable
ALTER TABLE "users" DROP CONSTRAINT "users_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE VARCHAR(255),
ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "workspace_members" ALTER COLUMN "user_id" SET DATA TYPE VARCHAR(255),
ALTER COLUMN "invited_by" SET DATA TYPE VARCHAR(255);

-- AlterTable
ALTER TABLE "workspaces" ALTER COLUMN "owner_id" SET DATA TYPE VARCHAR(255);

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_quiz_preferences" ADD CONSTRAINT "user_quiz_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_templates" ADD CONSTRAINT "quiz_templates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_sequences" ADD CONSTRAINT "quiz_sequences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
