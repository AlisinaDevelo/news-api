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
| `UPSTREAM_TOTAL_TIMEOUT_MS` | `60000` | Total GNews search budget across all attempts and retry backoff (max `120000`). |
| `UPSTREAM_RETRY_ATTEMPTS` | `1` | Extra attempts for transient network/timeout and 5xx failures (maximum `3`; set `0` to disable). |
| `UPSTREAM_RETRY_BASE_DELAY_MS` | `100` | Initial exponential retry delay with jitter (maximum `2000`). |
| `STALE_CACHE_TTL_SEC` | `3600` | Longer-lived stale article cache TTL used only as an upstream-failure fallback (min effective value `>600`, max `86400`). |
| `CACHE_MAX_KEYS` | `2000` | Maximum number of keys held by the in-process cache. Fresh and stale entries both count; when full, the least-recently-used entry is evicted. Values above `100000` are clamped. Ignored when `REDIS_URL` is set. |
| `CACHE_LEASE_TTL_MS` | `5000` | Redis cache-miss lease lifetime. Values above `30000` are clamped; only active when `REDIS_URL` is set. |
| `CACHE_LEASE_HEARTBEAT_MS` | half of `CACHE_LEASE_TTL_MS` | Owner-token-safe Redis TTL renewal interval. It is capped at half the lease TTL and `15000` ms. |
| `CACHE_LEASE_WAIT_MS` | `750` | Maximum time a replica waits for another replica to fill a fresh cache key before fetching upstream. Values above `5000` are clamped. |
| `CACHE_LEASE_POLL_MS` | `50` | Base Redis/cache recheck interval while waiting for a shared miss. Values above `500` are clamped and jitter is applied. |
| `CACHE_REDIS_COMMAND_TIMEOUT_MS` | `500` | Maximum time an article-cache Redis command waits for a reply. Values above `1000` are clamped. |
| `CACHE_REDIS_CONNECT_TIMEOUT_MS` | `1000` | Maximum time the article-cache Redis client waits while establishing a connection. Values above `5000` are clamped. |
| `UPSTREAM_CIRCUIT_FAILURE_THRESHOLD` | `3` | Positive integer number of consecutive provider failures before the circuit opens; invalid values fall back to `3`. |
| `UPSTREAM_CIRCUIT_COOLDOWN_MS` | `30000` | How long to short-circuit provider calls after the circuit opens (max `300000`). Only one recovery probe is allowed after cooldown. |
| `SERVER_REQUEST_TIMEOUT_MS` | `75000` | Maximum time to receive a complete incoming HTTP request. Values above `120000` are clamped; keep it above `UPSTREAM_TOTAL_TIMEOUT_MS` when provider work can run to its budget. Node returns `408` when this expires. |
| `SERVER_HEADERS_TIMEOUT_MS` | `10000` | Maximum time to receive complete HTTP headers. Values above `60000` and values above the request timeout are clamped; Node returns `408` when this expires. |
| `SERVER_MAX_HEADER_SIZE_BYTES` | `16384` | Maximum incoming request-header bytes. Values above `65536` are clamped; oversized headers return `431` and increment `header_overflow`. |
| `SERVER_MAX_JSON_BODY_BYTES` | `32768` | Maximum `application/json` request-body bytes parsed by Express. Values above `262144` are clamped; oversized bodies return `413` and increment `news_http_body_errors_total{type="entity.too.large"}`. |
| `SERVER_TRANSPORT_LOG_BURST` | `10` | Maximum warning logs per fixed transport event label during one window. Values above `100` are clamped; all events remain metriced. |
| `SERVER_TRANSPORT_LOG_WINDOW_MS` | `60000` | Window for the per-event transport warning budget. Values above `300000` ms are clamped. |
| `SERVER_KEEP_ALIVE_TIMEOUT_MS` | `5000` | Idle time after a response before the HTTP server closes a keep-alive socket. Values above `120000` are clamped. |
| `SERVER_MAX_REQUESTS_PER_SOCKET` | `1000` | Maximum requests per keep-alive socket. Values above `10000` are clamped; set `0` only when a trusted proxy owns connection reuse. Node returns `503` beyond the cap. |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | Force-exit if `server.close` does not finish. |
| `RATE_LIMIT_MAX` | `120` | Max requests per IP per window. |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window. |
| `RATE_LIMIT_REDIS_COMMAND_TIMEOUT_MS` | `500` | Maximum time a shared rate-limit Redis command waits for a reply. Values above `1000` are clamped; failures are fail-closed. |
| `RATE_LIMIT_REDIS_CONNECT_TIMEOUT_MS` | `1000` | Maximum time the shared rate-limit Redis client waits while establishing a connection. Values above `5000` are clamped. |
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
- **Readiness:** `GET /ready` — `200` when `GNEWS_API_KEY` is set and the process is serving; `503` with
  `status=not_ready` when the key is missing or `status=draining` after shutdown begins.

