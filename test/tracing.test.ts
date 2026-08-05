import { trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import axios from "axios";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

import { resetCacheStoreForTests, setCacheStoreForTests, type CacheStore } from "../src/cache/store";
import { resetGNewsCircuitForTests } from "../src/providers/gnewsProvider";
import { searchArticles } from "../src/services/newsService";
import { sampleArticles } from "./fixtures/articles";

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});

function axiosErrorWithStatus(status: number): axios.AxiosError {
  const error = new axios.AxiosError(`upstream ${status}`, "ERR_BAD_RESPONSE");
  Object.defineProperty(error, "response", { value: { status, headers: {} } });
  return error;
}

function spanByName(name: string) {
  return exporter.getFinishedSpans().find((span) => span.name === name);
}

describe("business tracing", () => {
  beforeAll(() => {
    expect(trace.setGlobalTracerProvider(provider)).toBe(true);
  });

  beforeEach(() => {
    exporter.reset();
    mockGet.mockReset();
    resetCacheStoreForTests();
    resetGNewsCircuitForTests();
    vi.stubEnv("UPSTREAM_RETRY_ATTEMPTS", "0");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await provider.shutdown();
    trace.disable();
  });

  it("emits a low-cardinality search and cache span hierarchy", async () => {
    mockGet.mockResolvedValue({ data: { articles: sampleArticles } });

    const result = await searchArticles({
      query: "secret query that must not enter telemetry",
      count: 10,
      page: 1,
    });

    expect(result.cache).toBe("miss");
    expect(spanByName("news.search")?.attributes["news.search.cache"]).toBe("miss");
    expect(spanByName("news.upstream.circuit")?.attributes["news.circuit.state"]).toBe("closed");
    expect(spanByName("news.upstream.request")?.attributes).toMatchObject({
      "news.upstream.provider": "gnews",
      "news.upstream.outcome": "success",
    });
    expect(
      exporter
        .getFinishedSpans()
        .filter((span) => span.name === "news.cache.lookup")
        .some((span) => span.attributes["news.cache.result"] === "miss")
    ).toBe(true);
    expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual(
      expect.arrayContaining(["news.cache.write"])
    );

    const encodedSpans = JSON.stringify(
      exporter.getFinishedSpans().map((span) => ({ name: span.name, attributes: span.attributes }))
    );
    expect(encodedSpans).not.toContain("secret query that must not enter telemetry");
    expect(encodedSpans).not.toContain("gnews.io");
  });

  it("records retry decisions without copying upstream error details", async () => {
    vi.stubEnv("UPSTREAM_RETRY_ATTEMPTS", "1");
    vi.stubEnv("UPSTREAM_RETRY_BASE_DELAY_MS", "1");
    mockGet
      .mockRejectedValueOnce(axiosErrorWithStatus(503))
      .mockResolvedValueOnce({ data: { articles: sampleArticles } });

    await searchArticles({ query: "retry-query", count: 10, page: 1 });

    expect(spanByName("news.upstream.retry")?.attributes).toMatchObject({
      "news.retry.attempt": 1,
      "news.retry.reason": "http_503",
    });
  });

  it("traces stale fallback as a bounded business outcome", async () => {
    const store: CacheStore = {
      async get(key) {
        return key.endsWith(":stale") ? sampleArticles : undefined;
      },
      async set() {},
      async delete() {},
    };
    setCacheStoreForTests(store);
    mockGet.mockRejectedValue(axiosErrorWithStatus(503));

    const result = await searchArticles({ query: "stale-query", count: 10, page: 1 });

    expect(result.cache).toBe("stale");
    expect(spanByName("news.cache.stale_fallback")?.attributes).toMatchObject({
      "news.fallback.reason": "upstream_error",
      "news.fallback.result": "served",
    });
    expect(
      exporter
        .getFinishedSpans()
        .filter((span) => span.name === "news.cache.lookup")
        .some((span) => span.attributes["news.cache.kind"] === "stale")
    ).toBe(true);
  });
});
