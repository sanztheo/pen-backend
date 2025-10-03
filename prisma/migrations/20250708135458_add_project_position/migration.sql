/*
  Warnings:

  - Added the required column `workspace_id` to the `pages` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "pages" ADD COLUMN     "workspace_id" UUID NOT NULL,
ALTER COLUMN "project_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
