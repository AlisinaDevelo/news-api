#!/bin/sh
set -eu

BASE_URL="${BASE_URL:-http://localhost:3000}"
QUERY="${QUERY:-technology}"
COUNT="${COUNT:-3}"
PAGE="${PAGE:-1}"

TMP_BODY="$(mktemp)"
TMP_HEADERS="$(mktemp)"
trap 'rm -f "$TMP_BODY" "$TMP_HEADERS"' EXIT

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

header_value() {
  header_name="$1"

  awk -v target="$header_name" '
    BEGIN { target = tolower(target) }
    {
      line = $0
      sub(/\r$/, "", line)
      separator = index(line, ":")
      if (separator > 0 && tolower(substr(line, 1, separator - 1)) == target) {
        value = substr(line, separator + 1)
        sub(/^[[:space:]]*/, "", value)
        print value
        exit
      }
    }
  ' "$TMP_HEADERS"
}

expect_header() {
  header_check_name="$1"
  header_check_name_value="$2"
  header_check_expected="$3"
  header_check_actual="$(header_value "$header_check_name_value")"

  if [ "$header_check_actual" != "$header_check_expected" ]; then
    echo "FAIL $header_check_name: expected $header_check_name_value: $header_check_expected, got: ${header_check_actual:-<missing>}"
    cat "$TMP_HEADERS"
    exit 1
  fi
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

expect_api_response() {
  response_name="$1"
  response_expected_status="$2"
  response_url="$3"
  response_expected_api_version="$4"
  response_expected_cache_status="${5:-}"

  if [ -n "${CLIENT_API_KEY:-}" ]; then
    response_status="$(curl -sS -D "$TMP_HEADERS" -H "X-API-Key: $CLIENT_API_KEY" -o "$TMP_BODY" -w "%{http_code}" "$response_url")" || {
      echo "FAIL $response_name: request failed"
      exit 1
    }
  else
    response_status="$(curl -sS -D "$TMP_HEADERS" -o "$TMP_BODY" -w "%{http_code}" "$response_url")" || {
      echo "FAIL $response_name: request failed"
      exit 1
    }
  fi

  if [ "$response_status" != "$response_expected_status" ]; then
    echo "FAIL $response_name: expected HTTP $response_expected_status, got HTTP $response_status"
    head -c 500 "$TMP_BODY"
    echo
    exit 1
  fi

  expect_header "$response_name API version" "X-API-Version" "$response_expected_api_version"
  if [ -n "$response_expected_cache_status" ]; then
    expect_header "$response_name cache status" "X-Cache-Status" "$response_expected_cache_status"
  fi

  if [ -n "$response_expected_cache_status" ]; then
    echo "OK   $response_name ($response_status, cache=$response_expected_cache_status)"
  else
    echo "OK   $response_name ($response_status)"
  fi
}

ENCODED_QUERY="$(url_encode "$QUERY")"
V1_QUERY="${QUERY}-v1-smoke-$(date +%s)-$$"
ENCODED_V1_QUERY="$(url_encode "$V1_QUERY")"
V1_URL="$BASE_URL/api/v1/articles?query=$ENCODED_V1_QUERY&count=$COUNT&page=$PAGE"

echo "Smoke testing $BASE_URL"
expect_status "health" "200" "$BASE_URL/health"
expect_status "ready" "200" "$BASE_URL/ready"
expect_status "openapi" "200" "$BASE_URL/openapi.yaml"
expect_api_status "articles" "200" "$BASE_URL/api/articles?query=$ENCODED_QUERY&count=$COUNT"
expect_api_response "v1 articles (cache miss)" "200" "$V1_URL" "v1" "miss"
expect_api_response "v1 articles (cache hit)" "200" "$V1_URL" "v1" "hit"
expect_status "metrics" "200" "$BASE_URL/metrics"
