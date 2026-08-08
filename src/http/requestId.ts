export const MAX_REQUEST_ID_LENGTH = 128;
export const MAX_LOG_PATH_LENGTH = 512;

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/~-]*$/;

export function normalizeRequestId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  if (normalized.length > MAX_REQUEST_ID_LENGTH || !REQUEST_ID_PATTERN.test(normalized)) {
    return undefined;
  }
  return normalized;
}

export function boundedRequestPath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    return "/";
  }

  const queryStart = value.indexOf("?");
  const path = (queryStart >= 0 ? value.slice(0, queryStart) : value) || "/";
  if (path.length <= MAX_LOG_PATH_LENGTH) {
    return path;
  }

  return `${path.slice(0, MAX_LOG_PATH_LENGTH - 3)}...`;
}