## API contract

- **`GET /openapi.yaml`** — served from `docs/openapi.yaml` relative to the process working directory. The production image sets `WORKDIR /app` and includes that file under `docs/openapi.yaml`.

## Scaling and cache

- **No `REDIS_URL`:** in-process cache (`node-cache`, 600s TTL, bounded to `CACHE_MAX_KEYS` entries with least-recently-used eviction). Each replica has its own entries. Fresh and stale keys share this capacity; expired entries are removed on access and new writes evict the oldest live entry when needed.
- **`REDIS_URL` set:** responses are cached in **Redis** with the same TTL so multiple instances can share entries. Cold misses also use a short owner-token lease (`SET NX PX`) and bounded cache rechecks to reduce duplicate GNews calls across replicas. While the owner is still loading upstream, a half-TTL owner-checked heartbeat renews the lease; a lost lease or renewal error remains fail-open and never makes article requests fail by itself.
- The article-cache Redis client uses the configured command and connection timeouts, retries each command at most once, and disables ioredis's offline command queue. A disconnected or slow cache command therefore fails promptly into the existing upstream/stale fallback path; reconnect attempts remain enabled so a recovered Redis instance can resume sharing cache entries. These settings apply to article caching and lease operations, not the separate fail-closed rate-limit client.
- **Rate limits with `REDIS_URL`:** `rate-limit-redis` shares the quota across instances under the `news-api:rate-limit:` prefix. The limiter uses a separate Redis connection and fails closed with structured `503` errors if its store is unavailable.
- The rate-limit Redis client uses its own command and connection budgets, retries each command at most once, and disables ioredis's offline command queue. Initial and reconnect readiness is bounded before a command is sent; a timeout or unavailable backend becomes the existing structured `503`, while healthy Redis retains shared `429` quota behavior.
- **Rate limits without `REDIS_URL`:** the built-in memory store protects each process independently; it does not provide cross-replica quota consistency.
- Cache keys include normalized search parameters: query, count, page, `lang`, `country`, `from`, `to`, and `sortBy`.
- Cache reads/writes are non-fatal for article searches. If the cache backend is unavailable, contains malformed Redis JSON, or contains a value that is not a valid article array, the service logs a warning, increments cache error metrics, deletes the corrupt key on a best-effort basis, falls through to GNews on read failure, and still returns the upstream response on write failure.
- Provider payloads with more than `100` articles are rejected as invalid so an upstream response cannot bypass the API's bounded collection contract.
- The GNews client rejects response bodies larger than `5 MiB` before the payload reaches application validation.
- Transient network/timeout and 5xx provider failures are retried with bounded exponential backoff and jitter. `429` and other 4xx responses, invalid payloads, and internal errors are not retried.
- `HTTP_TIMEOUT_MS` limits each provider attempt; `UPSTREAM_TOTAL_TIMEOUT_MS` caps the entire search, including retries and backoff. Total-budget exhaustion is recorded as `timeout`, counts toward the circuit breaker, and uses the normal `502` upstream error. Client disconnects and process shutdown remain `canceled` and do not count as provider failures.
- Provider `429` responses return `429` with code `upstream_rate_limited`; provider `503` responses return `503` with code `upstream_unavailable`. A valid provider `Retry-After` value is normalized to delta-seconds and capped at 86400 seconds, while arbitrary upstream headers are never forwarded.
- The circuit breaker counts network failures, `408`, `425`, `429`, and 5xx responses; permanent 4xx responses remain visible as upstream errors without opening the circuit.
- Identical in-flight misses are coalesced per process, so concurrent requests for the same normalized search wait on one upstream provider request.
- Redis-backed replicas coordinate the same normalized miss with a bounded lease. The winner rechecks the cache after acquiring the lease, writes the fresh result, and releases only its owner token; waiters return the shared cache value when it appears. A waiter deadline can permit duplicate upstream work, preserving availability over indefinite lock contention.
- The owner heartbeat stops on every load exit path. A renewal result of `lost` means the token no longer owns the key; the request may finish and populate the cache, but it does not assume exclusive ownership and final release remains compare-and-delete.
- If a client disconnects before its response ends, its waiter is canceled and `news_request_cancellations_total` increments. Coalesced upstream work continues for remaining waiters; when no waiters remain, the provider request and retry delay are aborted. Canceled work is not retried, counted as a circuit failure, or converted into stale fallback.
- Successful searches are also written to a longer-lived stale cache key. If a later fresh miss hits an upstream failure and stale data is available, `/api/v1/*` returns `meta.cache=stale` and `X-Cache-Status: stale` with a `200` response instead of surfacing the provider outage.

