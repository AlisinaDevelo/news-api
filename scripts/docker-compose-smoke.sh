#!/bin/sh
set -eu

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.ci.yml}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-news-api-ci}"
BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" logs --no-color || true
  fi
  docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" down -v --remove-orphans || true
  exit "$status"
}

trap cleanup EXIT

docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" up --build -d

attempt=1
while [ "$attempt" -le 30 ]; do
  if curl -fsS "$BASE_URL/ready" >/dev/null 2>&1; then
    break
  fi

  if [ "$attempt" -eq 30 ]; then
    echo "FAIL api did not become ready at $BASE_URL"
    exit 1
  fi

  attempt=$((attempt + 1))
  sleep 2
done

BASE_URL="$BASE_URL" QUERY="${QUERY:-ci-smoke}" COUNT="${COUNT:-3}" npm run smoke
