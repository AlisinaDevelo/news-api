# Continuous integration

## What runs on every push and pull request

### Node matrix (`test` job)

The [workflow](../.github/workflows/ci.yml) runs on `ubuntu-latest` with **Node.js 20 and 22**:

1. **`npm ci`** — reproducible install from `package-lock.json`.
2. **`npm run workflow:check`** — **Node 20 only**; rejects mutable, abbreviated, or non-upstream-pinned GitHub Action references.
3. **`npm run container:check`** — **Node 20 only**; rejects tag-only Dockerfile and Compose image references.
4. **`npm run workflow:bounds`** — **Node 20 only**; requires bounded job timeouts and scoped cancellation policies.
5. **`npm audit --audit-level=high`** — fails the job if high or critical advisories remain.
6. **`npm run lint`** — [ESLint](https://eslint.org/) on `src/`, `test/`, and `vitest.config.ts`.
7. **`npm run contract`** — [Redocly CLI](https://redocly.com/docs/cli) validates `docs/openapi.yaml` so the published API contract stays parseable and policy-compliant.
8. **`npm run client:check`** — regenerates OpenAPI TypeScript client types and fails if checked-in generated output is stale.
9. **`npm test`** — [Vitest](https://vitest.dev/). GNews is **not** called: tests mock `axios`; no API key in GitHub Actions. Response contract tests compile selected `docs/openapi.yaml` schemas and validate real HTTP responses.
10. **`npm run test:coverage`** — **Node 22 only**; enforces global minimums of **80% statements, 80% lines, 80% functions, and 75% branches**, then uploads the `coverage/` directory (including `lcov.info`) as a workflow artifact named `coverage-lcov`.
11. **[Codecov](https://codecov.io)** — **Node 22 only**; uploads `coverage/lcov.info`. For private repos set repository secret `CODECOV_TOKEN`. `fail_ci_if_error` is off so missing token does not break the build.
12. **`npm run build`** — TypeScript compile to `dist/`.

### Container (`docker` job)

13. **`npm run smoke:docker`** — Compose boots Redis, the production image, a slow GNews-compatible fake provider, and two rate-limited API replicas. It proves shared quotas and cross-replica cold-miss coordination, runs the authenticated HTTP smoke including ETag reuse and a bodyless `304`, then stops Redis to verify strict replicas become unready while liveness and the cache-only replica remain healthy. Redis restart must restore readiness without restarting the APIs.
14. **Buildx build** — [Dockerfile](../Dockerfile) with **`provenance: mode=max`** and **SBOM** (no registry push). Validates supply-chain metadata generation in CI.

### Pull requests only

15. **[Dependency review](../.github/workflows/dependency-review.yml)** — flags vulnerable or blocked dependencies introduced by the PR.

### Every push / PR (supply chain)

16. **[SBOM](../.github/workflows/supply-chain.yml)** — [Anchore SBOM Action](https://github.com/anchore/sbom-action) produces SPDX JSON and uploads it as a workflow artifact.

### `main` branch pushes only

17. **[Provenance](../.github/workflows/provenance.yml)** — [build provenance attestation](https://github.com/actions/attest-build-provenance) for `package-lock.json`; the `main` workflow fails if the attestation cannot be produced.

### Code scanning (`CodeQL` workflow)

On pushes and PRs to `main`, plus a weekly schedule, [codeql.yml](../.github/workflows/codeql.yml) runs JavaScript analysis and uploads SARIF to the **Security** tab.

### Releases

When you push an annotated tag matching `v*.*.*`, [release.yml](../.github/workflows/release.yml) creates a **GitHub Release** with auto-generated notes.

### Dependency updates

[Dependabot](../.github/dependabot.yml) opens weekly PRs for npm, Docker base images, and GitHub Actions.

### Workflow action supply chain

Every external action in `.github/workflows/` is pinned to a full 40-character commit SHA. Each
pin keeps a nearby release comment such as `# v5` so reviewers and Dependabot can identify the
intended upstream version. `npm run workflow:check` parses every workflow locally without network
access and rejects tags, branches, abbreviated SHAs, or other mutable references; the Node 20 CI
job runs the same guard. When updating an action, resolve the new release tag in the upstream
repository, verify the full SHA, update the release comment, and run the guard before pushing.

### Container image supply chain

Every external Dockerfile `# syntax=`, `FROM`, and Compose `image:` reference keeps its
human-readable tag and a full manifest digest, for example `node:22-alpine@sha256:...`. Tags are
useful maintenance context; the digest is the reproducible input used by Docker.
`npm run container:check` checks the tracked Dockerfile and Compose files without network access
and runs in the Node 20 CI job. When Dependabot opens a Docker update, review the tag and digest
together, run the full Docker build and Compose smoke, and treat the digest change as a normal
dependency change.

This follows Docker's [Dockerfile `FROM` reference](https://docs.docker.com/reference/dockerfile/),
[digest guidance](https://docs.docker.com/reference/cli/docker/image/pull/), and
[Compose trust model](https://docs.docker.com/compose/trust-model/).

### Workflow runtime and concurrency

Every workflow job has an explicit timeout below GitHub's 360-minute default. CI, dependency
review, supply-chain, and provenance use a workflow-scoped `${{ github.workflow }}-${{ github.ref }}`
group and cancel older runs for the same branch or pull request. CodeQL uses the same group but
does not cancel scheduled runs; release jobs have a timeout but no cancellation group because each
tag is an independent artifact. `npm run workflow:bounds` checks these rules without network access
and runs in the Node 20 CI job.

## Local parity

```bash
npm ci
npm run workflow:check
npm run workflow:bounds
npm run container:check
npm audit --audit-level=high
npm run lint
npm run contract
npm run client:check
npm test
npm run test:coverage
npm run build
docker build .
npm run smoke:docker
```

Optional (matches the CI Docker job more closely, requires Buildx):

```bash
docker buildx build . --tag news-api:local --provenance=mode=max --sbom=true --load
```

Coverage (matches the Node 22 CI step and enforces the repository floor):

```bash
npm run test:coverage
```

Download the **`coverage-lcov`** artifact from a workflow run to inspect HTML/LCOV reports without running tests locally.

## Secrets and deployment

- **CI** does not need `GNEWS_API_KEY`.
- Optional **`CODECOV_TOKEN`** for private repository uploads.
- Store registry or cloud credentials in GitHub **Secrets** / **Environments**, not in workflow YAML.

## Troubleshooting

| Symptom | Likely cause |
|--------|----------------|
| `npm ci` fails after lockfile change | Run `npm install` locally and commit the updated `package-lock.json`. |
| `npm audit` fails in CI | Run `npm audit` locally; upgrade or patch dependencies, then commit the lockfile. |
| Workflow action pin check fails | Replace the tag or abbreviated SHA with a verified full upstream commit SHA and keep the release comment current. |
| Workflow runtime guard fails | Add a positive timeout within the repository maximum and use the correct scoped cancellation policy; keep release jobs uncanceled. |
| Container image pin check fails | Replace a tag-only Dockerfile or Compose image with the reviewed tag-plus-digest reference; run `npm run container:check`. |
| Tests pass locally but fail in CI | Align Node version with the matrix; avoid relying on local-only env vars. |
| Docker job fails | Ensure the Dockerfile paths and `npm run build` still succeed after changes. |
| Codecov shows no data | Add `CODECOV_TOKEN` for private repos or confirm the repository is linked on codecov.io. |