Rate limiting uses `standardHeaders: draft-8`, disables legacy `X-RateLimit-*` headers, applies
the library's IPv6 `/56` key policy, and sends `Retry-After` when a quota is exceeded. Set
`TRUST_PROXY=1` only when the service is behind one trusted proxy hop.

On shutdown the server closes the cache and rate-limit Redis connections when those backends were used.

The production HTTP server applies explicit transport limits. `SERVER_REQUEST_TIMEOUT_MS` covers
receiving the request body, while `UPSTREAM_TOTAL_TIMEOUT_MS` covers provider work after routing;
the request setting should remain slightly higher. Header parsing has its own shorter budget, and
`SERVER_MAX_HEADER_SIZE_BYTES` bounds the bytes the Node parser accepts before Express. Idle
keep-alive sockets are closed after `SERVER_KEEP_ALIVE_TIMEOUT_MS`, and a socket is retired after
`SERVER_MAX_REQUESTS_PER_SOCKET` requests. A reverse proxy may impose stricter limits, but should
keep its request, header, and idle budgets compatible with these application settings.

Express parses only JSON bodies and applies a 32768-byte default limit, with a 262144-byte maximum
operator override. Oversized entities return `413`; malformed JSON returns `400`; unsupported
encoding or charset returns `415`. These responses use fixed public messages and, on `/api/v1/*`,
stable error codes plus the normalized request ID. Body-parser errors can carry the failed body,
so the error handler logs only the fixed parser type and status and increments
`news_http_body_errors_total{type=...}`.

Warnings for malformed transport input and per-socket request drops use an independent budget per
fixed event label. `SERVER_TRANSPORT_LOG_BURST` and `SERVER_TRANSPORT_LOG_WINDOW_MS` bound log
volume without dropping telemetry: every event increments `news_http_server_events_total`, while
suppressed warnings increment `news_http_server_log_suppressed_total`. The next warning after a
window rollover reports only how many warnings were suppressed; raw packets, URLs, bodies, parser
messages, and error objects are never logged. Set `LOG_LEVEL=silent` or a level above `warn` to
disable these warning logs without changing the event counters.

HTTP access logs use an explicit privacy allowlist. They retain the normalized request ID, method,
pathname (capped at 512 bytes), response status, and response time. They do not retain request
headers, query strings, request bodies, remote address/port, or arbitrary request objects. Client
`X-Request-Id` values must be 1-128 ASCII characters from `A-Z`, `a-z`, `0-9`, `.`, `_`, `:`, `/`,
`~`, or `-`; invalid or oversized values are replaced with a generated UUID and increment
`news_request_id_rejections_total`.

Transport failures that occur before Express middleware are counted by
`news_http_server_events_total`. The application preserves Node's protocol responses for malformed
requests (`400`), request/header timeouts (`408`), oversized headers (`431`), and oversized chunk
extensions (`413`), then closes the affected socket. Requests beyond the per-socket limit receive
Node's `503` response and increment the `dropped_request` event. These events do not include raw
request bytes, URLs, bodies, or error messages.

## Tracing

Set `OTEL_EXPORTER_OTLP_ENDPOINT` or `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` to enable OTLP export.
The service starts automatic HTTP/Express instrumentation before the application loads and adds
domain spans for search, cache lookup/write, upstream requests and retries, circuit decisions,
and stale fallback. These spans use fixed names and bounded outcome/state attributes. Query text,
API keys, raw provider URLs, article content, and exception messages are not recorded.

