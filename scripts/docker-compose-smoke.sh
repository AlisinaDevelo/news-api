#!/bin/sh
set -eu

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.ci.yml}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-news-api-ci}"
BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
RATE_LIMIT_A_URL="${RATE_LIMIT_A_URL:-http://127.0.0.1:3001}"
RATE_LIMIT_B_URL="${RATE_LIMIT_B_URL:-http://127.0.0.1:3002}"
RATE_LIMIT_CLIENT_IP="${RATE_LIMIT_CLIENT_IP:-198.51.100.42}"
RATE_LIMIT_BODY="$(mktemp)"

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" logs --no-color || true
  fi
  docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" down -v --remove-orphans || true
  rm -f "$RATE_LIMIT_BODY"
  exit "$status"
}

trap cleanup EXIT

docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" up --build -d

wait_for_ready() {
  name="$1"
  url="$2"
  attempt=1
  while [ "$attempt" -le 30 ]; do
    if curl -fsS "$url/ready" >/dev/null 2>&1; then
      echo "READY $name ($url)"
      return 0
    fi

    if [ "$attempt" -eq 30 ]; then
      echo "FAIL $name did not become ready at $url"
      return 1
    fi

    attempt=$((attempt + 1))
    sleep 2
  done
}

wait_for_ready "api" "$BASE_URL"
wait_for_ready "rate-limit-a" "$RATE_LIMIT_A_URL"
wait_for_ready "rate-limit-b" "$RATE_LIMIT_B_URL"

RATE_LIMIT_QUERY="compose-rate-limit-$(date +%s)-$$"
RATE_LIMIT_PATH="/api/v1/articles?query=$RATE_LIMIT_QUERY&count=1"

first_status="$(curl -sS \
  -H "X-Forwarded-For: $RATE_LIMIT_CLIENT_IP" \
  -o "$RATE_LIMIT_BODY" \
  -w "%{http_code}" \
  "$RATE_LIMIT_A_URL$RATE_LIMIT_PATH")"
if [ "$first_status" != "200" ]; then
  echo "FAIL shared rate limit first replica: expected HTTP 200, got HTTP $first_status"
  cat "$RATE_LIMIT_BODY"
  exit 1
fi
echo "OK   shared rate limit first replica (200)"

second_status="$(curl -sS \
  -H "X-Forwarded-For: $RATE_LIMIT_CLIENT_IP" \
  -o "$RATE_LIMIT_BODY" \
  -w "%{http_code}" \
  "$RATE_LIMIT_B_URL$RATE_LIMIT_PATH")"
if [ "$second_status" != "429" ]; then
  echo "FAIL shared rate limit second replica: expected HTTP 429, got HTTP $second_status"
  cat "$RATE_LIMIT_BODY"
  exit 1
fi
if ! grep -q 'rate_limit_exceeded' "$RATE_LIMIT_BODY"; then
  echo "FAIL shared rate limit second replica: missing structured error code"
  cat "$RATE_LIMIT_BODY"
  exit 1
fi
echo "OK   shared rate limit second replica (429)"

BASE_URL="$BASE_URL" QUERY="${QUERY:-ci-smoke}" COUNT="${COUNT:-3}" PAGE="${PAGE:-2}" npm run smoke
