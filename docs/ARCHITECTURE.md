# Architecture

## Request flow

```mermaid
flowchart LR
  Client --> Express
  Express --> Routes
  Routes --> Controllers
  Controllers --> NewsService
  NewsService --> Cache
  NewsService --> GNews["GNews API"]
```

1. **Process** — `dotenv` loads first; **`otel-bootstrap`** starts OpenTelemetry when an OTLP endpoint (or `OTEL_TRACING_ENABLED=1`) is configured, before Express loads so HTTP is instrumented.
2. **Express** (`src/app.ts`) applies middleware in order: trust-proxy (optional), **Pino** request logging, **metrics** observer, **Helmet**, JSON body parser, **rate limiting** (skips `/health`, `/ready`, `/openapi.yaml`, `/metrics`), then mounts `/api` routes.
3. **Controllers** validate query parameters and map domain results to HTTP status codes.
4. **News service** builds cache keys from normalized search parameters (`query`, `count`, `lang`, `country`, `from`, `to`, `sortBy`), reads through `getCacheStore()` (in-memory or **Redis** when `REDIS_URL` is set), coalesces identical in-flight misses per process, and otherwise calls GNews `/api/v4/search` via `axios`. Cache backend errors are logged and metriced without failing the article request.
5. **Title** and **source** endpoints reuse the search call, then narrow results in memory (exact title match; case-insensitive source name match).

## Configuration

- `dotenv` loads `.env` when `src/server.ts` starts (not required for Vitest, which sets `NODE_ENV=test` and mocks HTTP).
- `requireApiKeyUnlessTest` exits the process on startup if `GNEWS_API_KEY` is missing outside test mode.

## Errors

Unhandled promise rejections in async route handlers are forwarded by `asyncHandler` to Express. `HttpError` instances become JSON `{ "error": "..." }` with the right status; other errors become `500` without leaking internals.

## Caching

Article arrays are stored per normalized search key with a **600-second** TTL (`src/cache/store.ts`). Without `REDIS_URL`, `node-cache` is used; with `REDIS_URL`, **ioredis** stores JSON payloads for shared caches across replicas.

The service treats the cache as a quota and latency optimization, not as a hard dependency. Read failures fall through to the upstream provider, write failures return the upstream response without caching it, and both paths emit warning logs plus cache error metrics. Within a single process, concurrent misses for the same normalized key are coalesced so only the first request calls the provider.

## Metrics

`src/metrics/register.ts` exports a single Prometheus registry used by `/metrics`. HTTP middleware records response counts, while `newsService` records cache hits/misses/errors/coalesced misses, upstream request outcomes, and upstream latency buckets.