The OpenTelemetry SDK honors the standard `OTEL_TRACES_SAMPLER` and `OTEL_TRACES_SAMPLER_ARG`
settings, so production sampling can be tuned without changing the service. For example,
`OTEL_TRACES_SAMPLER=parentbased_traceidratio` with `OTEL_TRACES_SAMPLER_ARG=0.1` keeps an
approximately ten-percent trace sample while preserving parent decisions.

## Metrics

`GET /metrics` exposes default Node.js process metrics plus application metrics:

| Metric | Labels | Purpose |
|--------|--------|---------|
| `http_requests_total` | `method`, `status_code` | HTTP response count. |
| `news_http_server_events_total` | `event=client_error|request_timeout|header_overflow|chunk_extensions_overflow|dropped_request` | Pre-Express parser errors and requests dropped after the per-socket request cap. |
| `news_http_server_log_suppressed_total` | `event=client_error|request_timeout|header_overflow|chunk_extensions_overflow|dropped_request` | Transport warning logs skipped after the per-event burst budget was exhausted. |
| `news_request_id_rejections_total` | — | Client request IDs rejected by the bounded HTTP logging boundary and replaced with generated IDs. |
| `news_http_body_errors_total` | `type=entity.too.large|entity.parse.failed|request.aborted|request.size.invalid|encoding.unsupported|charset.unsupported|entity.verify.failed|parameters.too.many` | JSON/body-parser failures returned to clients without logging raw bodies or parser messages. |
| `news_cache_events_total` | `result=hit|miss|error|coalesced|stale` | Cache lookup, stale fallback, and in-flight coalescing behavior for article searches. |
| `news_cache_errors_total` | `operation=get|set|get_stale|set_stale|delete|delete_stale` | Cache backend errors that were tolerated by falling through to upstream, returning an uncached upstream response, skipping stale fallback, or failing to quarantine a corrupt entry. |
| `news_cache_evictions_total` | — | Least-recently-used entries evicted from the bounded in-process cache. |
| `news_cache_coordination_events_total` | `event=acquired|waited|hit|bypassed|expired|error|renewed|lost|renewal_error|released|release_error` | Cross-replica Redis cache-miss lease and heartbeat outcomes. |
| `news_rate_limit_store_errors_total` | `source=request|lifecycle|connection` | Rate-limit Redis/store failures; the request path fails closed with `503`. |
| `news_request_cancellations_total` | `reason=client_disconnect` | Downstream requests that disconnected before their response completed. |
| `news_upstream_requests_total` | `outcome=success|error|invalid_payload|canceled|timeout` | GNews provider request outcomes. |
| `news_upstream_retries_total` | — | Transient upstream retry attempts. |
| `news_upstream_request_duration_seconds` | `outcome=success|error|invalid_payload|canceled|timeout` | GNews provider request latency histogram. |
| `news_upstream_circuit_events_total` | `event=opened|short_circuit|half_open|closed` | Provider circuit breaker state transitions and short-circuited requests. |

Use cache hit rate, coalesced miss counts, and coordination events to understand quota protection across replicas, cancellation counts to spot client churn or upstream latency pressure, stale counts to see when provider trouble is being hidden by cached data, cache error and lease error metrics to detect Redis/backend trouble, upstream latency/error metrics to separate provider trouble from local API trouble, and circuit events to see when repeated provider failures are being shed locally.

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

The CI stack includes a health-gated Redis service, the normal smoke target, and two additional
API replicas with `RATE_LIMIT_MAX=1`. The smoke script sends the same `X-Forwarded-For` identity
to both replicas and requires the first request to return `200` and the second to return structured
`429 rate_limit_exceeded`, proving that the Redis-backed quota is shared across processes. The
normal target keeps rate limiting disabled so the endpoint/cache smoke can run its full request set.

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

The first `SIGTERM` / `SIGINT` marks the process as draining, so `/ready` returns `503` and an
orchestrator can remove the replica from service while `/health` remains `200`. The process then
closes the HTTP server and allows active requests to finish. The existing `SHUTDOWN_TIMEOUT_MS`
setting is the single deadline; its expiry aborts outbound provider work, force-closes remaining
HTTP connections, and exits with status `1`.

Signal handling is idempotent because container lifecycle hooks and signals can be repeated. Set a
Kubernetes `terminationGracePeriodSeconds` longer than `SHUTDOWN_TIMEOUT_MS`; a short `preStop`
delay is optional when the platform needs time to propagate readiness removal. Docker sends the
same `SIGTERM` path when `docker stop` is used with the exec-form image command.
