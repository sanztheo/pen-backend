#!/usr/bin/env bash
set -euo pipefail

# Syncs Prisma schemas to dev and/or prod databases.
# Usage:
#   ./scripts/db/sync-schema.sh dev        # Dev only (via Infisical)
#   ./scripts/db/sync-schema.sh prod       # Prod only (via .env.prod)
#   ./scripts/db/sync-schema.sh all        # Both dev + prod
#   ./scripts/db/sync-schema.sh            # Interactive picker

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_PROD_FILE="$BACKEND_DIR/../.env.prod"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()   { echo -e "${BLUE}[sync]${NC} $1"; }
ok()    { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
fail()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

cd "$BACKEND_DIR"

sync_dev_main() {
  log "Pushing main schema to DEV..."
  infisical run --env=dev --path=/Backend -- npx prisma db push
  ok "Main schema → DEV done"
}

sync_dev_embeddings() {
  log "Pushing embeddings schema to DEV..."
  infisical run --env=dev --path=/Backend -- npx prisma db push --schema=prisma/schema-embeddings.prisma
  ok "Embeddings schema → DEV done"
}

sync_dev_generate() {
  log "Generating Prisma clients..."
  npx prisma generate
  npx prisma generate --schema=prisma/schema-embeddings.prisma
  ok "Prisma clients generated"
}

load_prod_env() {
  if [[ ! -f "$ENV_PROD_FILE" ]]; then
    fail ".env.prod not found at $ENV_PROD_FILE"
  fi
  PROD_DB_URL="$(grep '^DB_PROD=' "$ENV_PROD_FILE" | cut -d'=' -f2-)"
  PROD_EMBEDDING_URL="$(grep '^EMBEDDING=' "$ENV_PROD_FILE" | cut -d'=' -f2-)"
}

sync_prod_main() {
  load_prod_env
  if [[ -z "${PROD_DB_URL:-}" ]]; then
    fail "DB_PROD not set in .env.prod"
  fi

  log "Pushing main schema to PROD..."
  DATABASE_URL="$PROD_DB_URL" npx prisma db push --accept-data-loss=false --skip-generate
  ok "Main schema → PROD done"
}

sync_prod_embeddings() {
  load_prod_env
  if [[ -z "${PROD_EMBEDDING_URL:-}" ]]; then
    fail "EMBEDDING not set in .env.prod"
  fi

  log "Pushing embeddings schema to PROD..."
  EMBEDDING_DATABASE_URL="$PROD_EMBEDDING_URL" npx prisma db push --schema=prisma/schema-embeddings.prisma --accept-data-loss=false --skip-generate
  ok "Embeddings schema → PROD done"
}

run_dev() {
  echo ""
  log "━━━ DEV (Infisical) ━━━"
  sync_dev_main
  sync_dev_embeddings
  sync_dev_generate
  echo ""
  ok "DEV fully synced!"
}

run_prod() {
  echo ""
  log "━━━ PROD (.env.prod) ━━━"
  warn "About to push schema to PRODUCTION databases."
  read -r -p "$(echo -e "${YELLOW}Continue? [y/N]${NC} ")" confirm
  if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    warn "Aborted."
    return
  fi
  sync_prod_main
  sync_prod_embeddings
  echo ""
  ok "PROD fully synced!"
}

TARGET="${1:-}"

if [[ -z "$TARGET" ]]; then
  echo ""
  echo -e "${BLUE}Prisma Schema Sync${NC}"
  echo "  1) dev   — Push to dev (Infisical)"
  echo "  2) prod  — Push to prod (.env.prod)"
  echo "  3) all   — Both dev + prod"
  echo ""
  read -r -p "Choose [1/2/3]: " choice
  case "$choice" in
    1) TARGET="dev" ;;
    2) TARGET="prod" ;;
    3) TARGET="all" ;;
    *) fail "Invalid choice" ;;
  esac
fi

case "$TARGET" in
  dev)  run_dev ;;
  prod) run_prod ;;
  all)  run_dev; run_prod ;;
  *)    fail "Usage: $0 [dev|prod|all]" ;;
esac

echo ""
ok "All done."
