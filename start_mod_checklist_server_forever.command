#!/usr/bin/env bash
set -u

cd "$(dirname "$0")" || exit 1

APP_NAME="Inspectria"
PORT="${PORT:-4000}"
URL="http://localhost:${PORT}"
LOG_DIR="logs"
STARTUP_LOG="${LOG_DIR}/startup.log"

echo "Preparing ${APP_NAME} server..."
mkdir -p "${LOG_DIR}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install it from https://nodejs.org/ and run this file again."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required. Install Node.js from https://nodejs.org/ and run this file again."
  exit 1
fi

if [ ! -f "frontend/dist/index.html" ]; then
  echo "Frontend build not found. Installing frontend dependencies..."
  if ! npm --prefix frontend install >>"${STARTUP_LOG}" 2>&1; then
    echo "Frontend dependency installation failed. See ${STARTUP_LOG}."
    exit 1
  fi

  echo "Building frontend for production..."
  if ! npm --prefix frontend exec -- vite build frontend >>"${STARTUP_LOG}" 2>&1; then
    echo "Frontend build failed. See ${STARTUP_LOG}."
    exit 1
  fi
fi

echo "Installing backend dependencies if needed..."
if ! npm --prefix backend install >>"${STARTUP_LOG}" 2>&1; then
  echo "Backend dependency installation failed. See ${STARTUP_LOG}."
  exit 1
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set. Using default postgres://inspectra:inspectra@localhost:5432/inspectra"
fi

PG_BIN="${ROOT:-$(pwd)}/.local-tools/Postgres.app/Contents/Versions/16/bin"
PG_DATA="${ROOT:-$(pwd)}/backend/pgdata"

if [ -x "${PG_BIN}/pg_ctl" ]; then
  if ! "${PG_BIN}/pg_ctl" -D "${PG_DATA}" status >/dev/null 2>&1; then
    echo "Starting bundled PostgreSQL..."
    if [ ! -d "${PG_DATA}" ]; then
      "${PG_BIN}/initdb" -D "${PG_DATA}" -U inspectra -A trust >>"${STARTUP_LOG}" 2>&1
    fi

    "${PG_BIN}/pg_ctl" -D "${PG_DATA}" -l "${LOG_DIR}/postgres.log" -o "-p 5432" start >>"${STARTUP_LOG}" 2>&1
    "${PG_BIN}/createdb" -h localhost -p 5432 -U inspectra inspectra >>"${STARTUP_LOG}" 2>&1 || true
  fi
fi

echo "Opening ${URL}..."
open "${URL}" >/dev/null 2>&1 || true

while true; do
  if command -v lsof >/dev/null 2>&1 && lsof -ti "tcp:${PORT}" >/dev/null 2>&1; then
    if curl -fsS "${URL}/api/health" >/dev/null 2>&1; then
      echo "${APP_NAME} is already running at ${URL}"
      exit 0
    fi

    echo "Port ${PORT} is already in use. Stop the other app or set PORT to another value."
    exit 1
  fi

  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting ${APP_NAME} on port ${PORT}..."
  PORT="${PORT}" node backend/server.js
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Server stopped. Restarting in 5 seconds..."
  sleep 5
done
