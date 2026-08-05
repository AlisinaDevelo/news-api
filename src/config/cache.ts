import { resolvePositiveIntegerEnv } from "./numbers";

export const DEFAULT_CACHE_LEASE_TTL_MS = 5_000;
export const MAX_CACHE_LEASE_TTL_MS = 30_000;
export const DEFAULT_CACHE_LEASE_WAIT_MS = 750;
export const MAX_CACHE_LEASE_WAIT_MS = 5_000;
export const DEFAULT_CACHE_LEASE_POLL_MS = 50;
export const MAX_CACHE_LEASE_POLL_MS = 500;

export function resolveCacheLeaseTtlMs(rawValue = process.env.CACHE_LEASE_TTL_MS): number {
  return resolvePositiveIntegerEnv(rawValue, DEFAULT_CACHE_LEASE_TTL_MS, MAX_CACHE_LEASE_TTL_MS);
}

export function resolveCacheLeaseWaitMs(rawValue = process.env.CACHE_LEASE_WAIT_MS): number {
  return resolvePositiveIntegerEnv(
    rawValue,
    DEFAULT_CACHE_LEASE_WAIT_MS,
    MAX_CACHE_LEASE_WAIT_MS
  );
}

export function resolveCacheLeasePollMs(rawValue = process.env.CACHE_LEASE_POLL_MS): number {
  return resolvePositiveIntegerEnv(
    rawValue,
    DEFAULT_CACHE_LEASE_POLL_MS,
    MAX_CACHE_LEASE_POLL_MS
  );
}
