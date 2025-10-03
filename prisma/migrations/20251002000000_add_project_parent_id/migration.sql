-- AlterTable: Add parent_id column to support nested projects
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "parent_id" UUID;

-- AddForeignKey: Link project to parent project
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'projects_parent_id_fkey'
    ) THEN
        ALTER TABLE "projects" ADD CONSTRAINT "projects_parent_id_fkey"
        FOREIGN KEY ("parent_id") REFERENCES "projects"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
