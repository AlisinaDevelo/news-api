import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { gzipSync } from "node:zlib";
import request from "supertest";

const { mockGet } = vi.hoisted(() => ({
  mockGet: vi.fn(),
}));

vi.mock("axios", async (importOriginal) => {
  const actual = await importOriginal<typeof import("axios")>();
  return {
    ...actual,
    default: {
      ...actual.default,
      get: mockGet,
    },
  };
});

import axios from "axios";
import app from "../src/app";
import { sampleArticles } from "./fixtures/articles";
import {
  CacheCorruptionError,
  getCacheStore,
  resetCacheStoreForTests,
  setCacheStoreForTests,
} from "../src/cache/store";
import { resetGNewsCircuitForTests } from "../src/providers/gnewsProvider";
import { resetNewsServiceForTests } from "../src/services/newsService";
import { MAX_ARTICLE_COUNT, MAX_UPSTREAM_RESPONSE_BYTES } from "../src/constants";
import { beginDraining, resetLifecycleForTests } from "../src/runtime/lifecycle";
import { httpBodyErrorsTotal, requestIdRejectionsTotal } from "../src/metrics/register";
import { resolveServerMaxJsonBodyBytes } from "../src/config/httpBody";

function axiosErrorWithStatus(
  status: number,
  headers: Record<string, string> = {}
): axios.AxiosError {
  const error = new axios.AxiosError(`upstream ${status}`, "ERR_BAD_REQUEST");
  Object.defineProperty(error, "response", { value: { status, headers } });
  return error;
}

