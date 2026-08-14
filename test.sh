#!/usr/bin/env bash
#
# End-to-end test for the Perpetual Futures Exchange v1.
# Validates the full order lifecycle: register -> login -> deposit ->
# place orders -> engine match -> Kafka/Redis events -> DB writer updates ->
# balances/fills/positions -> cancel -> rejection -> idempotency -> snapshot recovery.
#
# Prerequisites (running locally):
#   - PostgreSQL  (psql)
#   - Redis       (redis-cli ping == PONG)
#   - Kafka       (port 9092)
#
# The script will start the API and the C++ engine automatically if they are
# not already running, and stop them when finished (unless --keep is passed).
#
# Usage: ./test.sh [--keep] [--api-url http://localhost:3000]

set -uo pipefail

API_URL="${API_URL:-http://localhost:3000}"
KEEP=0
if [[ "${1:-}" == "--keep" ]]; then KEEP=1; fi
if [[ "${1:-}" == "--api-url" ]]; then API_URL="$2"; shift 2; fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_PID=""
PSQL="psql postgres://param@localhost:5432/exchange"
SUFFIX="$(date +%s)"
USER1_EMAIL="test1-${SUFFIX}@example.com"
USER2_EMAIL="test2-${SUFFIX}@example.com"
PASSWORD="password123"
MARKET="BTC-USDT-PERP"

PASS=0
FAIL=0
declare -a FAILURES

