import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { Store } from "express-rate-limit";
import { createApiRateLimiter } from "../src/middleware/rateLimit";
import { errorHandler } from "../src/middleware/errorHandler";
import { register } from "../src/metrics/register";

interface SharedEntry {
  totalHits: number;
  resetTime: Date;
}

function sharedStoreState(): () => Store {
  const entries = new Map<string, SharedEntry>();

  return () => ({
    localKeys: false,
    prefix: "test-shared:",
    async increment(key) {
      const now = Date.now();
      const current = entries.get(key);
      const entry = !current || current.resetTime.getTime() <= now
        ? { totalHits: 0, resetTime: new Date(now + 60_000) }
        : current;
      entry.totalHits += 1;
      entries.set(key, entry);
      return entry;
    },
    async decrement(key) {
      const entry = entries.get(key);
      if (entry && entry.totalHits > 0) {
        entry.totalHits -= 1;
      }
    },
    async resetKey(key) {
      entries.delete(key);
    },
  });
}

function appWithLimiter(limiter: ReturnType<typeof createApiRateLimiter>): express.Express {
  const app = express();
  app.use(limiter);
  app.get("/api/v1/resource", (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  return app;
}

describe("shared rate limiting", () => {
  it("enforces one quota across two limiter instances", async () => {
    const createStore = sharedStoreState();
    const firstApp = appWithLimiter(
      createApiRateLimiter({
        store: createStore(),
        limit: 1,
        skip: () => false,
      })
    );
    const secondApp = appWithLimiter(
      createApiRateLimiter({
        store: createStore(),
        limit: 1,
        skip: () => false,
      })
    );

    const allowed = await request(firstApp).get("/api/v1/resource");
    const blocked = await request(secondApp).get("/api/v1/resource");

    expect(allowed.status).toBe(200);
    expect(blocked.status).toBe(429);
    expect(blocked.headers["ratelimit"]).toBeDefined();
    expect(blocked.headers["ratelimit-policy"]).toBeDefined();
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(blocked.body).toMatchObject({
      error: {
        code: "rate_limit_exceeded",
        message: "Too many requests, please try again later.",
      },
    });
  });

  it("fails closed with a structured 503 when the store errors", async () => {
    const brokenStore: Store = {
      localKeys: false,
      async increment() {
        throw new Error("redis unavailable");
      },
      async decrement() {
        return undefined;
      },
      async resetKey() {
        return undefined;
      },
    };
    const app = appWithLimiter(
      createApiRateLimiter({ store: brokenStore, skip: () => false })
    );

    const response = await request(app).get("/api/v1/resource");
    const metrics = await register.metrics();

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      error: {
        code: "rate_limit_store_unavailable",
        message: "Rate limit store unavailable",
      },
    });
    expect(metrics).toContain('news_rate_limit_store_errors_total{source="request"}');
  });
});
