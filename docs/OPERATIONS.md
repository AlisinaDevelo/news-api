# Operations

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `GNEWS_API_KEY` | — | Required at runtime (except `NODE_ENV=test`). |
| `PORT` | `3000` | HTTP listen port. |
| `NODE_ENV` | — | Use `production` in deployed environments. |
| `LOG_LEVEL` | `info` (non-test) | Pino level (`trace`–`fatal`, or `silent`). |
| `HTTP_TIMEOUT_MS` | `15000` | Outbound GNews request timeout (max `60000`). |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | Force-exit if `server.close` does not finish. |
| `RATE_LIMIT_MAX` | `120` | Max requests per IP per window. |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window. |
| `DISABLE_RATE_LIMIT` | `0` | Set to `1` to disable limiting (emergency only). |
| `TRUST_PROXY` | `0` | Set to `1` behind a reverse proxy so rate limits use `X-Forwarded-For`. |
| `REDIS_URL` | — | If set (e.g. `redis://localhost:6379`), article search results are cached in Redis with the same TTL as in-memory mode. Omit to use the in-process cache only. |
| `CLIENT_API_KEYS` | — | Comma-separated secrets. When set, every `/api/*` request must send header `X-API-Key` matching one value. Omit to allow unauthenticated API access (still use network controls in production). |

## Probes

- **Liveness:** `GET /health` — process is up.
- **Readiness:** `GET /ready` — `200` when `GNEWS_API_KEY` is set (non-test); `503` if not.

## API contract

- **`GET /openapi.yaml`** — served from `docs/openapi.yaml` relative to the process working directory. The production image sets `WORKDIR /app` and includes that file under `docs/openapi.yaml`.

## Scaling and cache

- **No `REDIS_URL`:** in-process cache (`node-cache`, 600s TTL). Each replica has its own entries.
- **`REDIS_URL` set:** responses are cached in **Redis** with the same TTL so multiple instances can share entries.

On shutdown the server closes the Redis connection when that backend was used.

## Docker

```bash
docker build -t news-api:local .
docker run --rm -p 3000:3000 -e GNEWS_API_KEY=your_key news-api:local
```

Or with Compose (requires `GNEWS_API_KEY` in `.env`):

```bash
docker compose up --build
```

## Logs

Logs are **JSON** (Pino). Each response includes an `x-request-id` header for correlation.

## Graceful shutdown

The process closes the HTTP server on `SIGTERM` / `SIGINT` before exit. Orchestrators should use termination grace periods longer than `SHUTDOWN_TIMEOUT_MS`.
