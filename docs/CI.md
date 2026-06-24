# Continuous integration

## What runs on every push and pull request

### Node matrix (`test` job)

The [workflow](../.github/workflows/ci.yml) runs on `ubuntu-latest` with **Node.js 20 and 22**:

1. **`npm ci`** — reproducible install from `package-lock.json`.
2. **`npm audit --audit-level=high`** — fails the job if high or critical advisories remain.
3. **`npm run lint`** — [ESLint](https://eslint.org/) on `src/`, `test/`, and `vitest.config.ts`.
4. **`npm run contract`** — [Redocly CLI](https://redocly.com/docs/cli) validates `docs/openapi.yaml` so the published API contract stays parseable and policy-compliant.
5. **`npm test`** — [Vitest](https://vitest.dev/). GNews is **not** called: tests mock `axios`; no API key in GitHub Actions.
6. **`npm run test:coverage`** — **Node 22 only**; uploads the `coverage/` directory (including `lcov.info`) as a workflow artifact named `coverage-lcov`.
7. **[Codecov](https://codecov.io)** — **Node 22 only**; uploads `coverage/lcov.info`. For private repos set repository secret `CODECOV_TOKEN`. `fail_ci_if_error` is off so missing token does not break the build.
8. **`npm run build`** — TypeScript compile to `dist/`.

### Container (`docker` job)

9. **Buildx build** — [Dockerfile](../Dockerfile) with **`provenance: mode=max`** and **SBOM** (no registry push). Validates supply-chain metadata generation in CI.

### Pull requests only

10. **[Dependency review](../.github/workflows/dependency-review.yml)** — flags vulnerable or blocked dependencies introduced by the PR.

### Every push / PR (supply chain)

11. **[SBOM](../.github/workflows/supply-chain.yml)** — [Anchore SBOM Action](https://github.com/anchore/sbom-action) produces SPDX JSON and uploads it as a workflow artifact.

### `main` branch pushes only

12. **[Provenance](../.github/workflows/provenance.yml)** — [build provenance attestation](https://github.com/actions/attest-build-provenance) for `package-lock.json` (best-effort; `continue-on-error` if attestations are unavailable on the plan).

### Code scanning (`CodeQL` workflow)

On pushes and PRs to `main`, plus a weekly schedule, [codeql.yml](../.github/workflows/codeql.yml) runs JavaScript analysis and uploads SARIF to the **Security** tab.

### Releases

When you push an annotated tag matching `v*.*.*`, [release.yml](../.github/workflows/release.yml) creates a **GitHub Release** with auto-generated notes.

### Dependency updates

[Dependabot](../.github/dependabot.yml) opens weekly PRs for npm, Docker base images, and GitHub Actions.

## Local parity

```bash
npm ci
npm audit --audit-level=high
npm run lint
npm run contract
npm test
npm run build
docker build .
```

Optional (matches the CI Docker job more closely, requires Buildx):

```bash
docker buildx build . --tag news-api:local --provenance=mode=max --sbom=true --load
```

Coverage (matches the Node 22 CI step):

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
| Tests pass locally but fail in CI | Align Node version with the matrix; avoid relying on local-only env vars. |
| Docker job fails | Ensure the Dockerfile paths and `npm run build` still succeed after changes. |
| Codecov shows no data | Add `CODECOV_TOKEN` for private repos or confirm the repository is linked on codecov.io. |
