import { afterEach, describe, expect, it, vi } from "vitest";
import { coordinateCacheMiss } from "../src/cache/coordinator";
import type { CacheStore } from "../src/cache/store";
import { RequestAbortedError } from "../src/runtime/requestCancellation";

function baseStore(overrides: Partial<CacheStore> = {}): CacheStore {
  return {
    async get() {
      return undefined;
    },
    async set() {},
    async delete() {},
    ...overrides,
  };
}

describe("cross-replica cache coordination", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("lets one lease holder populate the cache for a competing replica", async () => {
    vi.stubEnv("CACHE_LEASE_WAIT_MS", "100");
    vi.stubEnv("CACHE_LEASE_POLL_MS", "1");
    const cache = new Map<string, string>();
    let locked = false;
    let releaseLoad: (() => void) | undefined;
    let loadCount = 0;
    const tryAcquireLease = vi.fn(async () => {
      if (locked) {
        return false;
      }
      locked = true;
      return true;
    });
    const store = baseStore({
      async get(key) {
        return cache.get(key);
      },
      tryAcquireLease,
      async releaseLease() {
        locked = false;
      },
    });

    const first = coordinateCacheMiss({
      store,
      cacheKey: "same-search",
      readFresh: async () => cache.get("same-search"),
      load: async () => {
        loadCount += 1;
        await new Promise<void>((resolve) => {
          releaseLoad = resolve;
        });
        cache.set("same-search", "articles");
        return "articles";
      },
    });
    await vi.waitFor(() => expect(loadCount).toBe(1));

    const second = coordinateCacheMiss({
      store,
      cacheKey: "same-search",
      readFresh: async () => cache.get("same-search"),
      load: async () => {
        loadCount += 1;
        return "duplicate";
      },
    });

    await vi.waitFor(() => expect(tryAcquireLease).toHaveBeenCalledTimes(2));
    cache.set("same-search", "articles");
    releaseLoad?.();
    await expect(first).resolves.toMatchObject({ value: "articles", source: "upstream" });
    await expect(second).resolves.toMatchObject({ value: "articles", source: "shared-cache" });
    expect(loadCount).toBe(1);
  });

  it("falls through to upstream after the bounded wait expires", async () => {
    vi.stubEnv("CACHE_LEASE_WAIT_MS", "5");
    vi.stubEnv("CACHE_LEASE_POLL_MS", "1");
    const tryAcquireLease = vi.fn(async () => false);
    const load = vi.fn(async () => "articles");
    const result = await coordinateCacheMiss({
      store: baseStore({ tryAcquireLease, async releaseLease() {} }),
      cacheKey: "expired-search",
      readFresh: async () => undefined,
      load,
    });

    expect(result).toEqual({ value: "articles", source: "upstream" });
    expect(load).toHaveBeenCalledOnce();
    expect(tryAcquireLease).toHaveBeenCalled();
  });

  it("fails open when Redis lease commands are unavailable", async () => {
    const load = vi.fn(async () => "articles");
    const result = await coordinateCacheMiss({
      store: baseStore({
        async tryAcquireLease() {
          throw new Error("redis unavailable");
        },
        async releaseLease() {},
      }),
      cacheKey: "redis-error-search",
      readFresh: async () => undefined,
      load,
    });

    expect(result).toEqual({ value: "articles", source: "upstream" });
    expect(load).toHaveBeenCalledOnce();
  });

  it("bypasses coordination for the in-process memory cache", async () => {
    const result = await coordinateCacheMiss({
      store: baseStore(),
      cacheKey: "memory-search",
      readFresh: async () => undefined,
      load: async () => "articles",
    });

    expect(result).toEqual({ value: "articles", source: "bypassed" });
  });

  it("cancels a waiter without falling through to upstream", async () => {
    vi.stubEnv("CACHE_LEASE_WAIT_MS", "100");
    vi.stubEnv("CACHE_LEASE_POLL_MS", "10");
    const controller = new AbortController();
    const load = vi.fn(async () => "articles");
    const pending = coordinateCacheMiss({
      store: baseStore({
        async tryAcquireLease() {
          return false;
        },
        async releaseLease() {},
      }),
      cacheKey: "canceled-search",
      signal: controller.signal,
      readFresh: async () => undefined,
      load,
    });

    await vi.waitFor(() => expect(load).not.toHaveBeenCalled());
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(RequestAbortedError);
    expect(load).not.toHaveBeenCalled();
  });

  it("renews a held lease and stops the heartbeat after the load settles", async () => {
    vi.useFakeTimers();
    vi.stubEnv("CACHE_LEASE_TTL_MS", "20");
    vi.stubEnv("CACHE_LEASE_HEARTBEAT_MS", "10");
    let releaseLoad: (() => void) | undefined;
    const renewLease = vi.fn(async () => true);
    const pending = coordinateCacheMiss({
      store: baseStore({
        async tryAcquireLease() {
          return true;
        },
        async releaseLease() {},
        renewLease,
      }),
      cacheKey: "renewed-search",
      readFresh: async () => undefined,
      load: async () => {
        await new Promise<void>((resolve) => {
          releaseLoad = resolve;
        });
        return "articles";
      },
    });

    for (let step = 0; step < 4; step += 1) {
      await Promise.resolve();
    }
    expect(releaseLoad).toBeDefined();
    await vi.advanceTimersByTimeAsync(10);
    expect(renewLease).toHaveBeenCalledOnce();

    releaseLoad?.();
    await expect(pending).resolves.toMatchObject({ value: "articles", source: "upstream" });
    await vi.advanceTimersByTimeAsync(100);
    expect(renewLease).toHaveBeenCalledOnce();
  });

  it("stops renewing after Redis reports that the owner token is gone", async () => {
    vi.useFakeTimers();
    vi.stubEnv("CACHE_LEASE_TTL_MS", "20");
    vi.stubEnv("CACHE_LEASE_HEARTBEAT_MS", "10");
    let releaseLoad: (() => void) | undefined;
    const renewLease = vi.fn(async () => false);
    const pending = coordinateCacheMiss({
      store: baseStore({
        async tryAcquireLease() {
          return true;
        },
        async releaseLease() {},
        renewLease,
      }),
      cacheKey: "lost-search",
      readFresh: async () => undefined,
      load: async () => {
        await new Promise<void>((resolve) => {
          releaseLoad = resolve;
        });
        return "articles";
      },
    });

    for (let step = 0; step < 4; step += 1) {
      await Promise.resolve();
    }
    expect(releaseLoad).toBeDefined();
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(100);
    expect(renewLease).toHaveBeenCalledOnce();

    releaseLoad?.();
    await expect(pending).resolves.toMatchObject({ value: "articles", source: "upstream" });
  });

  it("does not return a cache value after cancellation during the final cache read", async () => {
    const controller = new AbortController();
    let resolveCacheRead: ((value: string) => void) | undefined;
    const load = vi.fn(async () => "upstream");
    const pending = coordinateCacheMiss({
      store: baseStore({
        async tryAcquireLease() {
          return true;
        },
        async releaseLease() {},
      }),
      cacheKey: "canceled-cache-read",
      signal: controller.signal,
      readFresh: () =>
        new Promise<string>((resolve) => {
          resolveCacheRead = resolve;
        }),
      load,
    });

    await vi.waitFor(() => expect(resolveCacheRead).toBeDefined());
    controller.abort();
    resolveCacheRead?.("articles");

    await expect(pending).rejects.toBeInstanceOf(RequestAbortedError);
    expect(load).not.toHaveBeenCalled();
  });
});
