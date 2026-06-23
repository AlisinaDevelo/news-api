#!/bin/sh
set -eu

BASE_URL="${BASE_URL:-http://localhost:3000}"
QUERY="${QUERY:-technology}"
COUNT="${COUNT:-3}"

TMP_BODY="$(mktemp)"
trap 'rm -f "$TMP_BODY"' EXIT

url_encode() {
  node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"
}

expect_status() {
  name="$1"
  expected="$2"
  url="$3"

  if ! status="$(curl -sS -o "$TMP_BODY" -w "%{http_code}" "$url")"; then
    echo "FAIL $name: request failed"
    exit 1
  fi

  if [ "$status" != "$expected" ]; then
    echo "FAIL $name: expected HTTP $expected, got HTTP $status"
    head -c 500 "$TMP_BODY"
    echo
    exit 1
  fi

  echo "OK   $name ($status)"
}

expect_api_status() {
  name="$1"
  expected="$2"
  url="$3"

  if [ -n "${CLIENT_API_KEY:-}" ]; then
    status="$(curl -sS -H "X-API-Key: $CLIENT_API_KEY" -o "$TMP_BODY" -w "%{http_code}" "$url")" || {
      echo "FAIL $name: request failed"
      exit 1
    }
  else
    status="$(curl -sS -o "$TMP_BODY" -w "%{http_code}" "$url")" || {
      echo "FAIL $name: request failed"
      exit 1
    }
  fi

  if [ "$status" != "$expected" ]; then
    echo "FAIL $name: expected HTTP $expected, got HTTP $status"
    head -c 500 "$TMP_BODY"
    echo
    exit 1
  fi

  echo "OK   $name ($status)"
}

ENCODED_QUERY="$(url_encode "$QUERY")"

echo "Smoke testing $BASE_URL"
expect_status "health" "200" "$BASE_URL/health"
expect_status "ready" "200" "$BASE_URL/ready"
expect_status "openapi" "200" "$BASE_URL/openapi.yaml"
expect_api_status "articles" "200" "$BASE_URL/api/articles?query=$ENCODED_QUERY&count=$COUNT"
expect_status "metrics" "200" "$BASE_URL/metrics"
