-- 🔒 SÉCURITÉ: Ajout de la colonne eventId pour idempotence des webhooks GoCardless
-- Cette colonne permet de détecter les événements dupliqués de manière efficace

-- Ajouter la colonne event_id (nullable pour les logs existants)
ALTER TABLE "payment_logs" ADD COLUMN IF NOT EXISTS "event_id" VARCHAR(255);

-- Créer un index unique sur event_id (important pour la performance et l'idempotence)
CREATE UNIQUE INDEX IF NOT EXISTS "payment_logs_event_id_key" ON "payment_logs"("event_id");

-- Créer un index standard pour les requêtes de recherche
CREATE INDEX IF NOT EXISTS "payment_logs_event_id_idx" ON "payment_logs"("event_id");

-- Commentaire explicatif
COMMENT ON COLUMN "payment_logs"."event_id" IS 'ID unique de l''événement GoCardless pour garantir l''idempotence des webhooks';
