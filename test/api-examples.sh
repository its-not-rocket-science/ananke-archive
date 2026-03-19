#!/usr/bin/env bash
# test/api-examples.sh — curl examples for the ananke-archive REST API
#
# Start the server first:
#   npm start           (requires npm run build first)
#   npm run dev         (JavaScript source, no build step)
#
# Then run this file:
#   bash test/api-examples.sh

BASE=${ARCHIVE_URL:-http://localhost:3000}

echo "=== ananke-archive API smoke tests ==="
echo "Base URL: $BASE"
echo ""

# ── /health ───────────────────────────────────────────────────────────────────

echo "--- GET /health ---"
curl -sf "$BASE/health" | python3 -m json.tool 2>/dev/null || curl -s "$BASE/health"
echo -e "\n"

# ── /runs ─────────────────────────────────────────────────────────────────────

echo "--- POST /runs (save a minimal replay) ---"
SAVE_RESPONSE=$(curl -sf -X POST "$BASE/runs" \
  -H "Content-Type: application/json" \
  -d '{
    "version": 1,
    "worldSeed": 42,
    "frames": [
      { "tick": 0, "snapshot": { "entities": [] } }
    ]
  }')
echo "$SAVE_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$SAVE_RESPONSE"

# Extract the run id from the response for subsequent GET
RUN_ID=$(echo "$SAVE_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null)
echo ""

echo "--- GET /runs (list) ---"
curl -sf "$BASE/runs" | python3 -m json.tool 2>/dev/null || curl -s "$BASE/runs"
echo -e "\n"

if [ -n "$RUN_ID" ]; then
  echo "--- GET /runs/$RUN_ID ---"
  curl -sf "$BASE/runs/$RUN_ID" | python3 -m json.tool 2>/dev/null || curl -s "$BASE/runs/$RUN_ID"
  echo -e "\n"
else
  echo "(Skipping GET /runs/:id — could not extract run id from save response)"
fi

# ── /validation ───────────────────────────────────────────────────────────────

echo "--- POST /validation/armed-vs-unarmed ---"
curl -sf -X POST "$BASE/validation/armed-vs-unarmed" \
  -H "Content-Type: application/json" \
  -d '{
    "scenario": "armed-vs-unarmed",
    "pass": true,
    "message": "Armour delayed shock accumulation as expected",
    "anankeVersion": "0.1.1",
    "recordedAt": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"
  }' | python3 -m json.tool 2>/dev/null
echo -e "\n"

echo "--- GET /validation ---"
curl -sf "$BASE/validation" | python3 -m json.tool 2>/dev/null || curl -s "$BASE/validation"
echo -e "\n"

echo "--- GET /validation/armed-vs-unarmed ---"
curl -sf "$BASE/validation/armed-vs-unarmed" | python3 -m json.tool 2>/dev/null || curl -s "$BASE/validation/armed-vs-unarmed"
echo -e "\n"

# ── 404 ───────────────────────────────────────────────────────────────────────

echo "--- GET /runs/nonexistent (expect 404) ---"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/runs/nonexistent")
echo "HTTP status: $STATUS (expected 404)"
echo ""

echo "=== Done ==="
