# GitHub repository settings

These settings are applied in the GitHub UI (not in git). They mirror common enterprise defaults.

## Branch protection (`main`)

Suggested rules:

- Require a pull request before merging (at least one review for teams; solo maintainers may use zero).
- Require status checks to pass before merging:
  - `test (20)`, `test (22)`, `docker`, `CodeQL` (when enabled), and any other required workflows.
- Require branches to be up to date before merging.
- Do not allow bypassing the above for administrators unless you intentionally want break-glass access.

## Security

- **Dependabot** — enabled via [`.github/dependabot.yml`](../.github/dependabot.yml); review and merge security PRs promptly.
- **Code scanning** — [CodeQL workflow](../.github/workflows/codeql.yml) uploads results to the **Security** tab.
- **Secrets** — store `GNEWS_API_KEY` and similar only in **Actions secrets** or your deployment environment, never in workflow YAML.

## Releases

- Tag versions from `CHANGELOG.md` (for example `v1.1.0`) after updating the changelog entry.
- Optional: create GitHub Releases from tags with release notes copied from the changelog section.
