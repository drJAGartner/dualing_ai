#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BACKEND_PORT="${PORT:-3000}"
WEB_PORT="${WEB_PORT:-5173}"
PROMPT_TIMEOUT_MS="${PROMPT_TIMEOUT_MS:-180000}"
LOG_DIR="${LOG_DIR:-$ROOT_DIR/.logs}"
BACKEND_LOG="$LOG_DIR/backend.log"
WEB_LOG="$LOG_DIR/web.log"

STARTED_BACKEND_PID=""
STARTED_WEB_PID=""

info() { printf '\033[1;36m%s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m%s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m%s\033[0m\n' "$*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

url_ok() {
  local url="$1"
  curl -fsS --max-time 2 "$url" >/dev/null 2>&1
}

cleanup() {
  local exit_code=$?

  if [[ -n "$STARTED_WEB_PID" ]] && kill -0 "$STARTED_WEB_PID" >/dev/null 2>&1; then
    info "Stopping frontend..."
    kill "$STARTED_WEB_PID" >/dev/null 2>&1 || true
  fi

  if [[ -n "$STARTED_BACKEND_PID" ]] && kill -0 "$STARTED_BACKEND_PID" >/dev/null 2>&1; then
    info "Stopping backend and Docker-managed agents..."
    kill "$STARTED_BACKEND_PID" >/dev/null 2>&1 || true
  fi

  exit "$exit_code"
}
trap cleanup EXIT INT TERM

wait_for_url() {
  local name="$1"
  local url="$2"
  local timeout_seconds="$3"
  local started_at
  started_at="$(date +%s)"

  while true; do
    if url_ok "$url"; then
      return 0
    fi

    if [[ -n "$STARTED_BACKEND_PID" ]] && ! kill -0 "$STARTED_BACKEND_PID" >/dev/null 2>&1; then
      warn "$name failed while starting. Recent backend log:"
      tail -80 "$BACKEND_LOG" >&2 || true
      return 1
    fi

    if (( $(date +%s) - started_at >= timeout_seconds )); then
      warn "Timed out waiting for $name at $url."
      return 1
    fi

    sleep 1
  done
}

have npm || fail "npm is required."
have docker || fail "Docker is required."
have curl || fail "curl is required."

mkdir -p "$LOG_DIR"

if ! docker version --format '{{.Server.Version}}' >/dev/null 2>&1; then
  fail "Docker is not available or not running."
fi

if [[ -z "${AGENT_ENV_FILE:-}" && -f "$ROOT_DIR/lucy.env" ]]; then
  export AGENT_ENV_FILE="./lucy.env"
fi

export PORT="$BACKEND_PORT"
export PROMPT_TIMEOUT_MS

if [[ -n "${AGENT_ENV_FILE:-}" ]]; then
  info "Using AGENT_ENV_FILE=$AGENT_ENV_FILE"
else
  warn "AGENT_ENV_FILE is not set and ./lucy.env was not found. Lucy may fail to boot without credentials."
fi

if [[ "${LAUNCH_SKIP_BUILD:-false}" != "true" ]]; then
  info "Building server and web bundles..."
  npm run build
else
  warn "Skipping build because LAUNCH_SKIP_BUILD=true"
fi

if url_ok "http://127.0.0.1:$BACKEND_PORT/api/status"; then
  warn "Backend already running at http://127.0.0.1:$BACKEND_PORT; reusing it."
else
  info "Starting backend on http://127.0.0.1:$BACKEND_PORT..."
  : > "$BACKEND_LOG"
  npm run start -w server >"$BACKEND_LOG" 2>&1 &
  STARTED_BACKEND_PID="$!"

  info "Waiting for backend and Lucy agents to become healthy. This can take 1-2 minutes..."
  wait_for_url "backend" "http://127.0.0.1:$BACKEND_PORT/api/status" 240 || fail "Backend did not become ready. See $BACKEND_LOG"
fi

if url_ok "http://127.0.0.1:$WEB_PORT"; then
  warn "Frontend already running at http://127.0.0.1:$WEB_PORT; reusing it."
else
  info "Starting frontend on http://127.0.0.1:$WEB_PORT..."
  : > "$WEB_LOG"
  npm run dev -w web -- --host 0.0.0.0 --port "$WEB_PORT" >"$WEB_LOG" 2>&1 &
  STARTED_WEB_PID="$!"

  wait_for_url "frontend" "http://127.0.0.1:$WEB_PORT" 30 || fail "Frontend did not become ready. See $WEB_LOG"
fi

info "Dualing AI is ready: http://127.0.0.1:$WEB_PORT"
info "If port $WEB_PORT is not reachable from your browser, use the backend-served UI: http://127.0.0.1:$BACKEND_PORT"
info "Backend API: http://127.0.0.1:$BACKEND_PORT/api/status"
info "Logs: $LOG_DIR"
info "Press Ctrl+C to stop services started by this script."

while true; do
  sleep 3600 &
  wait $!
done
