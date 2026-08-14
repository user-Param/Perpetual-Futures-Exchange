#!/usr/bin/env bash
set -euo pipefail

EXCHANGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$EXCHANGE_DIR"

LOG_DIR="$EXCHANGE_DIR/logs"
mkdir -p "$LOG_DIR"

INFO='\033[1;34m'
OK='\033[1;32m'
WARN='\033[1;33m'
ERR='\033[1;31m'
NC='\033[0m'

info() { printf "${INFO}[+] %s${NC}\n" "$*"; }
ok()   { printf "${OK}[*] %s${NC}\n" "$*"; }
warn() { printf "${WARN}[!] %s${NC}\n" "$*"; }
err()  { printf "${ERR}[x] %s${NC}\n" "$*"; }
die()  { err "$@"; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"; }
need nc

wait_port() {
  local host="$1" port="$2" tries="${3:-30}"
  for _ in $(seq 1 "$tries"); do
    if nc -z "$host" "$port" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

running_count() {
  { pgrep -f "$1" 2>/dev/null || true; } | wc -l | tr -d ' '
}

start_postgres() {
  need pg_isready
  need psql
  if pg_isready -h 127.0.0.1 -p 5432 -q >/dev/null 2>&1; then
    ok "PostgreSQL is running"
  else
    info "Starting PostgreSQL"
    if ! brew services start postgresql@16 >/dev/null 2>&1; then
      brew services start postgresql >/dev/null 2>&1 || die "could not start postgresql via brew services"
    fi
    wait_port 127.0.0.1 5432 60 || die "PostgreSQL did not become ready on :5432"
    ok "PostgreSQL started"
  fi
  if ! psql -h 127.0.0.1 -p 5432 -lqt 2>/dev/null | cut -d'|' -f1 | grep -qw exchange; then
    warn "database 'exchange' not found - create it with: createdb -h 127.0.0.1 -p 5432 exchange"
  fi
}

start_redis() {
  need redis-server
  if redis-cli -h 127.0.0.1 ping >/dev/null 2>&1; then
    ok "Redis is running"
  else
    info "Starting Redis"
    redis-server --daemonize yes --port 6379 --logfile "$LOG_DIR/redis.log" || die "failed to start redis-server"
    wait_port 127.0.0.1 6379 15 || die "Redis did not become ready on :6379"
    ok "Redis started"
  fi
}

start_kafka() {
  if nc -z 127.0.0.1 9092 >/dev/null 2>&1; then
    ok "Kafka is running"
    return
  fi
  need kafka-server-start
  local config="${KAFKA_CONFIG:-/opt/homebrew/etc/kafka/server.properties}"
  [ -f "$config" ] || die "kafka config not found: $config (override with KAFKA_CONFIG)"
  info "Starting Kafka"
  nohup kafka-server-start "$config" >> "$LOG_DIR/kafka.log" 2>&1 &
  wait_port 127.0.0.1 9092 90 || die "Kafka did not become ready on :9092 (see $LOG_DIR/kafka.log)"
  ok "Kafka started"
}

build_engine() {
  [ -x Engine/build/engine ] && return 0
  need cmake
  info "Building engine"
  cmake -S Engine -B Engine/build >/dev/null
  cmake --build Engine/build >/dev/null
  ok "Engine built"
}

start_engine() {
  local pat='[E]ngine/build/engine|[b]uild/engine'
  local n pre cur
  n="$(running_count "$pat")"
  if [ "$n" -ge 1 ]; then
    if [ "$n" -eq 1 ]; then
      ok "Engine is running"
      return
    fi
    warn "found $n engine processes - killing stale instances"
    pkill -f "$pat" || true
    sleep 1
  fi
  pre="$(grep -c '\[engine\] started; consuming' "$LOG_DIR/engine.log" 2>/dev/null || true)"
  info "Starting engine"
  nohup ./Engine/build/engine >> "$LOG_DIR/engine.log" 2>&1 &
  for _ in $(seq 1 20); do
    cur="$(grep -c '\[engine\] started; consuming' "$LOG_DIR/engine.log" 2>/dev/null || true)"
    [ "$cur" -gt "$pre" ] && break || true
    sleep 1
  done
  cur="$(grep -c '\[engine\] started; consuming' "$LOG_DIR/engine.log" 2>/dev/null || true)"
  if [ "$cur" -le "$pre" ]; then
    die "engine failed to become ready (see $LOG_DIR/engine.log)"
  fi
  ok "Engine started"
}

start_api() {
  local pat='[S]erver/src/server[.]ts'
  local n
  n="$(running_count "$pat")"
  if [ "$n" -ge 1 ]; then
    if [ "$n" -eq 1 ]; then
      ok "API server is running"
      return
    fi
    warn "found $n API processes - killing stale instances"
    pkill -f "$pat" || true
    sleep 1
  fi
  info "Starting API server"
  nohup npx tsx Server/src/server.ts >> "$LOG_DIR/api.log" 2>&1 &
  if ! wait_port 127.0.0.1 3000 30; then
    die "API did not become ready on :3000 (see $LOG_DIR/api.log)"
  fi
  curl -sf http://localhost:3000/health >/dev/null 2>&1 || die "API health check failed (see $LOG_DIR/api.log)"
  for _ in $(seq 1 30); do
    grep -q "DB Writer subscribed to engine_events" "$LOG_DIR/api.log" 2>/dev/null && break || true
    sleep 1
  done
  if ! grep -q "DB Writer subscribed to engine_events" "$LOG_DIR/api.log" 2>/dev/null; then
    die "DB writer did not subscribe to engine_events (see $LOG_DIR/api.log)"
  fi
  ok "API server started"
}

summary() {
  printf "\n${OK}Exchange stack is up.${NC}\n"
  printf "  PostgreSQL : http://localhost:5432  (db: exchange)\n"
  printf "  Redis      : localhost:6379\n"
  printf "  Kafka      : localhost:9092\n"
  printf "  Engine     : logs/engine.log\n"
  printf "  API        : http://localhost:3000  (health: /health)\n"
  printf "  Logs       : %s\n" "$LOG_DIR"
}

cleanup() {
  info "Shutting down Exchange stack..."
  pkill -f '[E]ngine/build/engine' 2>/dev/null && ok "Engine stopped" || true
  pkill -f '[S]erver/src/server[.]ts' 2>/dev/null && ok "API stopped" || true
  redis-cli shutdown >/dev/null 2>&1 && ok "Redis stopped" || true
  ok "All services stopped."
  exit 0
}

main() {
  if [[ "${1:-}" == "stop" ]]; then
    cleanup
  fi
  info "Starting Exchange stack from $EXCHANGE_DIR"
  start_postgres
  start_redis
  start_kafka
  build_engine
  start_engine
  start_api
  summary

  trap cleanup INT TERM
  info "Press Ctrl+C to stop the exchange."
  while true; do
    sleep 60 &
    wait $!
  done
}

main "$@"
