# GitHub repository settings

These settings are applied in the GitHub UI (not in git). They mirror common enterprise defaults.

## Branch protection (`main`)

Suggested rules:

- Require a pull request before merging (at least one review for teams; solo maintainers may use zero).
- Require status checks to pass before merging (exact names depend on GitHub’s UI):
  - `test` matrix jobs for Node 20 and 22, `docker`, `CodeQL`, `sbom`, `dependency-review` (PRs), `attest-lockfile` (`main`), and any other workflows you enable.
- The Node 22 `test` job enforces the global coverage floor through `npm run test:coverage`; keep that check required with the rest of the matrix.
- The `attest-lockfile` check is fail-closed on `main`; an unavailable or failed lockfile attestation should block the push workflow rather than be treated as advisory.
- Require actions to be pinned to full-length commit SHAs in repository settings when that policy is available. The repository already pins all current actions and runs `npm run workflow:check` in CI.
- Require branches to be up to date before merging.
- Do not allow bypassing the above for administrators unless you intentionally want break-glass access.

## Security

- **Dependabot** — enabled via [`.github/dependabot.yml`](../.github/dependabot.yml); review and merge security PRs promptly.
- **Action updates** — retain the release-version comment beside each SHA pin, verify the new SHA comes from the intended upstream action repository, and run the workflow pin guard before merging.
- **Code scanning** — [CodeQL workflow](../.github/workflows/codeql.yml) uploads results to the **Security** tab.
- **Secrets** — store `GNEWS_API_KEY` and similar only in **Actions secrets** or your deployment environment, never in workflow YAML.

## Releases

- Tag versions from `CHANGELOG.md` (for example `v1.1.0`) after updating the changelog entry.
- Optional: create GitHub Releases from tags with release notes copied from the changelog section.
