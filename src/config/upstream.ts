const raw = Number(process.env.HTTP_TIMEOUT_MS ?? 15_000);

export const UPSTREAM_TIMEOUT_MS =
  Number.isFinite(raw) && raw > 0 ? Math.min(raw, 60_000) : 15_000;

const DEFAULT_UPSTREAM_BASE_URL = "https://gnews.io/api/v4";

export function resolveUpstreamBaseUrl(rawUrl = process.env.GNEWS_BASE_URL): string {
  const value = rawUrl?.trim();
  if (!value) {
    return DEFAULT_UPSTREAM_BASE_URL;
  }
  return value.replace(/\/+$/, "");
}

export const UPSTREAM_BASE_URL = resolveUpstreamBaseUrl();
