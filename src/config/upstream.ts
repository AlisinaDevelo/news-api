import { resolvePositiveIntegerEnv } from "./numbers";

export const UPSTREAM_TIMEOUT_MS = resolvePositiveIntegerEnv(
  process.env.HTTP_TIMEOUT_MS,
  15_000,
  60_000
);

const DEFAULT_UPSTREAM_BASE_URL = "https://gnews.io/api/v4";

export function resolveUpstreamBaseUrl(rawUrl = process.env.GNEWS_BASE_URL): string {
  const value = rawUrl?.trim();
  if (!value) {
    return DEFAULT_UPSTREAM_BASE_URL;
  }
  return value.replace(/\/+$/, "");
}

export const UPSTREAM_BASE_URL = resolveUpstreamBaseUrl();
