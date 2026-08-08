#!/bin/sh
set -eu

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.ci.yml}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-news-api-ci}"
BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
RATE_LIMIT_A_URL="${RATE_LIMIT_A_URL:-http://127.0.0.1:3001}"
RATE_LIMIT_B_URL="${RATE_LIMIT_B_URL:-http://127.0.0.1:3002}"
RATE_LIMIT_CLIENT_IP="${RATE_LIMIT_CLIENT_IP:-198.51.100.42}"
FAKE_GNEWS_URL="${FAKE_GNEWS_URL:-http://127.0.0.1:4010}"
RATE_LIMIT_BODY="$(mktemp)"
READINESS_BODY="$(mktemp)"
CACHE_COORDINATION_BODY_A="$(mktemp)"
CACHE_COORDINATION_BODY_B="$(mktemp)"
CACHE_COORDINATION_STATUS_A="$(mktemp)"
CACHE_COORDINATION_STATUS_B="$(mktemp)"

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" logs --no-color || true
  fi
  docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" down -v --remove-orphans || true
  rm -f "$RATE_LIMIT_BODY" "$READINESS_BODY" "$CACHE_COORDINATION_BODY_A" "$CACHE_COORDINATION_BODY_B" "$CACHE_COORDINATION_STATUS_A" "$CACHE_COORDINATION_STATUS_B"
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

wait_for_rate_limit_store_failure() {
  name="$1"
  url="$2"
  attempt=1
  while [ "$attempt" -le 30 ]; do
    status="$(curl -sS -o "$READINESS_BODY" -w "%{http_code}" "$url/ready" || true)"
    if [ "$status" = "503" ] && grep -q 'rate_limit_store_unavailable' "$READINESS_BODY"; then
      echo "UNREADY $name ($url): rate-limit store unavailable"
      return 0
    fi

    if [ "$attempt" -eq 30 ]; then
      echo "FAIL $name did not report the unavailable rate-limit store"
      cat "$READINESS_BODY"
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

cache_stats() {
  node -e 'fetch(process.argv[1] + "/stats").then((response) => response.json()).then((body) => process.stdout.write(String(body.searchRequests))).catch(() => process.exit(1))' "$FAKE_GNEWS_URL"
}

CACHE_COORDINATION_QUERY="compose-cache-coordination-$(date +%s)-$$"
CACHE_COORDINATION_PATH="/api/v1/articles?query=$CACHE_COORDINATION_QUERY&count=1"
CACHE_COORDINATION_BEFORE="$(cache_stats)"

curl -sS \
  -H "X-Forwarded-For: 198.51.100.43" \
  -o "$CACHE_COORDINATION_BODY_A" \
  -w "%{http_code}" \
  "$RATE_LIMIT_A_URL$CACHE_COORDINATION_PATH" >"$CACHE_COORDINATION_STATUS_A" &
CACHE_COORDINATION_PID_A=$!
curl -sS \
  -H "X-Forwarded-For: 198.51.100.44" \
  -o "$CACHE_COORDINATION_BODY_B" \
  -w "%{http_code}" \
  "$RATE_LIMIT_B_URL$CACHE_COORDINATION_PATH" >"$CACHE_COORDINATION_STATUS_B" &
CACHE_COORDINATION_PID_B=$!

wait "$CACHE_COORDINATION_PID_A"
wait "$CACHE_COORDINATION_PID_B"
CACHE_COORDINATION_STATUS_VALUE_A="$(cat "$CACHE_COORDINATION_STATUS_A")"
CACHE_COORDINATION_STATUS_VALUE_B="$(cat "$CACHE_COORDINATION_STATUS_B")"
if [ "$CACHE_COORDINATION_STATUS_VALUE_A" != "200" ] || [ "$CACHE_COORDINATION_STATUS_VALUE_B" != "200" ]; then
  echo "FAIL cross-replica cache coordination: expected two HTTP 200 responses, got $CACHE_COORDINATION_STATUS_VALUE_A and $CACHE_COORDINATION_STATUS_VALUE_B"
  cat "$CACHE_COORDINATION_BODY_A" "$CACHE_COORDINATION_BODY_B"
  exit 1
fi

CACHE_COORDINATION_AFTER="$(cache_stats)"
CACHE_COORDINATION_EXPECTED=$((CACHE_COORDINATION_BEFORE + 1))
if [ "$CACHE_COORDINATION_AFTER" -ne "$CACHE_COORDINATION_EXPECTED" ]; then
  echo "FAIL cross-replica cache coordination: expected one fake-provider call ($CACHE_COORDINATION_EXPECTED), got $CACHE_COORDINATION_AFTER"
  exit 1
fi
echo "OK   cross-replica cache coordination (one upstream call)"

BASE_URL="$BASE_URL" QUERY="${QUERY:-ci-smoke}" COUNT="${COUNT:-3}" PAGE="${PAGE:-2}" npm run smoke

docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" stop redis
wait_for_rate_limit_store_failure "rate-limit-a" "$RATE_LIMIT_A_URL"
wait_for_rate_limit_store_failure "rate-limit-b" "$RATE_LIMIT_B_URL"

cache_only_status="$(curl -sS -o "$READINESS_BODY" -w "%{http_code}" "$BASE_URL/ready" || true)"
if [ "$cache_only_status" != "200" ]; then
  echo "FAIL cache-only replica became unready when Redis stopped: HTTP $cache_only_status"
  cat "$READINESS_BODY"
  exit 1
fi
echo "OK   cache-only replica remains ready without Redis (200)"

for url in "$RATE_LIMIT_A_URL" "$RATE_LIMIT_B_URL"; do
  if ! curl -fsS "$url/health" >/dev/null; then
    echo "FAIL rate-limited replica liveness failed while Redis was stopped: $url"
    exit 1
  fi
done
echo "OK   rate-limited replica liveness remains healthy without Redis"

docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" start redis
wait_for_ready "rate-limit-a recovered" "$RATE_LIMIT_A_URL"
wait_for_ready "rate-limit-b recovered" "$RATE_LIMIT_B_URL"
