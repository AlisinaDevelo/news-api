# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Dependabot for npm and GitHub Actions
- CI coverage run (Node 22) with LCOV artifact upload
- `GET /openapi.yaml` for live OpenAPI document
- OpenAPI file bundled in Docker image
- Example Kubernetes Deployment and Service under `deploy/k8s/`
- `.editorconfig` for consistent formatting

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