describe("app", () => {
  beforeEach(() => {
    mockGet.mockReset();
    resetCacheStoreForTests();
    resetGNewsCircuitForTests();
    resetNewsServiceForTests();
    resetLifecycleForTests();
    requestIdRejectionsTotal.reset();
    httpBodyErrorsTotal.reset();
  });

  afterEach(() => {
    requestIdRejectionsTotal.reset();
    httpBodyErrorsTotal.reset();
  });

  it("preserves safe request IDs and replaces oversized client IDs", async () => {
    const accepted = await request(app).get("/health").set("X-Request-Id", "trace_2026/08");
    expect(accepted.headers["x-request-id"]).toBe("trace_2026/08");

    const rejected = await request(app)
      .get("/health")
      .set("X-Request-Id", "x".repeat(129));
    expect(rejected.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(rejected.headers["x-request-id"]).not.toBe("x".repeat(129));

    mockGet.mockResolvedValueOnce({ data: { articles: sampleArticles } });
    const versioned = await request(app)
      .get("/api/v1/articles?query=request-id-contract")
      .set("X-Request-Id", "x".repeat(129));
    expect(versioned.body.meta.requestId).toBe(versioned.headers["x-request-id"]);

    const metrics = await request(app).get("/metrics");
    expect(metrics.text).toContain("news_request_id_rejections_total 2");
  });

  it("GET /health returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok" });
    expect(typeof res.body.uptime).toBe("number");
  });

  it("returns safe contracts for oversized and malformed JSON bodies", async () => {
    const oversized = await request(app)
      .post("/api/v1/articles")
      .set("Content-Type", "application/json")
      .set("X-Request-Id", "body-limit-test")
      .send({ payload: "x".repeat(resolveServerMaxJsonBodyBytes() + 1000) });

    expect(oversized.status).toBe(413);
    expect(oversized.body).toEqual({
      error: {
        code: "request_body_too_large",
        message: "Request body too large",
        requestId: "body-limit-test",
      },
    });

    const malformed = await request(app)
      .post("/api/articles")
      .set("Content-Type", "application/json")
      .send('{"payload":');

    expect(malformed.status).toBe(400);
    expect(malformed.body).toEqual({ error: "Invalid JSON request body" });

    const metrics = await request(app).get("/metrics");
    expect(metrics.text).toContain('news_http_body_errors_total{type="entity.too.large"} 1');
    expect(metrics.text).toContain('news_http_body_errors_total{type="entity.parse.failed"} 1');
  });

  it("rejects compressed JSON bodies before inflation", async () => {
    const compressed = gzipSync(Buffer.from(JSON.stringify({ payload: "safe" })));
    const response = await request(app)
      .post("/api/v1/articles")
      .set("Content-Type", "application/json")
      .set("Content-Encoding", "gzip")
      .send(compressed);

    expect(response.status).toBe(415);
    expect(response.body).toEqual({
      error: {
        code: "unsupported_content_encoding",
        message: "Unsupported request content encoding",
        requestId: response.headers["x-request-id"],
      },
    });

    const metrics = await request(app).get("/metrics");
    expect(metrics.text).toContain(
      'news_http_body_errors_total{type="encoding.unsupported"} 1'
    );
  });

  it("returns 405 with the read-only Allow contract", async () => {
    const res = await request(app).post("/api/v1/articles");

    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe("GET, HEAD, OPTIONS");
    expect(res.body).toMatchObject({
      error: {
        code: "method_not_allowed",
        message: "Method not allowed",
      },
    });
    expect(typeof res.body.error.requestId).toBe("string");
  });

  it("answers OPTIONS for a read-only route without a response body", async () => {
    const res = await request(app).options("/api/articles");

    expect(res.status).toBe(204);
    expect(res.headers.allow).toBe("GET, HEAD, OPTIONS");
    expect(res.text).toBe("");
  });

  it("returns JSON not-found contracts for unknown API routes", async () => {
    const versioned = await request(app).get("/api/v1/unknown");
    expect(versioned.status).toBe(404);
    expect(versioned.body).toEqual({
      error: {
        code: "route_not_found",
        message: "API route not found",
        requestId: versioned.headers["x-request-id"],
      },
    });

    const legacy = await request(app).get("/api/unknown");
    expect(legacy.status).toBe(404);
    expect(legacy.body).toEqual({ error: "API route not found" });
  });

  it("GET /ready returns ready in test", async () => {
    const res = await request(app).get("/ready");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ready" });
  });

  it("reports draining readiness while keeping liveness available", async () => {
    beginDraining();

    const [ready, health] = await Promise.all([
      request(app).get("/ready"),
      request(app).get("/health"),
    ]);

    expect(ready.status).toBe(503);
    expect(ready.body).toEqual({ status: "draining" });
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ status: "ok" });
  });

  it("reports an unavailable required rate-limit store without failing liveness", async () => {
    vi.stubEnv("REDIS_URL", "redis://redis.invalid:6379");
    vi.stubEnv("DISABLE_RATE_LIMIT", "0");

    try {
      const [ready, health] = await Promise.all([
        request(app).get("/ready"),
        request(app).get("/health"),
      ]);

      expect(ready.status).toBe(503);
      expect(ready.body).toEqual({
        status: "not_ready",
        reason: "rate_limit_store_unavailable",
      });
      expect(health.status).toBe(200);
      expect(health.body).toMatchObject({ status: "ok" });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps cache-only Redis out of readiness when rate limiting is disabled", async () => {
    vi.stubEnv("REDIS_URL", "redis://redis.invalid:6379");
    vi.stubEnv("DISABLE_RATE_LIMIT", "1");

    try {
      const ready = await request(app).get("/ready");

      expect(ready.status).toBe(200);
      expect(ready.body).toEqual({ status: "ready" });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("GET /openapi.yaml serves spec", async () => {
    const res = await request(app).get("/openapi.yaml");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/yaml/);
    expect(res.text).toContain("openapi:");
  });

  it("GET / returns service metadata", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: "news-api",
      api: {
        current: "v1",
        v1: {
          articles: "/api/v1/articles",
          articleSearch: "/api/v1/articles/search",
          articleByTitle: "/api/v1/articles/title/{title}",
          sourceArticles: "/api/v1/sources/{source}/articles",
        },
        legacy: {
          articles: "/api/articles",
        },
      },
      docs: {
        openapi: "/openapi.yaml",
        client: "docs/CLIENT.md",
      },
      observability: {
        metrics: "/metrics",
      },
    });
  });

  it("GET /metrics returns prometheus text", async () => {
    const res = await request(app).get("/metrics");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text/);
    expect(res.text).toContain("http_requests_total");
  });

  it("compresses large API responses when the client accepts gzip", async () => {
    const largeArticles = Array.from({ length: 10 }, (_, index) => ({
      ...sampleArticles[0],
      title: `${"Large article ".repeat(16)}${index}`,
      description: "A response large enough to exercise the production compression threshold.",
    }));
    mockGet.mockResolvedValue({ data: { articles: largeArticles } });

    const compressed = await request(app)
      .get(`/api/v1/articles?query=compression-gzip-${Date.now()}&count=10`)
      .set("Accept-Encoding", "gzip");
    const plain = await request(app)
      .get(`/api/v1/articles?query=compression-plain-${Date.now()}&count=10`)
      .set("Accept-Encoding", "identity");

    expect(compressed.status).toBe(200);
    expect(compressed.headers["content-encoding"]).toBe("gzip");
    expect(compressed.headers.vary).toContain("Accept-Encoding");
    expect(compressed.body.data).toEqual(plain.body.data);
    expect(plain.headers["content-encoding"]).toBeUndefined();
  });

  it("GET /api/articles without query returns 400", async () => {
    const res = await request(app).get("/api/articles");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it("GET /api/articles with invalid count returns 400", async () => {
    const res = await request(app).get("/api/articles?query=tech&count=abc");
    expect(res.status).toBe(400);
  });

  it("GET /api/articles proxies gnews and returns articles", async () => {
    mockGet.mockResolvedValueOnce({ data: { articles: sampleArticles } });
    const res = await request(app).get("/api/articles?query=tech&count=2");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(sampleArticles);
    expect(mockGet).toHaveBeenCalledWith(
      "https://gnews.io/api/v4/search",
      expect.objectContaining({
        params: expect.objectContaining({ q: "tech", max: 2 }),
        timeout: expect.any(Number),
        signal: expect.any(AbortSignal),
        maxContentLength: MAX_UPSTREAM_RESPONSE_BYTES,
      })
    );
  });

  it("retries a transient upstream failure once", async () => {
    vi.stubEnv("UPSTREAM_RETRY_ATTEMPTS", "1");
    vi.stubEnv("UPSTREAM_RETRY_BASE_DELAY_MS", "1");
    mockGet
      .mockRejectedValueOnce(new axios.AxiosError("connection reset", "ECONNRESET"))
      .mockResolvedValueOnce({ data: { articles: sampleArticles } });

    try {
      const res = await request(app).get("/api/articles?query=retry&count=2");

      expect(res.status).toBe(200);
      expect(res.body).toEqual(sampleArticles);
      expect(mockGet).toHaveBeenCalledTimes(2);
      const metrics = await request(app).get("/metrics");
      expect(metrics.text).toContain("news_upstream_retries_total");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("GET /api/v1/articles returns an enveloped search response", async () => {
    mockGet.mockResolvedValueOnce({ data: { articles: sampleArticles } });
    const res = await request(app).get("/api/v1/articles?query=tech&count=2&page=2&lang=EN");

    expect(res.status).toBe(200);
    expect(res.headers["x-api-version"]).toBe("v1");
    expect(res.headers["x-cache-status"]).toBe("miss");
    expect(res.body).toMatchObject({
      data: sampleArticles,
      meta: {
        query: "tech",
        count: 2,
        page: 2,
        filters: { lang: "en" },
        cache: "miss",
      },
    });
    expect(typeof res.body.meta.requestId).toBe("string");
  });

  it("GET /api/v1/articles exposes cache hits in response metadata", async () => {
    mockGet.mockResolvedValue({ data: { articles: sampleArticles } });
    const q = `v1-cached-${Math.random().toString(36).slice(2)}`;

    await request(app).get(`/api/v1/articles?query=${encodeURIComponent(q)}&count=2`);
    const res = await request(app).get(`/api/v1/articles?query=${encodeURIComponent(q)}&count=2`);

    expect(res.status).toBe(200);
    expect(res.headers["x-api-version"]).toBe("v1");
    expect(res.headers["x-cache-status"]).toBe("hit");
    expect(res.body.meta.cache).toBe("hit");
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it("GET /api/v1/articles/search aliases the v1 search endpoint", async () => {
    mockGet.mockResolvedValueOnce({ data: { articles: sampleArticles } });
    const res = await request(app).get("/api/v1/articles/search?query=tech&count=2");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(sampleArticles);
    expect(res.body.meta.query).toBe("tech");
  });

  it("GET /api/articles forwards validated search filters", async () => {
    mockGet.mockResolvedValueOnce({ data: { articles: sampleArticles } });
    const res = await request(app).get(
      "/api/articles?query=tech&count=2&page=2&lang=EN&country=us&from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z&sortBy=relevance"
    );
    expect(res.status).toBe(200);
    expect(mockGet).toHaveBeenCalledWith(
      "https://gnews.io/api/v4/search",
      expect.objectContaining({
        params: expect.objectContaining({
          q: "tech",
          max: 2,
          page: 2,
          lang: "en",
          country: "us",
          from: "2026-01-01T00:00:00.000Z",
          to: "2026-01-02T00:00:00.000Z",
          sortby: "relevance",
        }),
      })
    );
  });

  it("GET /api/articles rejects invalid search filters", async () => {
    const invalidLang = await request(app).get("/api/articles?query=tech&lang=eng");
    expect(invalidLang.status).toBe(400);

    const invalidRange = await request(app).get(
      "/api/articles?query=tech&from=2026-01-02T00:00:00Z&to=2026-01-01T00:00:00Z"
    );
    expect(invalidRange.status).toBe(400);

    const oversizedQuery = await request(app).get(`/api/articles?query=${"x".repeat(257)}`);
    expect(oversizedQuery.status).toBe(400);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("reuses cache for identical search params", async () => {
    mockGet.mockResolvedValue({ data: { articles: sampleArticles } });
    const q = `cached-${Math.random().toString(36).slice(2)}`;
    await request(app).get(`/api/articles?query=${encodeURIComponent(q)}&count=2`);
    await request(app).get(`/api/articles?query=${encodeURIComponent(q)}&count=2`);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it("normalizes search params before caching", async () => {
    mockGet.mockResolvedValue({ data: { articles: sampleArticles } });
    const q = `normalized-${Math.random().toString(36).slice(2)}`;
    await request(app).get(
      `/api/articles?query=${encodeURIComponent(q)}&count=2&lang=EN&country=US&from=2026-01-01T00:00:00Z`
    );
    await request(app).get(
      `/api/articles?query=${encodeURIComponent(q)}&count=2&lang=en&country=us&from=2026-01-01T00:00:00.000Z`
    );
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it("keeps separate cache entries for different result pages", async () => {
    mockGet.mockResolvedValue({ data: { articles: sampleArticles } });
    const q = `paged-${Math.random().toString(36).slice(2)}`;

    await request(app).get(`/api/articles?query=${encodeURIComponent(q)}&count=2&page=1`);
    await request(app).get(`/api/articles?query=${encodeURIComponent(q)}&count=2&page=2`);

    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it("records cache and upstream metrics for article searches", async () => {
    mockGet.mockResolvedValue({ data: { articles: sampleArticles } });
    const q = `metrics-${Math.random().toString(36).slice(2)}`;
    await request(app).get(`/api/articles?query=${encodeURIComponent(q)}&count=2`);
    await request(app).get(`/api/articles?query=${encodeURIComponent(q)}&count=2`);

    const res = await request(app).get("/metrics");
    expect(res.status).toBe(200);
    expect(res.text).toContain('news_cache_events_total{result="miss"}');
    expect(res.text).toContain('news_cache_events_total{result="hit"}');
    expect(res.text).toContain('news_upstream_requests_total{outcome="success"}');
    expect(res.text).toContain(
      'news_upstream_request_duration_seconds_bucket{le="0.05",outcome="success"}'
    );
  });

  it("falls through to upstream when cache get fails", async () => {
    setCacheStoreForTests({
      async get() {
        throw new Error("cache unavailable");
      },
      async set() {
        return undefined;
      },
      async delete() {
        return undefined;
      },
    });
    mockGet.mockResolvedValueOnce({ data: { articles: sampleArticles } });

    const q = `cache-get-fails-${Math.random().toString(36).slice(2)}`;
    const res = await request(app).get(`/api/articles?query=${encodeURIComponent(q)}&count=2`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(sampleArticles);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it("falls through when the cache payload has an invalid article shape", async () => {
    const deletedKeys: string[] = [];
    setCacheStoreForTests({
      async get() {
        return { invalid: true };
      },
      async set() {
        return undefined;
      },
      async delete(key) {
        deletedKeys.push(key);
      },
    });
    mockGet.mockResolvedValueOnce({ data: { articles: sampleArticles } });

    const q = `cache-invalid-payload-${Math.random().toString(36).slice(2)}`;
    const res = await request(app).get(`/api/articles?query=${encodeURIComponent(q)}&count=2`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(sampleArticles);
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(deletedKeys).toHaveLength(1);
  });

  it("deletes malformed Redis JSON before falling through to upstream", async () => {
    const deletedKeys: string[] = [];
    setCacheStoreForTests({
      async get() {
        throw new CacheCorruptionError("invalid JSON in Redis cache entry");
      },
      async set() {
        return undefined;
      },
      async delete(key) {
        deletedKeys.push(key);
      },
    });
    mockGet.mockResolvedValueOnce({ data: { articles: sampleArticles } });

    const q = `cache-invalid-json-${Math.random().toString(36).slice(2)}`;
    const res = await request(app).get(`/api/articles?query=${encodeURIComponent(q)}&count=2`);

    expect(res.status).toBe(200);
    expect(deletedKeys).toHaveLength(1);
  });

  it("keeps requests healthy when cache quarantine deletion fails", async () => {
    setCacheStoreForTests({
      async get() {
        return { invalid: true };
      },
      async set() {
        return undefined;
      },
      async delete() {
        throw new Error("cache delete failed");
      },
    });
    mockGet.mockResolvedValueOnce({ data: { articles: sampleArticles } });

    const q = `cache-delete-fails-${Math.random().toString(36).slice(2)}`;
    const res = await request(app).get(`/api/articles?query=${encodeURIComponent(q)}&count=2`);
    const metrics = await request(app).get("/metrics");

    expect(res.status).toBe(200);
    expect(metrics.text).toContain('news_cache_errors_total{operation="delete"}');
  });

  it("returns upstream response when cache set fails", async () => {
    setCacheStoreForTests({
      async get() {
        return undefined;
      },
      async set() {
        throw new Error("cache write failed");
      },
      async delete() {
        return undefined;
      },
    });
    mockGet.mockResolvedValueOnce({ data: { articles: sampleArticles } });

    const q = `cache-set-fails-${Math.random().toString(36).slice(2)}`;
    const res = await request(app).get(`/api/articles?query=${encodeURIComponent(q)}&count=2`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(sampleArticles);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it("returns stale cached articles when upstream fails after a fresh miss", async () => {
    const staleArticles = sampleArticles.slice(0, 1);
    setCacheStoreForTests({
      async get(key) {
        return key.endsWith(":stale") ? staleArticles : undefined;
      },
      async set() {
        return undefined;
      },
      async delete() {
        return undefined;
      },
    });
    mockGet.mockRejectedValueOnce(new axios.AxiosError("timeout"));

    const q = `stale-${Math.random().toString(36).slice(2)}`;
    const res = await request(app).get(`/api/v1/articles?query=${encodeURIComponent(q)}&count=2`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(staleArticles);
    expect(res.body.meta.cache).toBe("stale");
    expect(res.headers["x-api-version"]).toBe("v1");
    expect(res.headers["x-cache-status"]).toBe("stale");
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it("does not serve a structurally invalid stale cache payload", async () => {
    const deletedKeys: string[] = [];
    setCacheStoreForTests({
      async get(key) {
        return key.endsWith(":stale") ? { invalid: true } : undefined;
      },
      async set() {
        return undefined;
      },
      async delete(key) {
        deletedKeys.push(key);
      },
    });
    mockGet.mockRejectedValueOnce(new axios.AxiosError("timeout"));

    const q = `stale-invalid-payload-${Math.random().toString(36).slice(2)}`;
    const res = await request(app).get(`/api/v1/articles?query=${encodeURIComponent(q)}&count=2`);

    expect(res.status).toBe(502);
    expect(res.body.error).toMatchObject({ code: "upstream_unavailable" });
    expect(deletedKeys).toHaveLength(1);
    expect(deletedKeys[0]).toMatch(/:stale$/);
  });

  it("coalesces identical in-flight cache misses", async () => {
    mockGet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ data: { articles: sampleArticles } }), 20);
        })
    );
    const q = `coalesced-${Math.random().toString(36).slice(2)}`;

    const [first, second, third] = await Promise.all([
      request(app).get(`/api/articles?query=${encodeURIComponent(q)}&count=2`),
      request(app).get(`/api/articles?query=${encodeURIComponent(q)}&count=2`),
      request(app).get(`/api/articles?query=${encodeURIComponent(q)}&count=2`),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(200);
    expect(first.body).toEqual(sampleArticles);
    expect(second.body).toEqual(sampleArticles);
    expect(third.body).toEqual(sampleArticles);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it("GET /api/articles/title returns article when matched", async () => {
    mockGet.mockResolvedValueOnce({ data: { articles: sampleArticles } });
    const title = encodeURIComponent("Alpha headline");
    const res = await request(app).get(`/api/articles/title/${title}`);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Alpha headline");
  });

  it("GET /api/v1/articles/title returns enveloped article when matched", async () => {
    mockGet.mockResolvedValueOnce({ data: { articles: sampleArticles } });
    const title = encodeURIComponent("Alpha headline");
    const res = await request(app).get(`/api/v1/articles/title/${title}`);

    expect(res.status).toBe(200);
    expect(res.headers["x-api-version"]).toBe("v1");
    expect(res.body.data.title).toBe("Alpha headline");
    expect(res.body.meta).toMatchObject({ title: "Alpha headline" });
    expect(typeof res.body.meta.requestId).toBe("string");
  });

  it("GET /api/v1/articles/title rejects malformed path encoding", async () => {
    const res = await request(app).get("/api/v1/articles/title/%E0%A4%A");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: "invalid_path_parameter",
      message: "Invalid URL-encoded path parameter",
    });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("GET /api/articles/title returns 404 when missing", async () => {
    mockGet.mockResolvedValueOnce({ data: { articles: sampleArticles } });
    const title = encodeURIComponent("Missing");
    const res = await request(app).get(`/api/articles/title/${title}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Article not found");
  });

  it("GET /api/articles/source requires source param", async () => {
    const res = await request(app).get("/api/articles/source");
    expect(res.status).toBe(400);
  });

  it("GET /api/articles/source filters by source name", async () => {
    mockGet.mockResolvedValueOnce({ data: { articles: sampleArticles } });
    const res = await request(app).get("/api/articles/source?source=BBC&count=10");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].source.name).toBe("BBC");
  });

  it("GET /api/v1/sources/:source/articles filters by source name with envelope", async () => {
    mockGet.mockResolvedValueOnce({ data: { articles: sampleArticles } });
    const res = await request(app).get("/api/v1/sources/BBC/articles?count=10&page=2");

    expect(res.status).toBe(200);
    expect(res.headers["x-api-version"]).toBe("v1");
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].source.name).toBe("BBC");
    expect(res.body.meta).toMatchObject({ source: "BBC", count: 10, page: 2 });
  });

  it("returns 500 when upstream request fails", async () => {
    mockGet.mockRejectedValueOnce(new Error("network"));
    const res = await request(app).get("/api/articles?query=fail&count=1");
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Internal server error");
  });

  it("returns 502 when axios errors", async () => {
    mockGet.mockRejectedValueOnce(new axios.AxiosError("timeout"));
    const res = await request(app).get("/api/articles?query=timeout&count=1");
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("Upstream news service unavailable");
  });

  it("returns 502 when provider returns invalid payload", async () => {
    mockGet.mockResolvedValueOnce({ data: { articles: "not-array" } });
    const res = await request(app).get("/api/articles?query=badpayload&count=1");
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("Invalid response from news provider");
  });

  it("returns 502 when provider returns an invalid article shape", async () => {
    mockGet.mockResolvedValueOnce({
      data: { articles: [{ ...sampleArticles[0], source: { name: "BBC" } }] },
    });
    const res = await request(app).get("/api/articles?query=badarticle&count=1");
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("Invalid response from news provider");
  });

  it("returns 502 when provider returns more articles than the API allows", async () => {
    const oversizedArticles = Array.from({ length: MAX_ARTICLE_COUNT + 1 }, (_, index) => ({
      ...sampleArticles[0],
      title: `Oversized article ${index}`,
    }));
    mockGet.mockResolvedValueOnce({ data: { articles: oversizedArticles } });

    const res = await request(app).get("/api/articles?query=oversized&count=100");

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("Invalid response from news provider");
  });

  it("GET /api/v1/articles returns structured errors", async () => {
    const res = await request(app).get("/api/v1/articles");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: {
        code: "missing_query_parameter",
        message: "Missing or empty query parameter: query",
      },
    });
    expect(typeof res.body.error.requestId).toBe("string");
  });

  it("opens the upstream circuit after repeated provider failures", async () => {
    mockGet.mockRejectedValue(new axios.AxiosError("timeout"));
    const q = `circuit-${Math.random().toString(36).slice(2)}`;

    await request(app).get(`/api/v1/articles?query=${encodeURIComponent(q)}&count=1`);
    await request(app).get(`/api/v1/articles?query=${encodeURIComponent(q)}&count=1`);
    await request(app).get(`/api/v1/articles?query=${encodeURIComponent(q)}&count=1`);
    const res = await request(app).get(`/api/v1/articles?query=${encodeURIComponent(q)}&count=1`);

    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({
      code: "upstream_circuit_open",
      message: "Upstream news service temporarily unavailable",
    });
    expect(mockGet).toHaveBeenCalledTimes(3);
  });

  it("does not open the circuit for permanent upstream client errors", async () => {
    mockGet.mockRejectedValue(axiosErrorWithStatus(401));
    const q = `circuit-client-error-${Math.random().toString(36).slice(2)}`;

    const responses = await Promise.all(
      [1, 2, 3, 4].map((suffix) =>
        request(app).get(`/api/v1/articles?query=${encodeURIComponent(`${q}-${suffix}`)}&count=1`)
      )
    );

    expect(responses.map((response) => response.status)).toEqual([502, 502, 502, 502]);
    expect(mockGet).toHaveBeenCalledTimes(4);
  });

  it("keeps circuit protection for upstream rate limits", async () => {
    mockGet.mockRejectedValue(axiosErrorWithStatus(429));
    const q = `circuit-rate-limit-${Math.random().toString(36).slice(2)}`;
    const statuses: number[] = [];

    for (const suffix of [1, 2, 3, 4]) {
      const response = await request(app).get(
        `/api/v1/articles?query=${encodeURIComponent(`${q}-${suffix}`)}&count=1`
      );
      statuses.push(response.status);
    }

    expect(statuses).toEqual([429, 429, 429, 503]);
    expect(mockGet).toHaveBeenCalledTimes(3);
  });

  it("exposes a safe Retry-After for upstream rate limits without retrying", async () => {
    vi.stubEnv("UPSTREAM_RETRY_ATTEMPTS", "3");
    mockGet.mockRejectedValue(
      axiosErrorWithStatus(429, {
        "retry-after": "120",
        "x-provider-secret": "do-not-forward",
      })
    );

    try {
      const v1 = await request(app).get(
        `/api/v1/articles?query=retry-after-v1-${Math.random().toString(36).slice(2)}&count=1`
      );
      const legacy = await request(app).get(
        `/api/articles?query=retry-after-legacy-${Math.random().toString(36).slice(2)}&count=1`
      );

      expect(v1.status).toBe(429);
      expect(v1.headers["retry-after"]).toBe("120");
      expect(v1.headers["x-provider-secret"]).toBeUndefined();
      expect(v1.body.error).toMatchObject({
        code: "upstream_rate_limited",
        message: "Upstream news service rate limit exceeded",
      });
      expect(legacy.status).toBe(429);
      expect(legacy.headers["retry-after"]).toBe("120");
      expect(legacy.body.error).toBe("Upstream news service rate limit exceeded");
      expect(mockGet).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("maps upstream 503 responses and caps Retry-After", async () => {
    vi.stubEnv("UPSTREAM_RETRY_ATTEMPTS", "0");
    mockGet.mockRejectedValueOnce(axiosErrorWithStatus(503, { "retry-after": "999999" }));

    try {
      const res = await request(app).get(
        `/api/v1/articles?query=retry-after-503-${Math.random().toString(36).slice(2)}&count=1`
      );

      expect(res.status).toBe(503);
      expect(res.headers["retry-after"]).toBe("86400");
      expect(res.body.error).toMatchObject({
        code: "upstream_unavailable",
        message: "Upstream news service temporarily unavailable",
      });
      expect(mockGet).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("allows only one recovery probe after the circuit cooldown", async () => {
    vi.stubEnv("UPSTREAM_CIRCUIT_COOLDOWN_MS", "10");
    mockGet.mockRejectedValue(new axios.AxiosError("timeout"));

    const q = `circuit-recovery-${Math.random().toString(36).slice(2)}`;
    await request(app).get(`/api/v1/articles?query=${encodeURIComponent(q)}-1&count=1`);
    await request(app).get(`/api/v1/articles?query=${encodeURIComponent(q)}-2&count=1`);
    await request(app).get(`/api/v1/articles?query=${encodeURIComponent(q)}-3&count=1`);

    await new Promise((resolve) => setTimeout(resolve, 20));
    mockGet.mockClear();
    mockGet.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ data: { articles: sampleArticles } }), 25);
        })
    );

    try {
      const [first, second] = await Promise.all([
        request(app).get(`/api/v1/articles?query=${encodeURIComponent(q)}-4&count=1`),
        request(app).get(`/api/v1/articles?query=${encodeURIComponent(q)}-5&count=1`),
      ]);

      expect([first.status, second.status].sort()).toEqual([200, 503]);
      expect(mockGet).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("falls back to the default circuit threshold for fractional configuration", async () => {
    vi.stubEnv("UPSTREAM_CIRCUIT_FAILURE_THRESHOLD", "0.5");
    mockGet
      .mockRejectedValueOnce(new axios.AxiosError("timeout"))
      .mockResolvedValueOnce({ data: { articles: sampleArticles } });

    try {
      const q = `circuit-config-${Math.random().toString(36).slice(2)}`;
      const first = await request(app).get(
        `/api/v1/articles?query=${encodeURIComponent(q)}-1&count=1`
      );
      const second = await request(app).get(
        `/api/v1/articles?query=${encodeURIComponent(q)}-2&count=1`
      );

      expect(first.status).toBe(502);
      expect(second.status).toBe(200);
      expect(mockGet).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("bounded memory cache", () => {
  beforeEach(() => {
    vi.stubEnv("CACHE_MAX_KEYS", "2");
    resetCacheStoreForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetCacheStoreForTests();
  });

  it("evicts the least recently used key at capacity", async () => {
    const store = getCacheStore();

    await store.set("first", sampleArticles);
    await store.set("second", sampleArticles);
    expect(await store.get("first")).toEqual(sampleArticles);

    await store.set("third", sampleArticles);

    expect(await store.get("first")).toEqual(sampleArticles);
    expect(await store.get("second")).toBeUndefined();
    expect(await store.get("third")).toEqual(sampleArticles);

    const metrics = await request(app).get("/metrics");
    expect(metrics.text).toContain("news_cache_evictions_total");
  });
});

describe("CLIENT_API_KEYS gate", () => {
  beforeEach(() => {
    mockGet.mockReset();
    resetCacheStoreForTests();
    resetGNewsCircuitForTests();
    httpBodyErrorsTotal.reset();
    vi.stubEnv("CLIENT_API_KEYS", "secret-one");
  });

  afterEach(() => {
    httpBodyErrorsTotal.reset();
    vi.unstubAllEnvs();
  });

  it("returns 401 for /api without X-API-Key", async () => {
    const res = await request(app).get("/api/articles?query=x&count=1");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid or missing API key");
  });

  it("allows /api with valid X-API-Key", async () => {
    mockGet.mockResolvedValueOnce({ data: { articles: sampleArticles } });
    const res = await request(app)
      .get("/api/articles?query=x&count=1")
      .set("X-API-Key", "secret-one");
    expect(res.status).toBe(200);
  });

  it("allows a later key in a rotation set", async () => {
    vi.stubEnv("CLIENT_API_KEYS", "retiring-key, current-key");
    mockGet.mockResolvedValueOnce({ data: { articles: sampleArticles } });

    const res = await request(app)
      .get("/api/articles?query=x&count=1")
      .set("X-API-Key", "current-key");

    expect(res.status).toBe(200);
  });

  it.each(["secret-on", "secret-one-extra", "secret-onf"])(
    "rejects a near-match API key: %s",
    async (providedKey) => {
      const res = await request(app)
        .get("/api/v1/articles?query=x&count=1")
        .set("X-API-Key", providedKey);

      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({
        error: {
          code: "invalid_api_key",
          message: "Invalid or missing API key",
        },
      });
      expect(mockGet).not.toHaveBeenCalled();
    }
  );

  it("treats byte-distinct Unicode keys as different secrets", async () => {
    vi.stubEnv("CLIENT_API_KEYS", "caf\u00e9-key");

    const res = await request(app)
      .get("/api/v1/articles?query=x&count=1")
      .set("X-API-Key", "caf\u00e8-key");

    expect(res.status).toBe(401);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("checks the API key before parsing a request body", async () => {
    const res = await request(app)
      .post("/api/v1/articles")
      .set("Content-Type", "application/json")
      .send('{"payload":');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      error: {
        code: "invalid_api_key",
        message: "Invalid or missing API key",
      },
    });

    const metrics = await request(app).get("/metrics");
    expect(metrics.text).not.toContain('news_http_body_errors_total{type="entity.parse.failed"}');
  });
});
