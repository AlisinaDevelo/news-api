# Security policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 1.x     | Yes       |

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security reports.

Instead, email the maintainer with:

- A short description of the issue and its impact
- Steps to reproduce (or a proof of concept) if possible
- Affected versions or deployment context (e.g. Docker, Node version)

We aim to acknowledge reports within a few business days.

## Hardening notes

- Run behind a reverse proxy with TLS termination in production.
- Set `TRUST_PROXY=1` only when the proxy strips or sanitizes `X-Forwarded-For`.
- Keep `GNEWS_API_KEY` in a secret store; never commit `.env`.
- If you use `CLIENT_API_KEYS`, generate random, equal-length ASCII values and keep them in a secret manager rather than plain Deployment env. During verification, the service hashes the supplied key and every configured key to fixed-length SHA-256 digests, then compares every rotation slot with `crypto.timingSafeEqual`; the environment values remain bearer secrets, not stored password hashes.
- Rotate client keys with an overlap: deploy `old-key,new-key`, move clients to the new key, then deploy only `new-key`. Values are comma-delimited and surrounding whitespace is trimmed, so generated keys must not contain commas or intentional leading/trailing spaces.
- Access logs use an allowlist and do not persist API keys, cookies, query strings, request bodies, or remote addresses. Invalid `X-Request-Id` values are replaced with generated IDs.
- JSON request bodies are strictly parsed under the `SERVER_MAX_JSON_BODY_BYTES` limit (32768 bytes by default, 262144 maximum) only after the `/api` rate-limit and API-key gates. Compressed request bodies are rejected before inflation. Body-parser failures use fixed public messages and are logged only as bounded parser types/statuses; raw failed bodies and parser messages are not persisted.
- Tune `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`, and `HTTP_TIMEOUT_MS` for your traffic profile.
- Review [docs/OPERATIONS.md](docs/OPERATIONS.md) for runtime configuration.

## Dependency audits

CI runs `npm audit` on every push. Run `npm audit` locally before releases.

## SBOM and attestations

- Workflow artifacts include an **SPDX** JSON SBOM from [Anchore SBOM Action](https://github.com/anchore/sbom-action).
- The **Provenance** workflow creates a GitHub **build attestation** for `package-lock.json`; the `main` workflow fails if the attestation cannot be produced.
- Every external GitHub Action is pinned to a verified full commit SHA, with the intended release tag retained in a comment. `npm run workflow:check` rejects mutable action references locally and in CI.
- **Codecov** uploads require optional secret `CODECOV_TOKEN` on private repositories.
