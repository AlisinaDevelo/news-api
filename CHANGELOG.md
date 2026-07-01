# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Optional search filters for `lang`, `country`, `from`, `to`, and `sortBy`, with validation and normalized cache keys.
- Prometheus metrics for article-search cache hit/miss behavior and upstream provider request latency/outcomes.
- Curl-based `npm run smoke` check for a running instance.
- Configurable `GNEWS_BASE_URL` for deterministic local integration tests and benchmarks.
- Deterministic `npm run benchmark:local` benchmark for cold upstream-backed searches and warm cache hits.
- Cache resilience for article searches: cache read/write failures are logged and metriced without failing requests.
- In-flight coalescing for identical cache misses so concurrent same-key searches share one upstream request per process.
- Redocly-powered `npm run contract` check for the OpenAPI document, wired into CI.
- Docker Compose smoke test against a fake GNews provider, wired into CI.
- Deployment guide for safe public demos on Render, Fly.io, and Railway.
- Docker healthcheck now honors the runtime `PORT` environment variable.
- Versioned `/api/v1/*` endpoints with `{ data, meta }` response envelopes, cache metadata, and structured error bodies.
- OpenAPI-backed response contract tests for the v1 success and structured error envelopes.
- Provider circuit breaker for repeated GNews failures, including Prometheus circuit event metrics and `503` short-circuit responses.
- OpenAPI-generated TypeScript client types, a small v1 `NewsApiClient` wrapper, and CI drift checks for generated client output.
- Root capability document that advertises v1 routes, legacy routes, docs, and observability endpoints.

### Changed

- Split GNews-specific provider mapping and payload validation into a provider adapter, leaving the news service focused on cache/search orchestration.

### Security

- Refreshed the dependency lockfile and upgraded OpenTelemetry packages; `npm audit --omit=dev` reports zero vulnerabilities.

## [1.2.0] — 2026-04-05

### Added

- **OpenTelemetry** tracing to OTLP (`src/tracing.ts`, `src/otel-bootstrap.ts`) with graceful shutdown
- **Codecov** upload from CI (optional `CODECOV_TOKEN`)
- Docker **Buildx** builds with **SBOM** and **provenance** in CI
- **Dependency review** workflow for pull requests
- **Supply chain** workflow with SPDX SBOM artifact (Anchore)
- **Provenance** workflow: build attestation for `package-lock.json` on `main` (best-effort)
- **Release** workflow: GitHub Release on `v*.*.*` tags
- Kubernetes **Redis** manifest, **`secret.example.yaml`**, optional `REDIS_URL` / `CLIENT_API_KEYS` env from Secret on Deployment
- **Dependabot** updates for Docker base images

### Changed

- Documentation for CI, GitHub branch checks, security (SBOM/attestations), operations (OTel env), and K8s deploy flow
- OpenAPI document version **1.2.0**

## [1.1.0] — 2026-04-05

### Added

- Dependabot for npm and GitHub Actions; CI **coverage** artifact on Node 22 (LCOV)
- **`GET /openapi.yaml`** for the live spec; OpenAPI file bundled in the Docker image
- Example **Kubernetes** manifests under `deploy/k8s/`; `.editorconfig`
- **CodeQL** workflow for `main`; pull request template; [GitHub settings guide](docs/GITHUB.md)
- Prometheus **`GET /metrics`** (default process metrics + `http_requests_total`)
- Optional **`CLIENT_API_KEYS`** enforcement via `X-API-Key` on `/api/*`
- Optional **Redis** cache when `REDIS_URL` is set (`ioredis`); graceful disconnect on shutdown
- Docker Compose **Redis** service and `REDIS_URL` for the API

### Changed

- Article cache moved to async `src/cache/store.ts` (memory or Redis); removed `src/utils/cache.ts`
- OpenAPI spec version **1.1.0** with `/metrics` and client key documentation

## [1.0.0] — 2026-04-05

### Added

- Express + TypeScript REST API for GNews search, title lookup, and source filtering
- In-memory response cache (TTL 600s)
- Input validation, structured errors, `/health` and `/ready`
- Helmet, rate limiting, optional trust-proxy for real client IPs
- Pino request logging with `x-request-id` support
- Upstream HTTP timeouts and payload validation; `502` for bad provider responses
- Graceful shutdown on `SIGTERM` / `SIGINT`
- Vitest + Supertest suite (GNews mocked)
- ESLint, GitHub Actions CI (Node 20/22), Docker image

### Changed

- Replaced misleading `/api/articles/author` with `/api/articles/source` aligned to GNews `source.name`
