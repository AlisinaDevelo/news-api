import { resolvePositiveIntegerEnv } from "./numbers";

export const DEFAULT_SERVER_MAX_JSON_BODY_BYTES = 32 * 1024;
export const MAX_SERVER_MAX_JSON_BODY_BYTES = 256 * 1024;

export function resolveServerMaxJsonBodyBytes(
  rawValue = process.env.SERVER_MAX_JSON_BODY_BYTES
): number {
  return resolvePositiveIntegerEnv(
    rawValue,
    DEFAULT_SERVER_MAX_JSON_BODY_BYTES,
    MAX_SERVER_MAX_JSON_BODY_BYTES
  );
}