log()  { printf '\n\033[1;34m== %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32mPASS\033[0m %s\n' "$*"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$*"; FAIL=$((FAIL+1)); FAILURES+=("$*"); }
check() { # check <description> <command...>
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then ok "$desc"; else bad "$desc"; fi
}

# --- HTTP + JSON helpers (exported so subshells can use them) --------------
http() {
  local method="$1" path="$2" token="${3:-}" data="${4:-}"
  local args=(-s -o /tmp/exchange_http_body.$$ -w '%{http_code}' -X "$method" "${API_URL}${path}")
  [[ -n "$token" ]] && args+=(-H "Authorization: Bearer $token")
  [[ -n "$data" ]]  && args+=(-H "Content-Type: application/json" -d "$data")
  HTTP_CODE="$(curl "${args[@]}")"
  HTTP_BODY="$(cat /tmp/exchange_http_body.$$ 2>/dev/null)"
  rm -f /tmp/exchange_http_body.$$
}
jget()       { jq -r "$1" <<<"$2"; }
jq_matches() { [[ "$(jq -r "$2" <<<"$1" 2>/dev/null)" == "$3" ]]; }
export -f http jget jq_matches
export API_URL

wait_until() { # <description> <max_seconds> <command...>
  local desc="$1" max="$2"; shift 2
  local waited=0
  while (( waited < max )); do
    if bash -c "$*" >/dev/null 2>&1; then ok "$desc"; return 0; fi
    sleep 1; waited=$((waited+1))
  done
  bad "$desc (timed out after ${max}s)"
  return 1
}

# ---------------------------------------------------------------------------
log "0. Infrastructure connectivity"
check "PostgreSQL reachable" bash -c 'psql postgres://param@localhost:5432/exchange -tAc "SELECT 1" >/dev/null 2>&1'
check "Redis reachable (PONG)" bash -c '[[ "$(redis-cli ping 2>/dev/null)" == "PONG" ]]'
check "Kafka reachable (port 9092)" bash -c 'nc -z localhost 9092 >/dev/null 2>&1'

# --- Start API if needed ----------------------------------------------------
if ! curl -sf "${API_URL}/health" >/dev/null 2>&1; then
  log "Starting REST API on ${API_URL}"
  ( cd "$ROOT/Server" && exec npx tsx src/server.ts ) > /tmp/exchange-api.log 2>&1 &
  API_PID=$!
  for i in $(seq 1 30); do curl -sf "${API_URL}/health" >/dev/null 2>&1 && break; sleep 1; done
fi
check "API /health responds" curl -sf "${API_URL}/health"

# --- Start Engine if needed --------------------------------------------------
if ! pgrep -f "build/engine" >/dev/null 2>&1; then
  log "Starting C++ matching engine"
  ( cd "$ROOT/Engine" && exec ./build/engine ) > /tmp/exchange-engine.log 2>&1 &
  ENGINE_PID=$!
  sleep 1
fi
check "Engine process is running" bash -c 'pgrep -f "build/engine" >/dev/null 2>&1'

# ---------------------------------------------------------------------------
log "1. Kafka produce/consume round-trip"
K_TOPIC="exchange_test_${SUFFIX}"
echo "kafka-hello-${SUFFIX}" | kafka-console-producer --bootstrap-server localhost:9092 --topic "$K_TOPIC" >/dev/null 2>&1
K_OUT="$(kafka-console-consumer --bootstrap-server localhost:9092 --topic "$K_TOPIC" --from-beginning --max-messages 1 --timeout-ms 15000 2>/dev/null)"
check "Kafka message round-trip" bash -c "[[ '$K_OUT' == 'kafka-hello-${SUFFIX}' ]]"

# ---------------------------------------------------------------------------
log "2. Auth: register + login"
http POST /api/v1/auth/register "" "{\"email\":\"${USER1_EMAIL}\",\"password\":\"${PASSWORD}\",\"name\":\"Test User 1\"}"
[[ "$HTTP_CODE" == "201" ]] && ok "Register user1 -> 201" || bad "Register user1 -> ${HTTP_CODE} (${HTTP_BODY})"
TOKEN1="$(jget .token "$HTTP_BODY")"
[[ -n "$TOKEN1" && "$TOKEN1" != "null" ]] && ok "Register returns JWT" || bad "Register missing token"

http POST /api/v1/auth/login "" "{\"email\":\"${USER1_EMAIL}\",\"password\":\"${PASSWORD}\"}"
[[ "$HTTP_CODE" == "200" ]] && ok "Login user1 -> 200" || bad "Login user1 -> ${HTTP_CODE} (${HTTP_BODY})"
TOKEN1="$(jget .token "$HTTP_BODY")"

http POST /api/v1/auth/register "" "{\"email\":\"${USER2_EMAIL}\",\"password\":\"${PASSWORD}\",\"name\":\"Test User 2\"}"
TOKEN2="$(jget .token "$HTTP_BODY")"
[[ -n "$TOKEN2" && "$TOKEN2" != "null" ]] && ok "Register user2 returns JWT" || bad "Register user2 failed (${HTTP_BODY})"

http GET /api/v1/auth/me "$TOKEN1"
jq_matches "$HTTP_BODY" .email "$USER1_EMAIL" && ok "GET /auth/me returns profile" || bad "GET /auth/me (${HTTP_BODY})"

# ---------------------------------------------------------------------------
log "3. Balances: deposits"
http POST /api/v1/balances/deposit "$TOKEN1" '{"asset":"USDT","amount":"10000"}'
[[ "$HTTP_CODE" == "200" ]] && ok "Deposit USDT 10000 (user1) -> 200" || bad "Deposit user1 (${HTTP_CODE}: ${HTTP_BODY})"

http POST /api/v1/balances/deposit "$TOKEN2" '{"asset":"USDT","amount":"10000"}'
http POST /api/v1/balances/deposit "$TOKEN2" '{"asset":"BTC","amount":"1"}'
[[ "$HTTP_CODE" == "200" ]] && ok "Deposit USDT+BTC (user2) -> 200" || bad "Deposit user2 (${HTTP_CODE}: ${HTTP_BODY})"

# ---------------------------------------------------------------------------
log "4. Orders: place buy (resting) then matching sell"
http POST /api/v1/orders "$TOKEN1" "{\"market\":\"${MARKET}\",\"side\":\"buy\",\"orderType\":\"limit\",\"price\":\"50000\",\"quantity\":\"0.01\",\"timeInForce\":\"GTC\",\"leverage\":\"10\"}"
[[ "$HTTP_CODE" == "201" || "$HTTP_CODE" == "200" ]] && ok "Place buy 0.01 BTC @ 50000 (user1) -> accepted" || bad "Place buy user1 (${HTTP_CODE}: ${HTTP_BODY})"
BUY_ID="$(jget .order.id "$HTTP_BODY")"
[[ -n "$BUY_ID" && "$BUY_ID" != "null" ]] && ok "Buy order has id" || bad "Buy order missing id (${HTTP_BODY})"

wait_until "Buy order resting on book before sell arrives" 20 \
  "http GET /api/v1/markets/${MARKET}/orderbook '' && jq -e '.bids | any(.[0] == \"50000\")' <<<\"\$HTTP_BODY\""

http POST /api/v1/orders "$TOKEN2" "{\"market\":\"${MARKET}\",\"side\":\"sell\",\"orderType\":\"limit\",\"price\":\"50000\",\"quantity\":\"0.01\",\"timeInForce\":\"GTC\",\"leverage\":\"10\"}"
[[ "$HTTP_CODE" == "201" || "$HTTP_CODE" == "200" ]] && ok "Place sell 0.01 BTC @ 50000 (user2) -> accepted" || bad "Place sell user2 (${HTTP_CODE}: ${HTTP_BODY})"
SELL_ID="$(jget .order.id "$HTTP_BODY")"

log "Waiting for engine to match (polling)..."
wait_until "Buy order becomes filled" 25 "http GET /api/v1/orders/${BUY_ID} '${TOKEN1}' && jq_matches \"\$HTTP_BODY\" .status filled"
wait_until "Sell order becomes filled" 25 "http GET /api/v1/orders/${SELL_ID} '${TOKEN2}' && jq_matches \"\$HTTP_BODY\" .status filled"

# ---------------------------------------------------------------------------
log "5. Fills"
http GET /api/v1/fills "$TOKEN1"
N_FILLS_USER1="$(jget '.fills | length' "$HTTP_BODY")"
[[ "$N_FILLS_USER1" -ge 1 ]] && ok "User1 sees a fill (${N_FILLS_USER1})" || bad "User1 has no fills (${HTTP_BODY})"

# ---------------------------------------------------------------------------
log "6. Balances after fill (fees applied)"
# user1 (maker/buyer): 10000 - 50 margin - 0.5 maker fee = 9949.5 USDT, +0.01 BTC
# user2 (taker/seller): 10000 + (500 - 1 taker fee) = 10499 USDT, BTC 0.99
http GET /api/v1/balances "$TOKEN1"
USDT1_AVAIL="$(jget '.balances[] | select(.symbol=="USDT") | .available' "$HTTP_BODY")"
BTC1_AVAIL="$(jget '.balances[] | select(.symbol=="BTC") | .available' "$HTTP_BODY")"
jq -ne "((${USDT1_AVAIL:-0} | tonumber) >= 9949.4) and ((${USDT1_AVAIL:-0} | tonumber) <= 9949.6)" >/dev/null 2>&1 \
  && ok "User1 USDT available ~9949.5 (${USDT1_AVAIL})" || bad "User1 USDT available = ${USDT1_AVAIL}"
jq -ne "((${BTC1_AVAIL:-0} | tonumber) >= 0.0099) and ((${BTC1_AVAIL:-0} | tonumber) <= 0.0101)" >/dev/null 2>&1 \
  && ok "User1 BTC available ~0.01 (${BTC1_AVAIL})" || bad "User1 BTC available = ${BTC1_AVAIL}"

http GET /api/v1/balances "$TOKEN2"
USDT2_AVAIL="$(jget '.balances[] | select(.symbol=="USDT") | .available' "$HTTP_BODY")"
BTC2_AVAIL="$(jget '.balances[] | select(.symbol=="BTC") | .available' "$HTTP_BODY")"
jq -ne "((${USDT2_AVAIL:-0} | tonumber) >= 10498.9) and ((${USDT2_AVAIL:-0} | tonumber) <= 10499.1)" >/dev/null 2>&1 \
  && ok "User2 USDT available ~10499 (${USDT2_AVAIL})" || bad "User2 USDT available = ${USDT2_AVAIL}"
jq -ne "((${BTC2_AVAIL:-0} | tonumber) >= 0.9899) and ((${BTC2_AVAIL:-0} | tonumber) <= 0.9901)" >/dev/null 2>&1 \
  && ok "User2 BTC available ~0.99 (${BTC2_AVAIL})" || bad "User2 BTC available = ${BTC2_AVAIL}"

# ---------------------------------------------------------------------------
log "7. Positions"
http GET /api/v1/positions "$TOKEN1"
jq -e '(.positions | length) >= 1' <<<"$HTTP_BODY" >/dev/null 2>&1 \
  && ok "User1 has an open position" || bad "User1 positions (${HTTP_BODY})"

# ---------------------------------------------------------------------------
log "8. Order book depth (empty after the match)"
http GET "/api/v1/markets/${MARKET}/orderbook"
NB="$(jget '.bids|length' "$HTTP_BODY")"
NA="$(jget '.asks|length' "$HTTP_BODY")"
[[ "$NB" == "0" && "$NA" == "0" ]] && ok "Order book empty after match (bids=${NB} asks=${NA})" \
  || bad "Order book not empty after match (${HTTP_BODY})"

# ---------------------------------------------------------------------------
log "9. Market data endpoints"
http GET "/api/v1/markets/${MARKET}/trades"
if jq -e '.trades | length >= 1' <<<"$HTTP_BODY" >/dev/null 2>&1; then
  ok "GET /trades returns recent trades"
else
  bad "GET /trades (${HTTP_BODY})"
fi
http GET "/api/v1/markets/${MARKET}/ticker"
jq_matches "$HTTP_BODY" .symbol "$MARKET" && ok "GET /ticker returns ticker" || bad "GET /ticker (${HTTP_BODY})"

# ---------------------------------------------------------------------------
log "10. Cancel order (non-matching) + margin unlock"
http POST /api/v1/orders "$TOKEN1" "{\"market\":\"${MARKET}\",\"side\":\"buy\",\"orderType\":\"limit\",\"price\":\"40000\",\"quantity\":\"0.01\",\"timeInForce\":\"GTC\",\"leverage\":\"10\"}"
CANCEL_ID="$(jget .order.id "$HTTP_BODY")"
[[ -n "$CANCEL_ID" && "$CANCEL_ID" != "null" ]] && ok "Placed non-matching buy @40000" || bad "Place cancel-order (${HTTP_BODY})"

http GET /api/v1/balances "$TOKEN1"
LOCKED1="$(jget '.balances[] | select(.symbol=="USDT") | .locked' "$HTTP_BODY")"
jq -ne "((${LOCKED1:-0} | tonumber) >= 39.9) and ((${LOCKED1:-0} | tonumber) <= 40.1)" >/dev/null 2>&1 \
  && ok "40 USDT locked by resting order (${LOCKED1})" || bad "Locked USDT = ${LOCKED1}"

http DELETE "/api/v1/orders/${CANCEL_ID}" "$TOKEN1"
[[ "$HTTP_CODE" == "200" ]] && ok "DELETE /orders/:id -> 200" || bad "Cancel order (${HTTP_CODE}: ${HTTP_BODY})"
wait_until "Canceled order status is canceled" 15 \
  "http GET /api/v1/orders/${CANCEL_ID} '${TOKEN1}' && jq_matches \"\$HTTP_BODY\" .status canceled"
wait_until "Locked USDT released after cancel" 15 \
  "http GET /api/v1/balances '${TOKEN1}' && jq -e '(.balances[] | select(.symbol==\"USDT\") | .locked | tonumber) <= 0.0001' <<<\"\$HTTP_BODY\""

# ---------------------------------------------------------------------------
log "11. Order rejection on insufficient balance"
http POST /api/v1/orders "$TOKEN1" "{\"market\":\"${MARKET}\",\"side\":\"buy\",\"orderType\":\"limit\",\"price\":\"50000\",\"quantity\":\"100\",\"timeInForce\":\"GTC\",\"leverage\":\"1\"}"
[[ "$HTTP_CODE" == "400" ]] && ok "Oversized buy rejected (400)" || bad "Oversized buy returned ${HTTP_CODE}: ${HTTP_BODY}"
jq_matches "$HTTP_BODY" .error "insufficient_balance" && ok "Rejection reason = insufficient_balance" || bad "Rejection reason (${HTTP_BODY})"

# ---------------------------------------------------------------------------
log "12. Idempotency with client_order_id"
COID="co-${SUFFIX}"
http POST /api/v1/orders "$TOKEN1" "{\"market\":\"${MARKET}\",\"side\":\"buy\",\"orderType\":\"limit\",\"price\":\"45000\",\"quantity\":\"0.01\",\"timeInForce\":\"GTC\",\"leverage\":\"10\",\"clientOrderId\":\"${COID}\"}"
[[ "$HTTP_CODE" == "201" ]] && ok "First order with client_order_id -> 201" || bad "First idempotent order (${HTTP_CODE}: ${HTTP_BODY})"
FIRST_ID="$(jget .order.id "$HTTP_BODY")"
jq_matches "$HTTP_BODY" .idempotent "false" && ok "First order idempotent=false" || bad "First order idempotent flag (${HTTP_BODY})"

http POST /api/v1/orders "$TOKEN1" "{\"market\":\"${MARKET}\",\"side\":\"buy\",\"orderType\":\"limit\",\"price\":\"45000\",\"quantity\":\"0.01\",\"timeInForce\":\"GTC\",\"leverage\":\"10\",\"clientOrderId\":\"${COID}\"}"
[[ "$HTTP_CODE" == "200" ]] && ok "Resend same client_order_id -> 200" || bad "Resend idempotent (${HTTP_CODE}: ${HTTP_BODY})"
jq_matches "$HTTP_BODY" .idempotent "true" && ok "Resend idempotent=true" || bad "Resend idempotent flag (${HTTP_BODY})"
SECOND_ID="$(jget .order.id "$HTTP_BODY")"
[[ "$FIRST_ID" == "$SECOND_ID" ]] && ok "Same order id returned (no duplicate)" || bad "Different order ids: ${FIRST_ID} vs ${SECOND_ID}"

USER1_ID="$($PSQL -tAc "SELECT id FROM users WHERE email = '${USER1_EMAIL}'" 2>/dev/null | tr -d ' ')"
N_DUP="$($PSQL -tAc "SELECT count(*) FROM orders WHERE client_order_id = '${COID}' AND user_id = '${USER1_ID}'" 2>/dev/null | tr -d ' ')"
[[ "$N_DUP" == "1" ]] && ok "Exactly one row in DB for client_order_id (${N_DUP})" || bad "DB rows for client_order_id = ${N_DUP}"

# ---------------------------------------------------------------------------
log "13. Kafka durable event log"
ENG_EVENTS="$(kafka-console-consumer --bootstrap-server localhost:9092 --topic engine_events --from-beginning --max-messages 300 --timeout-ms 15000 2>/dev/null)"
grep -q "TRADE_EXECUTED" <<<"$ENG_EVENTS" && ok "Kafka topic engine_events contains TRADE_EXECUTED" \
  || bad "No TRADE_EXECUTED found in engine_events"

# ---------------------------------------------------------------------------
log "14. Engine snapshot & recovery"
SNAPSHOT_FILE="$ROOT/Engine/engine_state.json"
# The idempotency order (buy 0.01 @ 45000) is resting in the engine.
if [[ -n "$ENGINE_PID" ]]; then
  kill -INT "$ENGINE_PID" 2>/dev/null || true
  for i in $(seq 1 10); do kill -0 "$ENGINE_PID" 2>/dev/null || break; sleep 1; done
  ENGINE_PID=""
fi
[[ -f "$SNAPSHOT_FILE" ]] && ok "Engine wrote snapshot on shutdown" || bad "engine_state.json missing (${SNAPSHOT_FILE})"
jq -e 'has("books")' "$SNAPSHOT_FILE" >/dev/null 2>&1 && ok "Snapshot JSON valid (books present)" || bad "Snapshot invalid"

# Restart the engine from the snapshot and verify the resting order is restored.
log "Restarting engine from snapshot..."
( cd "$ROOT/Engine" && exec ./build/engine ) > /tmp/exchange-engine2.log 2>&1 &
ENGINE_PID=$!
wait_until "Restored orderbook shows buy @45000 after restart" 20 \
  "http GET /api/v1/markets/${MARKET}/orderbook '' && jq -e '.bids | any(.[0] == \"45000\")' <<<\"\$HTTP_BODY\""

# ---------------------------------------------------------------------------
log "SUMMARY"
echo "  Passed: ${PASS}"
echo "  Failed: ${FAIL}"
if (( FAIL > 0 )); then
  printf '  Failures:\n'
  for f in "${FAILURES[@]}"; do printf '    - %s\n' "$f"; done
fi

if [[ -n "$ENGINE_PID" && "$KEEP" == "0" ]]; then kill "$ENGINE_PID" 2>/dev/null || true; fi
if [[ -n "${API_PID:-}" && "$KEEP" == "0" ]]; then kill "$API_PID" 2>/dev/null || true; fi

[[ "$FAIL" == "0" ]]
