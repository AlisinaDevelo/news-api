import { describe, it, expect, afterEach } from "vitest";
import { getCacheStore, resetCacheStoreForTests } from "../src/cache/store";

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
});
