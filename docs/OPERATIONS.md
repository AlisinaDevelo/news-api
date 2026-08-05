# Operations

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `GNEWS_API_KEY` | — | Required at runtime (except `NODE_ENV=test`). |
| `PORT` | `3000` | HTTP listen port. |
| `NODE_ENV` | — | Use `production` in deployed environments. |
| `LOG_LEVEL` | `info` (non-test) | Pino level (`trace`–`fatal`, or `silent`). |
| `GNEWS_BASE_URL` | `https://gnews.io/api/v4` | Upstream provider base URL. Override only for local integration tests, benchmarks, or compatible provider mocks. |
| `HTTP_TIMEOUT_MS` | `15000` | Outbound GNews request timeout (max `60000`). |
| `UPSTREAM_RETRY_ATTEMPTS` | `1` | Extra attempts for transient network/timeout and 5xx failures (maximum `3`; set `0` to disable). |
| `UPSTREAM_RETRY_BASE_DELAY_MS` | `100` | Initial exponential retry delay with jitter (maximum `2000`). |
| `STALE_CACHE_TTL_SEC` | `3600` | Longer-lived stale article cache TTL used only as an upstream-failure fallback (min effective value `>600`, max `86400`). |
| `CACHE_MAX_KEYS` | `2000` | Maximum number of keys held by the in-process cache. Fresh and stale entries both count; when full, the least-recently-used entry is evicted. Values above `100000` are clamped. Ignored when `REDIS_URL` is set. |
| `UPSTREAM_CIRCUIT_FAILURE_THRESHOLD` | `3` | Positive integer number of consecutive provider failures before the circuit opens; invalid values fall back to `3`. |
| `UPSTREAM_CIRCUIT_COOLDOWN_MS` | `30000` | How long to short-circuit provider calls after the circuit opens (max `300000`). Only one recovery probe is allowed after cooldown. |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | Force-exit if `server.close` does not finish. |
| `RATE_LIMIT_MAX` | `120` | Max requests per IP per window. |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window. |
| `DISABLE_RATE_LIMIT` | `0` | Set to `1` to disable limiting (emergency only). |
| `TRUST_PROXY` | `0` | Set to `1` behind a reverse proxy so rate limits use `X-Forwarded-For`. |
| `REDIS_URL` | — | If set (e.g. `redis://localhost:6379`), article search results and rate-limit quotas use Redis. Omit to use per-process memory stores. |
| `CLIENT_API_KEYS` | — | Comma-separated secrets. When set, every `/api/*` request must send header `X-API-Key` matching one value. Omit to allow unauthenticated API access (still use network controls in production). |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | Base OTLP URL (e.g. `http://jaeger:4318`). Traces POST to `/v1/traces`. Enables tracing when set. |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | — | Full traces URL; overrides the base + `/v1/traces` combination. |
| `OTEL_SERVICE_NAME` | `news-api` | `service.name` resource attribute. |
| `OTEL_TRACING_ENABLED` | `0` | Set to `1` to export traces to default `http://127.0.0.1:4318/v1/traces` when no OTLP endpoint env is set (local dev). |

Responses at or above 1 KiB are gzip-compressed when the client sends `Accept-Encoding: gzip`.
If an ingress or reverse proxy owns compression, disable compression at one layer so a response
is not compressed twice.

Runtime numeric settings are parsed as safe integers. Fractional, non-finite, negative, or
malformed values use their documented defaults; optional retry counts may be `0`, and settings
with documented maximums are clamped.

## Probes

- **Liveness:** `GET /health` — process is up.
- **Readiness:** `GET /ready` — `200` when `GNEWS_API_KEY` is set (non-test); `503` if not.

## API contract

- **`GET /openapi.yaml`** — served from `docs/openapi.yaml` relative to the process working directory. The production image sets `WORKDIR /app` and includes that file under `docs/openapi.yaml`.

## Scaling and cache

