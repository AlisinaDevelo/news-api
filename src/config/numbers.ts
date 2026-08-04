export function resolvePositiveIntegerEnv(
  raw: string | undefined,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  const value = Number(raw ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) {
    return fallback;
  }
  return Math.min(value, maximum);
}
