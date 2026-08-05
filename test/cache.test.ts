import { describe, it, expect, afterEach } from "vitest";
import {
  getCacheStore,
  parseRedisCacheValue,
  resetCacheStoreForTests,
  setCacheStoreForTests,
} from "../src/cache/store";

describe("cache", () => {
  afterEach(() => {
    resetCacheStoreForTests();
  });

  it("stores and retrieves a value", async () => {
    const store = getCacheStore();
    const key = `k-${Math.random().toString(36).slice(2)}`;
    const value = { articles: [{ id: 1 }] };
    await store.set(key, value);
    expect(await store.get(key)).toEqual(value);
  });

  it("allows tests to inject a cache store", async () => {
    const value = { injected: true };
    setCacheStoreForTests({
      async get() {
        return value;
      },
      async set() {
        return undefined;
      },
      async delete() {
        return undefined;
      },
    });

    expect(await getCacheStore().get("anything")).toEqual(value);
  });

  it("deletes a memory cache entry", async () => {
    const store = getCacheStore();
    await store.set("remove-me", { cached: true });

    await store.delete("remove-me");

    expect(await store.get("remove-me")).toBeUndefined();
  });

  it("rejects corrupted Redis JSON instead of treating it as a miss", () => {
    expect(() => parseRedisCacheValue("{not-json")).toThrow("invalid JSON in Redis cache entry");
    expect(parseRedisCacheValue(JSON.stringify({ articles: [] }))).toEqual({ articles: [] });
  });
});
