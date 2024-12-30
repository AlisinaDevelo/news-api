const raw = Number(process.env.HTTP_TIMEOUT_MS ?? 15_000);

export const UPSTREAM_TIMEOUT_MS =
  Number.isFinite(raw) && raw > 0 ? Math.min(raw, 60_000) : 15_000;
