import { describe, it, expect } from "vitest";
import { getCache, setCache } from "../src/utils/cache";

describe("cache", () => {
  it("stores and retrieves a value", () => {
    const key = `k-${Math.random().toString(36).slice(2)}`;
    const value = { articles: [{ id: 1 }] };
    setCache(key, value);
    expect(getCache(key)).toEqual(value);
  });
});
