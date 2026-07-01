# news-api

**Express + TypeScript** service that searches news through the [GNews API](https://gnews.io/). Searches support provider-backed filters for language, country, date range, and sort order. Identical normalized searches are cached (in-memory by default, or **Redis** when `REDIS_URL` is set) to protect quota and latency. The upstream base URL is injectable for deterministic local integration tests and benchmarks.

## How a request flows

A search runs through a small, explicit pipeline — each stage is a separate, testable unit:

1. **Validate** — query params are checked before any network call: `query` is required, `count` is clamped (≤100), `lang`/`country` must be ISO two-letter codes, `from`/`to` must parse as ISO 8601, and `sortBy` ∈ {`publishedAt`, `relevance`}. Bad input fails fast with `400` instead of wasting an upstream call or quota.
2. **Cache** — parameters are normalized into a deterministic key and read through a pluggable store (in-memory by default, Redis when `REDIS_URL` is set). Cache failures are logged/metriced but do not fail article requests; identical in-flight misses in the same process share one upstream call.
3. **Upstream** — on a miss, GNews is called with a hard timeout; transport/provider failures surface as `502` rather than a hung request.
4. **Observe** — each step emits structured Pino logs (carrying `x-request-id`), Prometheus counters (cache hit/miss, upstream outcome, latency histogram), and optional OpenTelemetry spans.
5. **Respond** — legacy endpoints return raw article arrays, while `/api/v1/*` returns `{ data, meta }` envelopes with request/cache metadata and structured error bodies.

Full diagram and component notes live in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Production-oriented features

- **Security:** [Helmet](https://helmetjs.github.io/) headers, configurable rate limiting, optional `TRUST_PROXY` for correct client IPs behind a load balancer, optional **`CLIENT_API_KEYS`** + `X-API-Key` on `/api/*`.
- **Reliability:** Upstream HTTP timeouts, response validation, `502` for provider/transport failures, graceful shutdown on `SIGTERM` / `SIGINT`.
- **Observability:** JSON logs via [Pino](https://getpino.io/), `x-request-id`, **`GET /metrics`** ([Prometheus](https://prometheus.io/) text format), cache hit/miss/error/coalescing + upstream latency metrics, and optional **OpenTelemetry** traces to OTLP (`OTEL_EXPORTER_OTLP_*`).
- **Kubernetes-style probes:** `GET /health` (liveness), `GET /ready` (readiness when the API key is configured).
- **Supply chain:** `npm audit` in CI; **SPDX SBOM** artifacts; Docker builds with **SBOM + provenance**; **dependency review** on PRs; optional **SLSA-style lockfile attestation** on `main`; lockfile-only installs.
- **Contract:** OpenAPI at **`GET /openapi.yaml`** (also on disk as [docs/openapi.yaml](docs/openapi.yaml)).
- **Container:** multi-stage [Dockerfile](Dockerfile) (non-root user, healthcheck).
- **Deploy:** Example [Kubernetes manifests](deploy/k8s/).

**Automation:** [CI](.github/workflows/ci.yml) (Node **20**/**22**), [CodeQL](.github/workflows/codeql.yml), [Codecov](https://codecov.io) upload, [dependency review](.github/workflows/dependency-review.yml), [SBOM](.github/workflows/supply-chain.yml), [provenance attest](.github/workflows/provenance.yml), [releases on tags](.github/workflows/release.yml), and [Dependabot](.github/dependabot.yml) (npm, Docker, Actions). Details: [docs/CI.md](docs/CI.md). Operations: [docs/OPERATIONS.md](docs/OPERATIONS.md). Security: [SECURITY.md](SECURITY.md).

Deployment guide: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) covers safe public-demo settings and Render/Fly/Railway Docker paths.

## Requirements

- **Node.js** 20 or newer ([`engines`](package.json)), or Docker 24+
- A **GNews API key** ([dashboard](https://gnews.io/dashboard))

## Quick start (Node)

```bash
git clone https://github.com/<your-username>/news-api.git
cd news-api
cp .env.example .env
# Set GNEWS_API_KEY (and optional PORT)
npm ci
npm run lint
npm test
npm run build
npm start
```

Development with reload:

```bash
npm run dev
```

Smoke-test a running instance:

```bash
BASE_URL=http://localhost:3000 QUERY=postgres npm run smoke
# If CLIENT_API_KEYS is configured on the server:
CLIENT_API_KEY=client-secret-one npm run smoke
```

Run the deterministic local benchmark:

```bash
npm run benchmark:local
```

## Quick start (Docker)

```bash
docker build -t news-api:local .
docker run --rm -p 3000:3000 -e GNEWS_API_KEY=your_key news-api:local
```

Or Compose (expects `GNEWS_API_KEY` in `.env`):

```bash
docker compose up --build
```

## Environment

Required and optional variables are listed in [`.env.example`](.env.example) and [docs/OPERATIONS.md](docs/OPERATIONS.md). Never commit `.env`.

## API

Base path: `/api`. Machine-readable schema: **`GET /openapi.yaml`** · source file [docs/openapi.yaml](docs/openapi.yaml).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness: `{ "status": "ok", "uptime": number }`. |
| `GET` | `/ready` | Readiness; `503` if `GNEWS_API_KEY` missing (non-test). |
| `GET` | `/openapi.yaml` | OpenAPI 3 document (`application/yaml`). |
| `GET` | `/metrics` | Prometheus metrics (skips rate limit), including HTTP totals, cache hit/miss/error/coalescing counts, and upstream latency. |
| `GET` | `/api/v1/articles` | Versioned search. Returns `{ data, meta }`, including normalized filters, cache status, and `requestId`. |
| `GET` | `/api/v1/articles/search` | Alias for versioned search. |
| `GET` | `/api/v1/articles/title/:title` | Exact title match with `{ data, meta }`, else structured `404`. |
| `GET` | `/api/v1/sources/:source/articles` | Source-name filter with `{ data, meta }`. |
| `GET` | `/api/articles` | Search. Query: `query` (required), `count` (optional, default 10, max 100), plus optional `lang`, `country`, `from`, `to`, `sortBy`. Optional header `X-API-Key` if `CLIENT_API_KEYS` is set. |
| `GET` | `/api/articles/title/:title` | Exact title match in the current search window, else `404`. |
| `GET` | `/api/articles/source` | Filter by `source.name` (case-insensitive). Query: `source` (required), `count` optional, plus optional `lang`, `country`, `from`, `to`, `sortBy`. |

**Examples**

```http
GET /api/v1/articles?query=technology&count=5
GET /api/v1/articles/search?query=postgres&lang=en&country=us&sortBy=relevance
GET /api/v1/sources/BBC/articles?count=10
GET /api/articles?query=technology&count=5
GET /api/articles?query=postgres&lang=en&country=us&sortBy=relevance
GET /api/articles?query=aws&from=2026-01-01T00:00:00Z&to=2026-01-31T23:59:59Z
GET /api/articles/title/Example%20Headline
GET /api/articles/source?source=BBC&count=10
```

Search filters are validated before the upstream request. `lang` and `country` are two-letter codes, `from` and `to` must parse as ISO 8601 dates, and `sortBy` accepts `publishedAt` or `relevance`.

Legacy errors: `{ "error": "message" }`. Versioned `/api/v1/*` errors: `{ "error": { "code": "...", "message": "...", "requestId": "..." } }`. Rate limit: `429` with standard rate-limit headers.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | `nodemon` + `ts-node` on `src/server.ts`. |
| `npm run build` | Compile to `dist/`. |
| `npm start` | Run `dist/server.js`. |
| `npm test` | Vitest once. |
| `npm run test:watch` | Vitest watch. |
| `npm run test:coverage` | Tests + coverage. |
| `npm run lint` | ESLint. |
| `npm run contract` | Validate `docs/openapi.yaml` with Redocly CLI. |
| `npm run smoke` | Curl-based smoke test against a running instance (`BASE_URL`, `QUERY`, `COUNT`, optional `CLIENT_API_KEY`). |
| `npm run smoke:docker` | Compose smoke test: boot the image against a fake GNews provider and run `npm run smoke`. |
| `npm run benchmark:local` | Builds the app, starts a fake GNews provider, and measures cold searches vs warm cache hits. See [docs/BENCHMARKS.md](docs/BENCHMARKS.md). |

## Project layout

- `src/app.ts` — Middleware stack, `/health`, `/ready`, `/api` mount.
- `src/server.ts` — Env, API key check, HTTP server, graceful shutdown.
- `src/tracing.ts` / `src/otel-bootstrap.ts` — Optional OpenTelemetry (before Express loads).
- `src/logger.ts` — Pino + request logging.
- `src/middleware/` — Security headers, rate limit, trust proxy, metrics observer, optional client API key, errors.
- `src/http/responses.ts` — Versioned response envelope helpers.
- `src/cache/store.ts` — Pluggable cache: memory or Redis.
- `src/metrics/register.ts` — Prometheus registry: HTTP, cache, and upstream provider metrics.
- `src/providers/gnewsProvider.ts` — GNews adapter: provider params, payload validation, timeouts, upstream instrumentation.
- `src/services/newsService.ts` — Article search orchestration: normalized cache keys, cache resilience/coalescing, title/source narrowing.
- `test/` — Vitest; HTTP tests mock `axios` (no live GNews in CI), including OpenAPI-backed response contract checks.

Architecture diagram: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Release notes: [CHANGELOG.md](CHANGELOG.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
