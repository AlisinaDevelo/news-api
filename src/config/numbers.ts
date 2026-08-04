export function resolveNonNegativeIntegerEnv(
  raw: string | undefined,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  if (raw !== undefined && raw.trim() === "") {
    return fallback;
  }
  const value = Number(raw ?? fallback);
  if (!Number.isSafeInteger(value) || value < 0) {
    return fallback;
  }
  return Math.min(value, maximum);
}

export function resolvePositiveIntegerEnv(
  raw: string | undefined,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  const value = resolveNonNegativeIntegerEnv(raw, fallback, maximum);
  return value > 0 ? value : fallback;
}
