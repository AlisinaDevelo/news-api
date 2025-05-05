# Continuous integration

## What runs on every push and pull request

### Node matrix (`test` job)

The [workflow](../.github/workflows/ci.yml) runs on `ubuntu-latest` with **Node.js 20 and 22**:

1. **`npm ci`** — reproducible install from `package-lock.json`.
2. **`npm audit --audit-level=high`** — fails the job if high or critical advisories remain.
3. **`npm run lint`** — [ESLint](https://eslint.org/) on `src/`, `test/`, and `vitest.config.ts`.
4. **`npm test`** — [Vitest](https://vitest.dev/). GNews is **not** called: tests mock `axios`; no API key in GitHub Actions.
5. **`npm run test:coverage`** — **Node 22 only**; uploads the `coverage/` directory (including `lcov.info`) as a workflow artifact named `coverage-lcov`.
6. **`npm run build`** — TypeScript compile to `dist/`.

### Container (`docker` job)

7. **`docker build .`** — Verifies the [Dockerfile](../Dockerfile) builds successfully (image is not pushed).

### Code scanning (`CodeQL` workflow)

On pushes and PRs to `main`, plus a weekly schedule, [codeql.yml](../.github/workflows/codeql.yml) runs JavaScript analysis and uploads SARIF to the **Security** tab.

### Dependency updates

[Dependabot](../.github/dependabot.yml) opens weekly PRs for npm and GitHub Actions.

## Local parity

```bash
npm ci
npm audit --audit-level=high
npm run lint
npm test
npm run build
docker build .
```

Coverage (matches the Node 22 CI step):

```bash
npm run test:coverage
```

Download the **`coverage-lcov`** artifact from a workflow run to inspect HTML/LCOV reports without running tests locally.

## Secrets and deployment

- **CI** does not need `GNEWS_API_KEY`.
- Store registry or cloud credentials in GitHub **Secrets** / **Environments**, not in workflow YAML.

## Troubleshooting

| Symptom | Likely cause |
|--------|----------------|
| `npm ci` fails after lockfile change | Run `npm install` locally and commit the updated `package-lock.json`. |
| `npm audit` fails in CI | Run `npm audit` locally; upgrade or patch dependencies, then commit the lockfile. |
| Tests pass locally but fail in CI | Align Node version with the matrix; avoid relying on local-only env vars. |
| Docker job fails | Ensure the Dockerfile paths and `npm run build` still succeed after changes. |
