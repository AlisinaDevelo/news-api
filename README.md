# news-api

**Express + TypeScript** service that searches news through the [GNews API](https://gnews.io/). Identical searches are served from an in-memory TTL cache to protect your quota and latency.

## Production-oriented features

- **Security:** [Helmet](https://helmetjs.github.io/) headers, configurable rate limiting, optional `TRUST_PROXY` for correct client IPs behind a load balancer.
- **Reliability:** Upstream HTTP timeouts, response validation, `502` for provider/transport failures, graceful shutdown on `SIGTERM` / `SIGINT`.
- **Observability:** JSON logs via [Pino](https://getpino.io/), `x-request-id` on every response.
- **Kubernetes-style probes:** `GET /health` (liveness), `GET /ready` (readiness when the API key is configured).
- **Supply chain:** `npm audit` in CI; lockfile-only installs.
- **Contract:** OpenAPI at **`GET /openapi.yaml`** (also on disk as [docs/openapi.yaml](docs/openapi.yaml)).
- **Container:** multi-stage [Dockerfile](Dockerfile) (non-root user, healthcheck).
- **Deploy:** Example [Kubernetes manifests](deploy/k8s/).

**Automation:** [GitHub Actions](.github/workflows/ci.yml) on Node **20** and **22** — audit, lint, test, **coverage artifact** (Node 22), build, and Docker image build. [Dependabot](.github/dependabot.yml) for npm and Actions. Details: [docs/CI.md](docs/CI.md). Operations: [docs/OPERATIONS.md](docs/OPERATIONS.md). Security: [SECURITY.md](SECURITY.md).

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
| `GET` | `/api/articles` | Search. Query: `query` (required), `count` (optional, default 10, max 100). |
| `GET` | `/api/articles/title/:title` | Exact title match in the current search window, else `404`. |
| `GET` | `/api/articles/source` | Filter by `source.name` (case-insensitive). Query: `source` (required), `count` optional. |

**Examples**

```http
GET /api/articles?query=technology&count=5
GET /api/articles/title/Example%20Headline
GET /api/articles/source?source=BBC&count=10
```

Errors: `{ "error": "message" }`. Rate limit: `429` with standard rate-limit headers.

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

## Project layout

- `src/app.ts` — Middleware stack, `/health`, `/ready`, `/api` mount.
- `src/server.ts` — Env, API key check, HTTP server, graceful shutdown.
- `src/logger.ts` — Pino + request logging.
- `src/middleware/` — Security headers, rate limit, trust proxy, errors.
- `src/services/newsService.ts` — GNews client, cache, timeouts.
- `test/` — Vitest; HTTP tests mock `axios` (no live GNews in CI).

Architecture diagram: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Release notes: [CHANGELOG.md](CHANGELOG.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
