# Continuous integration

## What runs on every push and pull request

The [CI workflow](../.github/workflows/ci.yml) runs on `ubuntu-latest` against **Node.js 20 and 22**:

1. **`npm ci`** — clean install from `package-lock.json` (stricter than `npm install` for reproducible builds).
2. **`npm test`** — [Vitest](https://vitest.dev/) unit and HTTP tests. The GNews API is **not** called in CI: tests mock `axios`, so no API key is required in GitHub Actions.
3. **`npm run build`** — TypeScript compile to `dist/`.

## Local parity

From the repository root:

```bash
npm ci
npm test
npm run build
```

Optional coverage:

```bash
npm run test:coverage
```

## Secrets and deployment

- **CI** does not need `GNEWS_API_KEY`. Only local runs and production need a real key in `.env` (see `.env.example`).
- If you add deployment (e.g. container registry, PaaS), store tokens in GitHub **Environments** or **Secrets**, not in the workflow file.

## Troubleshooting

| Symptom | Likely cause |
|--------|----------------|
| `npm ci` fails after lockfile change | Run `npm install` locally and commit the updated `package-lock.json`. |
| Tests pass locally but fail in CI | Check Node version (`engines` in `package.json`); align with the matrix. |
| Build fails on types | Run `npm run build` locally before pushing. |
