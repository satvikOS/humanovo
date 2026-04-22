#!/usr/bin/env bash
# backend/scripts/supervise.sh — auto-restart the dev backend on crash.
#
# The dev sandbox loses processes on every session boundary. This
# supervisor brings pg/redis back up, runs alembic, and loops the
# uvicorn server — restarting it after ≤5 s if it exits for any reason.
#
# Usage:
#   bash backend/scripts/supervise.sh
#
# Intended for local dev only. Production uses systemd / ECS.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$HERE/.." && pwd)"
DATABASE_URL="${DATABASE_URL:-postgresql+asyncpg://humanovo:humanovo@localhost:5432/humanovo}"
REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
SECRET_KEY="${SECRET_KEY:-dev-secret}"
PORT="${PORT:-8000}"
LOG_FILE="${LOG_FILE:-/tmp/backend.log}"

ensure_postgres() {
  if ! pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
    echo "[supervise] postgres down — starting..." >&2
    service postgresql start >/dev/null 2>&1 || true
    for _ in $(seq 1 20); do
      pg_isready -h localhost -p 5432 >/dev/null 2>&1 && break
      sleep 1
    done
  fi
}

ensure_redis() {
  if ! redis-cli ping >/dev/null 2>&1; then
    echo "[supervise] redis down — starting..." >&2
    redis-server --daemonize yes >/dev/null 2>&1 || true
  fi
}

run_migrations() {
  ( cd "$BACKEND_DIR" \
    && DATABASE_URL="$DATABASE_URL" alembic upgrade head >/dev/null 2>&1 \
    || echo "[supervise] alembic failed — continuing with current schema" >&2 )
}

start_uvicorn() {
  ( cd "$BACKEND_DIR" \
    && DATABASE_URL="$DATABASE_URL" REDIS_URL="$REDIS_URL" SECRET_KEY="$SECRET_KEY" \
       PYTHONPATH="$BACKEND_DIR" \
       exec python3 -m uvicorn app.main:app --host 127.0.0.1 --port "$PORT" --log-level warning )
}

trap 'echo "[supervise] shutting down"; exit 0' INT TERM

while true; do
  ensure_postgres
  ensure_redis
  run_migrations
  echo "[supervise] starting uvicorn on :$PORT" >&2
  start_uvicorn 2>&1 | tee -a "$LOG_FILE" || true
  echo "[supervise] uvicorn exited; restarting in 5 s" >&2
  sleep 5
done
