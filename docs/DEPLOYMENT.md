# Deployment

This service is safe to deploy as a small read-only portfolio demo, but it still spends GNews quota. For public links, prefer a low rate limit plus `CLIENT_API_KEYS` for `/api/*`; leave `/health`, `/ready`, `/openapi.yaml`, and `/metrics` available for inspection.

## Production environment

Set these variables on the hosting platform:

| Variable | Suggested value | Notes |
|----------|-----------------|-------|
| `GNEWS_API_KEY` | platform secret | Required outside tests. |
| `NODE_ENV` | `production` | Enables production behavior. |
| `PORT` | platform-provided or `3000` | The app and Docker healthcheck both read this. |
| `TRUST_PROXY` | `1` | Use behind managed load balancers/proxies. |
| `RATE_LIMIT_MAX` | `60` | Keep demo quota burn low. |
| `RATE_LIMIT_WINDOW_MS` | `60000` | One-minute demo window. |
| `CLIENT_API_KEYS` | generated secret | Recommended for a public demo; protects `/api/*`. |
| `REDIS_URL` | managed Redis URL | Optional. Use it if the platform makes Redis cheap/easy. |
| `CACHE_REDIS_COMMAND_TIMEOUT_MS` | `500` | Article-cache Redis reply budget; values above `1000` ms are clamped. Cache failures remain fail-open. |
| `CACHE_REDIS_CONNECT_TIMEOUT_MS` | `1000` | Article-cache Redis connection budget; values above `5000` ms are clamped. |
| `RATE_LIMIT_REDIS_COMMAND_TIMEOUT_MS` | `500` | Shared rate-limit Redis reply budget; values above `1000` ms are clamped. Store failures return structured `503`. |
| `RATE_LIMIT_REDIS_CONNECT_TIMEOUT_MS` | `1000` | Shared rate-limit Redis connection budget; values above `5000` ms are clamped. |
| `SERVER_REQUEST_TIMEOUT_MS` | `75000` | Complete incoming request budget; keep above `UPSTREAM_TOTAL_TIMEOUT_MS`. Values above `120000` ms are clamped. |
| `SERVER_HEADERS_TIMEOUT_MS` | `10000` | Slow-header protection; values above `60000` ms and above the request budget are clamped. |
| `SERVER_KEEP_ALIVE_TIMEOUT_MS` | `5000` | Idle keep-alive socket budget. Values above `120000` ms are clamped. |
| `SERVER_MAX_REQUESTS_PER_SOCKET` | `1000` | Maximum requests per connection; set `0` only when a trusted proxy owns connection reuse. |
| `CACHE_LEASE_TTL_MS` | `5000` | Short cross-replica cache-miss lease; only active with managed Redis. |
| `CACHE_LEASE_HEARTBEAT_MS` | half of lease TTL | Owner-checked renewal interval for slow provider work. |
| `CACHE_LEASE_WAIT_MS` | `750` | Bounded wait for another replica to populate the shared cache. |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | Graceful drain deadline; give the platform a longer termination grace period. |
| `UPSTREAM_TOTAL_TIMEOUT_MS` | `60000` | Total provider budget across retries; keep it below the platform request timeout. |

Do not set `GNEWS_BASE_URL` in production unless you intentionally point at a compatible mock/provider. It exists for deterministic local tests, benchmarks, and CI smoke tests.

## Render

1. Create a Web Service from the GitHub repository and choose Docker deployment. Render supports Dockerfile-based services and passes configured environment variables to the running service.
2. Set the environment variables above. Use Render secrets for `GNEWS_API_KEY` and `CLIENT_API_KEYS`.
3. Set the health check path to `/ready`.
4. Deploy, then smoke test:

```bash
BASE_URL=https://your-render-service.onrender.com QUERY=postgres CLIENT_API_KEY=your-demo-key npm run smoke
```

References: [Render Docker](https://render.com/docs/docker), [Render health checks](https://render.com/docs/health-checks).

## Fly.io

1. Run `fly launch` from the repository and let Fly detect the Dockerfile.
2. Check the generated `fly.toml`; the internal service port should match `PORT` (use `3000` unless you change it).
3. Set secrets:

```bash
fly secrets set GNEWS_API_KEY=... CLIENT_API_KEYS=...
```

4. Deploy:

```bash
fly deploy
```

References: [Fly Dockerfile deploys](https://fly.io/docs/languages-and-frameworks/dockerfile/), [Fly app configuration](https://fly.io/docs/reference/configuration/), [fly deploy](https://fly.io/docs/flyctl/deploy/).

## Railway

1. Create a service from the GitHub repository. Railway can build from a Dockerfile.
2. Add the production variables in the Railway Variables UI. If Railway does not inject a `PORT` for the service, set `PORT=3000`.
3. Deploy, open the generated domain, and smoke test:

```bash
BASE_URL=https://your-railway-domain.up.railway.app QUERY=postgres CLIENT_API_KEY=your-demo-key npm run smoke
```

References: [Railway Dockerfiles](https://docs.railway.com/builds/dockerfiles), [Railway variables](https://docs.railway.com/variables).

## Demo posture

For a recruiter-facing public demo, the best default is:

- Public: `/health`, `/ready`, `/openapi.yaml`, `/metrics`.
- Protected with `CLIENT_API_KEYS`: `/api/articles`, `/api/articles/title/:title`, `/api/articles/source`.
- Rate limited: `RATE_LIMIT_MAX=60` or lower until you know traffic is tiny.
- Logs: `LOG_LEVEL=info`, with no API keys in logs or URLs.

That gives people something real to inspect without turning your GNews quota into a public vending machine.

## Container shutdown

Use the platform's normal stop signal so the container receives `SIGTERM`. The service marks
readiness as draining, lets active HTTP requests finish, and aborts outbound provider work only
when `SHUTDOWN_TIMEOUT_MS` expires. Configure the platform's termination grace period longer than
that deadline; the image declares `STOPSIGNAL SIGTERM` explicitly.

Keep the platform or reverse-proxy request timeout above `SERVER_REQUEST_TIMEOUT_MS` and
`UPSTREAM_TOTAL_TIMEOUT_MS` so the application can return its normal structured errors. Proxy
header and keep-alive limits may be stricter, but should be intentional and documented alongside
the application settings.
