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

This matches what [CI](docs/CI.md) runs on Node 20 and 22 (plus the Docker job).

## Commits

Keep commits focused. Short, imperative subject lines work well (for example: `fix count validation`, `add eslint`).

## Tests

- **Unit:** `test/validation.test.ts`, `test/cache.test.ts`.
- **HTTP:** `test/app.test.ts` uses Supertest; `axios` is mocked so CI stays deterministic and keyless.

When you change routes or validation, extend or add tests in the same change when possible.
