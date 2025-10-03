-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "parent_id" UUID;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
