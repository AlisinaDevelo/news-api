# news-api

Small **Express + TypeScript** service that searches news through the [GNews API](https://gnews.io/). Responses are cached in memory to cut duplicate upstream calls.

**Highlights:** input validation, consistent JSON errors, `/health` for uptime checks, Vitest + Supertest tests (GNews mocked in CI), ESLint, and a [GitHub Actions](.github/workflows/ci.yml) pipeline on Node 20 and 22. See [docs/CI.md](docs/CI.md) for how the workflow maps to local commands.

## Requirements

- **Node.js** 20 or newer ([`engines`](package.json))
- A **GNews API key** ([dashboard](https://gnews.io/dashboard))

## Quick start

```bash
git clone https://github.com/<your-username>/news-api.git
cd news-api
cp .env.example .env
# Edit .env: set GNEWS_API_KEY (and optional PORT)
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

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `GNEWS_API_KEY` | Yes (except in `NODE_ENV=test`) | Token from GNews. |
| `PORT` | No | HTTP port. Default `3000`. |

Never commit `.env`. Use `.env.example` as the template.

## API

Base path: `/api`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness: `{ "status": "ok", "uptime": number }`. |
| `GET` | `/api/articles` | Search articles. Query: `query` (required), `count` (optional, default 10, max 100). |
| `GET` | `/api/articles/title/:title` | First article whose title exactly matches the URL-decoded `:title`, else `404`. |
| `GET` | `/api/articles/source` | Articles whose `source.name` matches `source` (case-insensitive). Query: `source` (required), `count` optional. |

**Examples**

```http
GET /api/articles?query=technology&count=5
GET /api/articles/title/Example%20Headline
GET /api/articles/source?source=BBC&count=10
```

Error responses use `{ "error": "message" }` with `4xx`/`5xx` as appropriate.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Run `src/server.ts` via nodemon + ts-node. |
| `npm run build` | Compile TypeScript to `dist/`. |
| `npm start` | Run compiled `dist/server.js`. |
| `npm test` | Run Vitest once. |
| `npm run test:watch` | Vitest watch mode. |
| `npm run test:coverage` | Tests + V8 coverage report. |
| `npm run lint` | ESLint on `src/`, `test/`, `vitest.config.ts`. |

## Project layout

- `src/app.ts` — Express app, `/health`, error middleware.
- `src/server.ts` — Loads env, checks API key, listens for HTTP.
- `src/routes.ts` — Route table.
- `src/controllers/` — Request parsing and status codes.
- `src/services/newsService.ts` — GNews client + cache keys.
- `src/utils/cache.ts` — In-memory TTL cache (10 minutes).
- `test/` — Vitest specs; HTTP tests use Supertest with mocked `axios`.

For a diagram and error-handling notes, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
