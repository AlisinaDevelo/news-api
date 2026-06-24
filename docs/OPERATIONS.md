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
| `SHUTDOWN_TIMEOUT_MS` | `10000` | Force-exit if `server.close` does not finish. |
| `RATE_LIMIT_MAX` | `120` | Max requests per IP per window. |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window. |
| `DISABLE_RATE_LIMIT` | `0` | Set to `1` to disable limiting (emergency only). |
| `TRUST_PROXY` | `0` | Set to `1` behind a reverse proxy so rate limits use `X-Forwarded-For`. |
| `REDIS_URL` | — | If set (e.g. `redis://localhost:6379`), article search results are cached in Redis with the same TTL as in-memory mode. Omit to use the in-process cache only. |
| `CLIENT_API_KEYS` | — | Comma-separated secrets. When set, every `/api/*` request must send header `X-API-Key` matching one value. Omit to allow unauthenticated API access (still use network controls in production). |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | Base OTLP URL (e.g. `http://jaeger:4318`). Traces POST to `/v1/traces`. Enables tracing when set. |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | — | Full traces URL; overrides the base + `/v1/traces` combination. |
| `OTEL_SERVICE_NAME` | `news-api` | `service.name` resource attribute. |
| `OTEL_TRACING_ENABLED` | `0` | Set to `1` to export traces to default `http://127.0.0.1:4318/v1/traces` when no OTLP endpoint env is set (local dev). |

## Probes

- **Liveness:** `GET /health` — process is up.
- **Readiness:** `GET /ready` — `200` when `GNEWS_API_KEY` is set (non-test); `503` if not.

## API contract

- **`GET /openapi.yaml`** — served from `docs/openapi.yaml` relative to the process working directory. The production image sets `WORKDIR /app` and includes that file under `docs/openapi.yaml`.

## Scaling and cache

- **No `REDIS_URL`:** in-process cache (`node-cache`, 600s TTL). Each replica has its own entries.
- **`REDIS_URL` set:** responses are cached in **Redis** with the same TTL so multiple instances can share entries.
- Cache keys include normalized search parameters: query, count, `lang`, `country`, `from`, `to`, and `sortBy`.
- Cache reads/writes are non-fatal for article searches. If the cache backend is unavailable, the service logs a warning, increments cache error metrics, falls through to GNews on read failure, and still returns the upstream response on write failure.
- Identical in-flight misses are coalesced per process, so concurrent requests for the same normalized search wait on one upstream provider request.

On shutdown the server closes the Redis connection when that backend was used.

## Metrics

`GET /metrics` exposes default Node.js process metrics plus application metrics:

| Metric | Labels | Purpose |
|--------|--------|---------|
| `http_requests_total` | `method`, `status_code` | HTTP response count. |
| `news_cache_events_total` | `result=hit|miss|error|coalesced` | Cache lookup and in-flight coalescing behavior for article searches. |
| `news_cache_errors_total` | `operation=get|set` | Cache backend errors that were tolerated by falling through to upstream or returning an uncached upstream response. |
| `news_upstream_requests_total` | `outcome=success|error|invalid_payload` | GNews provider request outcomes. |
| `news_upstream_request_duration_seconds` | `outcome=success|error|invalid_payload` | GNews provider request latency histogram. |

Use cache hit rate and coalesced miss counts to understand quota protection, cache error metrics to detect Redis/backend trouble, and upstream latency/error metrics to separate provider trouble from local API trouble.

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

The smoke test checks `/health`, `/ready`, `/openapi.yaml`, `/api/articles`, and `/metrics`.

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
