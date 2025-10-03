/*
  Warnings:

  - A unique constraint covering the columns `[owner_id,name]` on the table `workspaces` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "public"."pages" ADD COLUMN     "is_pinned" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."projects" ADD COLUMN     "is_pinned" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_owner_id_name_key" ON "public"."workspaces"("owner_id", "name");
