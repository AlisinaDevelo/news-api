import { MAX_RETRY_AFTER_SECONDS } from "../constants";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

/** Normalize provider timing into a bounded delta-seconds header. */
export function normalizeRetryAfter(value: unknown, now = Date.now()): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") {
    return undefined;
  }

  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isSafeInteger(seconds)) {
      return undefined;
    }
    return String(Math.min(seconds, MAX_RETRY_AFTER_SECONDS));
  }
  if (/^[+-]?\d+$/.test(trimmed)) {
    return undefined;
  }

  const retryAt = Date.parse(trimmed);
  if (Number.isNaN(retryAt)) {
    return undefined;
  }

  const seconds = Math.max(0, Math.ceil((retryAt - now) / 1000));
  return String(Math.min(seconds, MAX_RETRY_AFTER_SECONDS));
}

export function retryAfterFromHeaders(headers: unknown): string | undefined {
  if (!isRecord(headers)) {
    return undefined;
  }

  const get = headers.get;
  if (typeof get === "function") {
    const value = get.call(headers, "retry-after");
    const normalized = normalizeRetryAfter(value);
    if (normalized !== undefined) {
      return normalized;
    }
  }

  return normalizeRetryAfter(headers["retry-after"] ?? headers["Retry-After"]);
}
