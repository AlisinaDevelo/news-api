import type { RedisOptions } from "ioredis";
import { resolvePositiveIntegerEnv } from "./numbers";

export const DEFAULT_CACHE_REDIS_COMMAND_TIMEOUT_MS = 500;
export const MAX_CACHE_REDIS_COMMAND_TIMEOUT_MS = 1_000;
export const DEFAULT_CACHE_REDIS_CONNECT_TIMEOUT_MS = 1_000;
export const MAX_CACHE_REDIS_CONNECT_TIMEOUT_MS = 5_000;
export const DEFAULT_RATE_LIMIT_REDIS_COMMAND_TIMEOUT_MS = 500;
export const MAX_RATE_LIMIT_REDIS_COMMAND_TIMEOUT_MS = 1_000;
export const DEFAULT_RATE_LIMIT_REDIS_CONNECT_TIMEOUT_MS = 1_000;
export const MAX_RATE_LIMIT_REDIS_CONNECT_TIMEOUT_MS = 5_000;

export function resolveCacheRedisCommandTimeoutMs(
  rawValue = process.env.CACHE_REDIS_COMMAND_TIMEOUT_MS
): number {
  return resolvePositiveIntegerEnv(
    rawValue,
    DEFAULT_CACHE_REDIS_COMMAND_TIMEOUT_MS,
    MAX_CACHE_REDIS_COMMAND_TIMEOUT_MS
  );
}

export function resolveCacheRedisConnectTimeoutMs(
  rawValue = process.env.CACHE_REDIS_CONNECT_TIMEOUT_MS
): number {
  return resolvePositiveIntegerEnv(
    rawValue,
    DEFAULT_CACHE_REDIS_CONNECT_TIMEOUT_MS,
    MAX_CACHE_REDIS_CONNECT_TIMEOUT_MS
  );
}

export function resolveCacheRedisOptions(
  commandTimeoutRaw = process.env.CACHE_REDIS_COMMAND_TIMEOUT_MS,
  connectTimeoutRaw = process.env.CACHE_REDIS_CONNECT_TIMEOUT_MS
): RedisOptions {
  return {
    commandTimeout: resolveCacheRedisCommandTimeoutMs(commandTimeoutRaw),
    connectTimeout: resolveCacheRedisConnectTimeoutMs(connectTimeoutRaw),
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    enableReadyCheck: true,
    lazyConnect: false,
  };
}

export function resolveRateLimitRedisCommandTimeoutMs(
  rawValue = process.env.RATE_LIMIT_REDIS_COMMAND_TIMEOUT_MS
): number {
  return resolvePositiveIntegerEnv(
    rawValue,
    DEFAULT_RATE_LIMIT_REDIS_COMMAND_TIMEOUT_MS,
    MAX_RATE_LIMIT_REDIS_COMMAND_TIMEOUT_MS
  );
}

export function resolveRateLimitRedisConnectTimeoutMs(
  rawValue = process.env.RATE_LIMIT_REDIS_CONNECT_TIMEOUT_MS
): number {
  return resolvePositiveIntegerEnv(
    rawValue,
    DEFAULT_RATE_LIMIT_REDIS_CONNECT_TIMEOUT_MS,
    MAX_RATE_LIMIT_REDIS_CONNECT_TIMEOUT_MS
  );
}

export function resolveRateLimitRedisOptions(
  commandTimeoutRaw = process.env.RATE_LIMIT_REDIS_COMMAND_TIMEOUT_MS,
  connectTimeoutRaw = process.env.RATE_LIMIT_REDIS_CONNECT_TIMEOUT_MS
): RedisOptions {
  return {
    commandTimeout: resolveRateLimitRedisCommandTimeoutMs(commandTimeoutRaw),
    connectTimeout: resolveRateLimitRedisConnectTimeoutMs(connectTimeoutRaw),
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    enableReadyCheck: true,
    lazyConnect: false,
  };
}
