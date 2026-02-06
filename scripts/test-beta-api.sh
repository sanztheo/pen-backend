#!/usr/bin/env bash
# Beta API Test Script (curl version)
#
# Usage:
#   bash scripts/test-beta-api.sh
#   BASE_URL=http://localhost:3001 TOKEN=xxx bash scripts/test-beta-api.sh

set -euo pipefail

BASE="${BASE_URL:-http://localhost:3001}"
TOKEN="${TOKEN:-}"
AUTH_HEADER=""

if [ -n "$TOKEN" ]; then
  AUTH_HEADER="-H \"Authorization: Bearer $TOKEN\""
fi

GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

section() {
  echo -e "\n${CYAN}${BOLD}── $1 ──${NC}"
}

# ─── 1. GET /api/beta/status (no auth) ───
section "GET /api/beta/status (no auth)"
echo -e "${DIM}curl ${BASE}/api/beta/status${NC}"
curl -s "${BASE}/api/beta/status" | python3 -m json.tool
echo ""

# ─── 2. GET /api/beta/status (with auth) ───
if [ -n "$TOKEN" ]; then
  section "GET /api/beta/status (with auth)"
  echo -e "${DIM}curl -H 'Authorization: Bearer ...' ${BASE}/api/beta/status${NC}"
  curl -s -H "Authorization: Bearer ${TOKEN}" "${BASE}/api/beta/status" | python3 -m json.tool
  echo ""
fi

# ─── 3. POST /api/beta/heartbeat (no auth → 401) ───
section "POST /api/beta/heartbeat (no auth → expect 401)"
echo -e "${DIM}curl -X POST ${BASE}/api/beta/heartbeat${NC}"
curl -s -X POST "${BASE}/api/beta/heartbeat" \
  -H "Content-Type: application/json" \
  -d "{\"timestamp\": $(date +%s000)}" | python3 -m json.tool
echo ""

# ─── 4. POST /api/beta/heartbeat (with auth) ───
if [ -n "$TOKEN" ]; then
  section "POST /api/beta/heartbeat (with auth)"
  echo -e "${DIM}Sending 3 heartbeats...${NC}"
  for i in 1 2 3; do
    echo -e "  Heartbeat #${i}:"
    curl -s -X POST "${BASE}/api/beta/heartbeat" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ${TOKEN}" \
      -d "{\"timestamp\": $(date +%s000)}" | python3 -m json.tool
  done
  echo ""
fi

# ─── 5. POST /api/beta/waitlist (validation errors) ───
section "POST /api/beta/waitlist (missing fields → expect 400)"
echo -e "${DIM}curl -X POST ${BASE}/api/beta/waitlist -d '{}'${NC}"
curl -s -X POST "${BASE}/api/beta/waitlist" \
  -H "Content-Type: application/json" \
  -d '{}' | python3 -m json.tool
echo ""

section "POST /api/beta/waitlist (invalid email → expect 400)"
curl -s -X POST "${BASE}/api/beta/waitlist" \
  -H "Content-Type: application/json" \
  -d '{"email": "bad-email", "name": "Test"}' | python3 -m json.tool
echo ""

# ─── 6. POST /api/beta/waitlist (signup) ───
TEST_EMAIL="test-beta-$(date +%s)@example.com"
section "POST /api/beta/waitlist (signup → expect 201)"
echo -e "${DIM}Email: ${TEST_EMAIL}${NC}"
curl -s -X POST "${BASE}/api/beta/waitlist" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"${TEST_EMAIL}\", \"name\": \"Beta Tester\"}" | python3 -m json.tool
echo ""

# ─── 7. POST /api/beta/waitlist (duplicate → expect 409) ───
section "POST /api/beta/waitlist (duplicate → expect 409)"
curl -s -X POST "${BASE}/api/beta/waitlist" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"${TEST_EMAIL}\", \"name\": \"Beta Tester\"}" | python3 -m json.tool
echo ""

# ─── 8. POST /api/beta/reactivate (no auth → 401) ───
section "POST /api/beta/reactivate (no auth → expect 401)"
curl -s -X POST "${BASE}/api/beta/reactivate" \
  -H "Content-Type: application/json" | python3 -m json.tool
echo ""

# ─── 9. POST /api/beta/reactivate (with auth) ───
if [ -n "$TOKEN" ]; then
  section "POST /api/beta/reactivate (with auth)"
  curl -s -X POST "${BASE}/api/beta/reactivate" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${TOKEN}" | python3 -m json.tool
  echo ""
fi

echo -e "\n${GREEN}${BOLD}Done!${NC} All requests completed.\n"
