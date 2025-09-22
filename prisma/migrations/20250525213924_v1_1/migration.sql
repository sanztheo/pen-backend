/*
  Warnings:

  - The primary key for the `blocks` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `authorId` on the `blocks` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `blocks` table. All the data in the column will be lost.
  - You are about to drop the column `order` on the `blocks` table. All the data in the column will be lost.
  - You are about to drop the column `pageId` on the `blocks` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `blocks` table. All the data in the column will be lost.
  - The `id` column on the `blocks` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to alter the column `type` on the `blocks` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(50)`.
  - The primary key for the `pages` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `authorId` on the `pages` table. All the data in the column will be lost.
  - You are about to drop the column `cover` on the `pages` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `pages` table. All the data in the column will be lost.
  - You are about to drop the column `emoji` on the `pages` table. All the data in the column will be lost.
  - You are about to drop the column `order` on the `pages` table. All the data in the column will be lost.
  - You are about to drop the column `parentId` on the `pages` table. All the data in the column will be lost.
  - You are about to drop the column `projectId` on the `pages` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `pages` table. All the data in the column will be lost.
  - You are about to drop the column `wordCount` on the `pages` table. All the data in the column will be lost.
  - The `id` column on the `pages` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to alter the column `title` on the `pages` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(255)`.
  - The primary key for the `projects` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `color` on the `projects` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `projects` table. All the data in the column will be lost.
  - You are about to drop the column `icon` on the `projects` table. All the data in the column will be lost.
  - You are about to drop the column `ownerId` on the `projects` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `projects` table. All the data in the column will be lost.
  - You are about to drop the column `workspaceId` on the `projects` table. All the data in the column will be lost.
  - The `id` column on the `projects` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to alter the column `name` on the `projects` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(255)`.
  - The primary key for the `users` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `avatar` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `firstName` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `lastName` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `preferences` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `users` table. All the data in the column will be lost.
  - The `id` column on the `users` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to alter the column `email` on the `users` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(255)`.
  - The primary key for the `workspaces` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `createdAt` on the `workspaces` table. All the data in the column will be lost.
  - You are about to drop the column `icon` on the `workspaces` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `workspaces` table. All the data in the column will be lost.
  - The `id` column on the `workspaces` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to alter the column `name` on the `workspaces` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(255)`.
  - You are about to alter the column `color` on the `workspaces` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(7)`.
  - You are about to drop the `questions` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `quiz_attempts` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `quizzes` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `workspace_users` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `created_by` to the `blocks` table without a default value. This is not possible if the table is not empty.
  - Added the required column `page_id` to the `blocks` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `blocks` table without a default value. This is not possible if the table is not empty.
  - Added the required column `created_by` to the `pages` table without a default value. This is not possible if the table is not empty.
  - Added the required column `project_id` to the `pages` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `pages` table without a default value. This is not possible if the table is not empty.
  - Added the required column `created_by` to the `projects` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `projects` table without a default value. This is not possible if the table is not empty.
  - Added the required column `workspace_id` to the `projects` table without a default value. This is not possible if the table is not empty.
  - Added the required column `first_name` to the `users` table without a default value. This is not possible if the table is not empty.
  - Added the required column `last_name` to the `users` table without a default value. This is not possible if the table is not empty.
  - Added the required column `password_hash` to the `users` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `users` table without a default value. This is not possible if the table is not empty.
  - Added the required column `owner_id` to the `workspaces` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `workspaces` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "blocks" DROP CONSTRAINT "blocks_authorId_fkey";

-- DropForeignKey
ALTER TABLE "blocks" DROP CONSTRAINT "blocks_pageId_fkey";

-- DropForeignKey
ALTER TABLE "pages" DROP CONSTRAINT "pages_authorId_fkey";

-- DropForeignKey
ALTER TABLE "pages" DROP CONSTRAINT "pages_parentId_fkey";

-- DropForeignKey
ALTER TABLE "pages" DROP CONSTRAINT "pages_projectId_fkey";

-- DropForeignKey
ALTER TABLE "projects" DROP CONSTRAINT "projects_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "projects" DROP CONSTRAINT "projects_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "questions" DROP CONSTRAINT "questions_quizId_fkey";

-- DropForeignKey
ALTER TABLE "quiz_attempts" DROP CONSTRAINT "quiz_attempts_quizId_fkey";

-- DropForeignKey
ALTER TABLE "quiz_attempts" DROP CONSTRAINT "quiz_attempts_userId_fkey";

-- DropForeignKey
ALTER TABLE "quizzes" DROP CONSTRAINT "quizzes_projectId_fkey";

-- DropForeignKey
ALTER TABLE "workspace_users" DROP CONSTRAINT "workspace_users_userId_fkey";

-- DropForeignKey
ALTER TABLE "workspace_users" DROP CONSTRAINT "workspace_users_workspaceId_fkey";

-- AlterTable
ALTER TABLE "blocks" DROP CONSTRAINT "blocks_pkey",
DROP COLUMN "authorId",
DROP COLUMN "createdAt",
DROP COLUMN "order",
DROP COLUMN "pageId",
DROP COLUMN "updatedAt",
ADD COLUMN     "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "created_by" UUID NOT NULL,
ADD COLUMN     "is_deleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "page_id" UUID NOT NULL,
ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "properties" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "updated_at" TIMESTAMPTZ(6) NOT NULL,
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
ALTER COLUMN "type" SET DATA TYPE VARCHAR(50),
ALTER COLUMN "content" SET DATA TYPE TEXT,
ADD CONSTRAINT "blocks_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "pages" DROP CONSTRAINT "pages_pkey",
DROP COLUMN "authorId",
DROP COLUMN "cover",
DROP COLUMN "createdAt",
DROP COLUMN "emoji",
DROP COLUMN "order",
DROP COLUMN "parentId",
DROP COLUMN "projectId",
DROP COLUMN "updatedAt",
DROP COLUMN "wordCount",
ADD COLUMN     "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "created_by" UUID NOT NULL,
ADD COLUMN     "is_archived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "parent_id" UUID,
ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "project_id" UUID NOT NULL,
ADD COLUMN     "slug" VARCHAR(255),
ADD COLUMN     "updated_at" TIMESTAMPTZ(6) NOT NULL,
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
ALTER COLUMN "title" SET DATA TYPE VARCHAR(255),
ADD CONSTRAINT "pages_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "projects" DROP CONSTRAINT "projects_pkey",
DROP COLUMN "color",
DROP COLUMN "createdAt",
DROP COLUMN "icon",
DROP COLUMN "ownerId",
DROP COLUMN "updatedAt",
DROP COLUMN "workspaceId",
ADD COLUMN     "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "created_by" UUID NOT NULL,
ADD COLUMN     "is_archived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "last_activity_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "settings" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "updated_at" TIMESTAMPTZ(6) NOT NULL,
ADD COLUMN     "workspace_id" UUID NOT NULL,
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
ALTER COLUMN "name" SET DATA TYPE VARCHAR(255),
ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "users" DROP CONSTRAINT "users_pkey",
DROP COLUMN "avatar",
DROP COLUMN "createdAt",
DROP COLUMN "firstName",
DROP COLUMN "lastName",
DROP COLUMN "preferences",
DROP COLUMN "updatedAt",
ADD COLUMN     "avatar_url" TEXT,
ADD COLUMN     "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "email_verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "first_name" VARCHAR(100) NOT NULL,
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "last_login_at" TIMESTAMPTZ(6),
ADD COLUMN     "last_name" VARCHAR(100) NOT NULL,
ADD COLUMN     "password_hash" VARCHAR(255) NOT NULL,
ADD COLUMN     "updated_at" TIMESTAMPTZ(6) NOT NULL,
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
ALTER COLUMN "email" SET DATA TYPE VARCHAR(255),
ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "workspaces" DROP CONSTRAINT "workspaces_pkey",
DROP COLUMN "createdAt",
DROP COLUMN "icon",
DROP COLUMN "updatedAt",
ADD COLUMN     "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "is_archived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "last_activity_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "owner_id" UUID NOT NULL,
ADD COLUMN     "updated_at" TIMESTAMPTZ(6) NOT NULL,
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
ALTER COLUMN "name" SET DATA TYPE VARCHAR(255),
ALTER COLUMN "color" SET DEFAULT '#3B82F6',
ALTER COLUMN "color" SET DATA TYPE VARCHAR(7),
ADD CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id");

-- DropTable
DROP TABLE "questions";

-- DropTable
DROP TABLE "quiz_attempts";

-- DropTable
DROP TABLE "quizzes";

-- DropTable
DROP TABLE "workspace_users";

-- CreateTable
CREATE TABLE "workspace_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" VARCHAR(20) NOT NULL DEFAULT 'member',
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "invited_by" UUID,
    "invited_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joined_at" TIMESTAMPTZ(6),
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "workspace_id" UUID,
    "project_id" UUID,
    "page_id" UUID,
    "block_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_members_workspace_id_user_id_key" ON "workspace_members"("workspace_id", "user_id");

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_block_id_fkey" FOREIGN KEY ("block_id") REFERENCES "blocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
