import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
import { resetCacheStoreForTests, setCacheStoreForTests } from "../src/cache/store";
import { resetGNewsCircuitForTests } from "../src/providers/gnewsProvider";

describe("app", () => {
  beforeEach(() => {
    mockGet.mockReset();
    resetCacheStoreForTests();
    resetGNewsCircuitForTests();
  });

  it("GET /health returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok" });
    expect(typeof res.body.uptime).toBe("number");
  });

  it("GET /ready returns ready in test", async () => {
    const res = await request(app).get("/ready");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ready" });
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
      })
    );
  });

  it("GET /api/v1/articles returns an enveloped search response", async () => {
    mockGet.mockResolvedValueOnce({ data: { articles: sampleArticles } });
    const res = await request(app).get("/api/v1/articles?query=tech&count=2&lang=EN");

    expect(res.status).toBe(200);
    expect(res.headers["x-api-version"]).toBe("v1");
    expect(res.headers["x-cache-status"]).toBe("miss");
    expect(res.body).toMatchObject({
      data: sampleArticles,
      meta: {
        query: "tech",
        count: 2,
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
      "/api/articles?query=tech&count=2&lang=EN&country=us&from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z&sortBy=relevance"
    );
    expect(res.status).toBe(200);
    expect(mockGet).toHaveBeenCalledWith(
      "https://gnews.io/api/v4/search",
      expect.objectContaining({
        params: expect.objectContaining({
          q: "tech",
          max: 2,
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
    });
    mockGet.mockResolvedValueOnce({ data: { articles: sampleArticles } });

    const q = `cache-get-fails-${Math.random().toString(36).slice(2)}`;
    const res = await request(app).get(`/api/articles?query=${encodeURIComponent(q)}&count=2`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(sampleArticles);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it("returns upstream response when cache set fails", async () => {
    setCacheStoreForTests({
      async get() {
        return undefined;
      },
      async set() {
        throw new Error("cache write failed");
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
    const res = await request(app).get("/api/v1/sources/BBC/articles?count=10");

    expect(res.status).toBe(200);
    expect(res.headers["x-api-version"]).toBe("v1");
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].source.name).toBe("BBC");
    expect(res.body.meta).toMatchObject({ source: "BBC", count: 10 });
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
});

describe("CLIENT_API_KEYS gate", () => {
  beforeEach(() => {
    mockGet.mockReset();
    resetCacheStoreForTests();
    resetGNewsCircuitForTests();
    vi.stubEnv("CLIENT_API_KEYS", "secret-one");
  });

  afterEach(() => {
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
});
