-- Partial index for the trash purge cron.
-- The cron query scans `WHERE is_archived = true AND archived_at < cutoff` GLOBALLY
-- (no workspace_id filter), so the composite index (workspace_id, is_archived, archived_at)
-- declared in schema.prisma is not used by Postgres. This partial index keeps that
-- query bounded to archived rows only.
--
-- Why this lives outside schema.prisma:
--   Prisma DSL does not support partial indexes. Pennote uses `db push` (no migration files),
--   so we keep the DDL in a re-runnable script. After ANY of:
--     - prisma db push --force-reset
--     - manual DB rebuild
--     - fresh dev DB provisioning
--   re-run this script via:
--     infisical run --env=dev --path=/Backend -- npx prisma db execute \
--       --file prisma/sql/page_trash_partial_index.sql --schema prisma/schema.prisma
--
-- IDEMPOTENT: safe to re-run anytime.

CREATE INDEX IF NOT EXISTS "page_archived_at_partial_idx"
  ON "pages" ("archived_at")
  WHERE "is_archived" = true;
