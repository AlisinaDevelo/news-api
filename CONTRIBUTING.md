# Contributing

## Setup

```bash
npm ci
cp .env.example .env
```

Add a valid `GNEWS_API_KEY` in `.env` when exercising the real API locally. Automated tests do not call GNews.

## Before you open a PR

```bash
npm audit --audit-level=high
npm run lint
npm test
npm run build
docker build .
```

This matches what [CI](docs/CI.md) runs on Node 20 and 22 (plus Docker, SBOM, and related workflows). For private repos, add **`CODECOV_TOKEN`** in GitHub if you want Codecov uploads.

To exercise **OpenTelemetry** locally, run a collector (for example Jaeger OTLP on port 4318) and set `OTEL_EXPORTER_OTLP_ENDPOINT` or `OTEL_TRACING_ENABLED=1` before `npm start`.

## Commits

Keep commits focused. Short, imperative subject lines work well (for example: `fix count validation`, `add eslint`).

## Tests

- **Unit:** `test/validation.test.ts`, `test/cache.test.ts`.
- **HTTP:** `test/app.test.ts` uses Supertest; `axios` is mocked so CI stays deterministic and keyless.

When you change routes or validation, extend or add tests in the same change when possible.

## Repository hygiene (GitHub UI)

See [docs/GITHUB.md](docs/GITHUB.md) for suggested branch protection, secrets, and release practices.
