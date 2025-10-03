/*
  Warnings:

  - You are about to drop the column `parent_id` on the `projects` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "projects" DROP CONSTRAINT "projects_parent_id_fkey";

-- AlterTable
ALTER TABLE "projects" DROP COLUMN "parent_id";