- **No `REDIS_URL`:** in-process cache (`node-cache`, 600s TTL, bounded to `CACHE_MAX_KEYS` entries with least-recently-used eviction). Each replica has its own entries. Fresh and stale keys share this capacity; expired entries are removed on access and new writes evict the oldest live entry when needed.
- **`REDIS_URL` set:** responses are cached in **Redis** with the same TTL so multiple instances can share entries.
- **Rate limits with `REDIS_URL`:** `rate-limit-redis` shares the quota across instances under the `news-api:rate-limit:` prefix. The limiter uses a separate Redis connection and fails closed with structured `503` errors if its store is unavailable.
- **Rate limits without `REDIS_URL`:** the built-in memory store protects each process independently; it does not provide cross-replica quota consistency.
- Cache keys include normalized search parameters: query, count, page, `lang`, `country`, `from`, `to`, and `sortBy`.
- Cache reads/writes are non-fatal for article searches. If the cache backend is unavailable, contains malformed Redis JSON, or contains a value that is not a valid article array, the service logs a warning, increments cache error metrics, deletes the corrupt key on a best-effort basis, falls through to GNews on read failure, and still returns the upstream response on write failure.
- Provider payloads with more than `100` articles are rejected as invalid so an upstream response cannot bypass the API's bounded collection contract.
- The GNews client rejects response bodies larger than `5 MiB` before the payload reaches application validation.
- Transient network/timeout and 5xx provider failures are retried with bounded exponential backoff and jitter. `429` and other 4xx responses, invalid payloads, and internal errors are not retried.
- Provider `429` responses return `429` with code `upstream_rate_limited`; provider `503` responses return `503` with code `upstream_unavailable`. A valid provider `Retry-After` value is normalized to delta-seconds and capped at 86400 seconds, while arbitrary upstream headers are never forwarded.
- The circuit breaker counts network failures, `408`, `425`, `429`, and 5xx responses; permanent 4xx responses remain visible as upstream errors without opening the circuit.
- Identical in-flight misses are coalesced per process, so concurrent requests for the same normalized search wait on one upstream provider request.
- Successful searches are also written to a longer-lived stale cache key. If a later fresh miss hits an upstream failure and stale data is available, `/api/v1/*` returns `meta.cache=stale` and `X-Cache-Status: stale` with a `200` response instead of surfacing the provider outage.

Rate limiting uses `standardHeaders: draft-8`, disables legacy `X-RateLimit-*` headers, applies
the library's IPv6 `/56` key policy, and sends `Retry-After` when a quota is exceeded. Set
`TRUST_PROXY=1` only when the service is behind one trusted proxy hop.

On shutdown the server closes the cache and rate-limit Redis connections when those backends were used.

## Metrics

`GET /metrics` exposes default Node.js process metrics plus application metrics:

| Metric | Labels | Purpose |
|--------|--------|---------|
| `http_requests_total` | `method`, `status_code` | HTTP response count. |
| `news_cache_events_total` | `result=hit|miss|error|coalesced|stale` | Cache lookup, stale fallback, and in-flight coalescing behavior for article searches. |
| `news_cache_errors_total` | `operation=get|set|get_stale|set_stale|delete|delete_stale` | Cache backend errors that were tolerated by falling through to upstream, returning an uncached upstream response, skipping stale fallback, or failing to quarantine a corrupt entry. |
| `news_cache_evictions_total` | — | Least-recently-used entries evicted from the bounded in-process cache. |
| `news_rate_limit_store_errors_total` | `source=request|lifecycle|connection` | Rate-limit Redis/store failures; the request path fails closed with `503`. |
| `news_upstream_requests_total` | `outcome=success|error|invalid_payload` | GNews provider request outcomes. |
| `news_upstream_retries_total` | — | Transient upstream retry attempts. |
| `news_upstream_request_duration_seconds` | `outcome=success|error|invalid_payload` | GNews provider request latency histogram. |
| `news_upstream_circuit_events_total` | `event=opened|short_circuit|half_open|closed` | Provider circuit breaker state transitions and short-circuited requests. |

Use cache hit rate and coalesced miss counts to understand quota protection, stale counts to see when provider trouble is being hidden by cached data, cache error metrics to detect Redis/backend trouble, upstream latency/error metrics to separate provider trouble from local API trouble, and circuit events to see when repeated provider failures are being shed locally.

## Docker

```bash
docker build -t news-api:local .
docker run --rm -p 3000:3000 -e GNEWS_API_KEY=your_key news-api:local
```

Or with Compose (requires `GNEWS_API_KEY` in `.env`):

```bash
docker compose up --build
```

## Smoke test

After the service is running and ready, run:

```bash
BASE_URL=http://localhost:3000 QUERY=postgres npm run smoke
```

If `CLIENT_API_KEYS` is configured, pass a matching client key:

```bash
CLIENT_API_KEY=client-secret-one npm run smoke
```

The smoke test checks `/health`, `/ready`, `/openapi.yaml`, the legacy `/api/articles` route,
and two versioned searches. Set `PAGE` to exercise a specific provider page; the Compose
smoke uses page 2 against the fake provider. The v1 checks verify `X-API-Version: v1` and
the expected `X-Cache-Status: miss` then `hit` transition before checking `/metrics`.

To smoke-test the production container without a live GNews key, boot the CI Compose stack against the fake provider:

```bash
npm run smoke:docker
```

For hosted Docker deployment notes and safe public-demo defaults, see [DEPLOYMENT.md](DEPLOYMENT.md).

## Local Benchmark

For reproducible cache/upstream performance checks without a live GNews key:

```bash
npm run benchmark:local
```

See [BENCHMARKS.md](BENCHMARKS.md) for methodology and tuning variables.

## Logs

Logs are **JSON** (Pino). Each response includes an `x-request-id` header for correlation.

## Graceful shutdown

The process closes the HTTP server on `SIGTERM` / `SIGINT` before exit. Orchestrators should use termination grace periods longer than `SHUTDOWN_TIMEOUT_MS`.
