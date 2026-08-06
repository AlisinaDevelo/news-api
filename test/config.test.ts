import { describe, expect, it } from "vitest";
import {
  resolveNonNegativeIntegerEnv,
  resolvePositiveIntegerEnv,
} from "../src/config/numbers";
import {
  resolveCacheLeaseHeartbeatMs,
  resolveCacheLeaseTtlMs,
} from "../src/config/cache";
import {
  resolveCacheRedisCommandTimeoutMs,
  resolveCacheRedisConnectTimeoutMs,
  resolveCacheRedisOptions,
  resolveRateLimitRedisCommandTimeoutMs,
  resolveRateLimitRedisConnectTimeoutMs,
  resolveRateLimitRedisOptions,
} from "../src/config/redis";

describe("resolvePositiveIntegerEnv", () => {
  it("uses the fallback for missing, malformed, or non-positive values", () => {
    expect(resolvePositiveIntegerEnv(undefined, 15)).toBe(15);
    expect(resolvePositiveIntegerEnv("", 15)).toBe(15);
    expect(resolvePositiveIntegerEnv("nope", 15)).toBe(15);
    expect(resolvePositiveIntegerEnv("Infinity", 15)).toBe(15);
    expect(resolvePositiveIntegerEnv("0", 15)).toBe(15);
    expect(resolvePositiveIntegerEnv("-1", 15)).toBe(15);
  });

  it("rejects fractional and unsafe integers", () => {
    expect(resolvePositiveIntegerEnv("1.5", 15)).toBe(15);
    expect(resolvePositiveIntegerEnv("9007199254740992", 15)).toBe(15);
  });

  it("clamps values when a maximum is configured", () => {
    expect(resolvePositiveIntegerEnv("101", 15, 100)).toBe(100);
    expect(resolvePositiveIntegerEnv("25", 15, 100)).toBe(25);
  });

  it("allows zero for optional retry counts", () => {
    expect(resolveNonNegativeIntegerEnv("", 1, 3)).toBe(1);
    expect(resolveNonNegativeIntegerEnv("0", 1, 3)).toBe(0);
    expect(resolveNonNegativeIntegerEnv("4", 1, 3)).toBe(3);
  });
});

describe("cache lease heartbeat configuration", () => {
  it("defaults to half the lease TTL and never exceeds it", () => {
    expect(resolveCacheLeaseTtlMs(undefined)).toBe(5_000);
    expect(resolveCacheLeaseHeartbeatMs(undefined, 5_000)).toBe(2_500);
    expect(resolveCacheLeaseHeartbeatMs("9000", 5_000)).toBe(2_500);
  });

  it("keeps malformed and non-positive heartbeat values bounded", () => {
    expect(resolveCacheLeaseHeartbeatMs("nope", 1_000)).toBe(500);
    expect(resolveCacheLeaseHeartbeatMs("0", 1_000)).toBe(500);
    expect(resolveCacheLeaseHeartbeatMs("250", 1_000)).toBe(250);
  });
});

describe("cache Redis configuration", () => {
  it("uses bounded command and connection timeout defaults", () => {
    expect(resolveCacheRedisCommandTimeoutMs(undefined)).toBe(500);
    expect(resolveCacheRedisConnectTimeoutMs(undefined)).toBe(1_000);
    expect(resolveCacheRedisOptions(undefined, undefined)).toMatchObject({
      commandTimeout: 500,
      connectTimeout: 1_000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      enableReadyCheck: true,
      lazyConnect: false,
    });
  });

  it("rejects malformed values and clamps configured maxima", () => {
    expect(resolveCacheRedisCommandTimeoutMs("nope")).toBe(500);
    expect(resolveCacheRedisCommandTimeoutMs("0")).toBe(500);
    expect(resolveCacheRedisCommandTimeoutMs("1.5")).toBe(500);
    expect(resolveCacheRedisCommandTimeoutMs("9000")).toBe(1_000);
    expect(resolveCacheRedisConnectTimeoutMs("nope")).toBe(1_000);
    expect(resolveCacheRedisConnectTimeoutMs("0")).toBe(1_000);
    expect(resolveCacheRedisConnectTimeoutMs("9000")).toBe(5_000);
    expect(resolveCacheRedisOptions("750", "2500")).toMatchObject({
      commandTimeout: 750,
      connectTimeout: 2_500,
    });
  });
});

describe("rate-limit Redis configuration", () => {
  it("uses bounded command and connection timeout defaults", () => {
    expect(resolveRateLimitRedisCommandTimeoutMs(undefined)).toBe(500);
    expect(resolveRateLimitRedisConnectTimeoutMs(undefined)).toBe(1_000);
    expect(resolveRateLimitRedisOptions(undefined, undefined)).toMatchObject({
      commandTimeout: 500,
      connectTimeout: 1_000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      enableReadyCheck: true,
      lazyConnect: false,
    });
  });

  it("rejects malformed values and clamps configured maxima", () => {
    expect(resolveRateLimitRedisCommandTimeoutMs("nope")).toBe(500);
    expect(resolveRateLimitRedisCommandTimeoutMs("0")).toBe(500);
    expect(resolveRateLimitRedisCommandTimeoutMs("1.5")).toBe(500);
    expect(resolveRateLimitRedisCommandTimeoutMs("9000")).toBe(1_000);
    expect(resolveRateLimitRedisConnectTimeoutMs("nope")).toBe(1_000);
    expect(resolveRateLimitRedisConnectTimeoutMs("0")).toBe(1_000);
    expect(resolveRateLimitRedisConnectTimeoutMs("9000")).toBe(5_000);
    expect(resolveRateLimitRedisOptions("750", "2500")).toMatchObject({
      commandTimeout: 750,
      connectTimeout: 2_500,
    });
  });
});
