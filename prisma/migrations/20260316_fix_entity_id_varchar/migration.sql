-- AlterTable: change entity_id from uuid to varchar(255) to support Clerk user IDs
ALTER TABLE "activity_logs" ALTER COLUMN "entity_id" TYPE VARCHAR(255) USING "entity_id"::text;
