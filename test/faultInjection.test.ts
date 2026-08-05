import axios from "axios";
import request, { type Response } from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import app from "../src/app";
import { CacheCorruptionError, resetCacheStoreForTests, setCacheStoreForTests } from "../src/cache/store";
import { resetGNewsCircuitForTests } from "../src/providers/gnewsProvider";
import { resetNewsServiceForTests, searchArticles } from "../src/services/newsService";
import { register } from "../src/metrics/register";
import { sampleArticles } from "./fixtures/articles";

function axiosErrorWithStatus(
  status: number,
  headers: Record<string, string> = {}
): axios.AxiosError {
  const error = new axios.AxiosError(`upstream ${status}`, "ERR_BAD_RESPONSE");
  Object.defineProperty(error, "response", { value: { status, headers } });
  return error;
}

interface FaultCase {
  name: string;
  route?: "/api/articles" | "/api/v1/articles";
  configure: () => void;
  expectedStatus: number;
  assertResponse?: (response: Response) => void;
}

const toleratedFaults: FaultCase[] = [
  {
    name: "cache read failure",
    configure: () => {
      setCacheStoreForTests({
        async get() {
          throw new Error("cache unavailable");
        },
        async set() {},
        async delete() {},
      });
      mockGet.mockResolvedValueOnce({ data: { articles: sampleArticles } });
    },
    expectedStatus: 200,
  },
  {
    name: "invalid fresh cache payload",
    configure: () => {
      setCacheStoreForTests({
        async get() {
          return { invalid: true };
        },
        async set() {},
        async delete() {},
      });
      mockGet.mockResolvedValueOnce({ data: { articles: sampleArticles } });
    },
    expectedStatus: 200,
  },
  {
    name: "malformed Redis cache value",
    configure: () => {
      setCacheStoreForTests({
        async get() {
          throw new CacheCorruptionError("invalid JSON in Redis cache entry");
        },
        async set() {},
        async delete() {},
      });
      mockGet.mockResolvedValueOnce({ data: { articles: sampleArticles } });
    },
    expectedStatus: 200,
  },
  {
    name: "cache write failure",
    configure: () => {
      setCacheStoreForTests({
        async get() {
          return undefined;
        },
        async set() {
          throw new Error("cache write failed");
        },
        async delete() {},
      });
      mockGet.mockResolvedValueOnce({ data: { articles: sampleArticles } });
    },
    expectedStatus: 200,
  },
  {
    name: "stale cache fallback",
    route: "/api/v1/articles",
    configure: () => {
      setCacheStoreForTests({
        async get(key) {
          return key.endsWith(":stale") ? sampleArticles : undefined;
        },
        async set() {},
        async delete() {},
      });
      mockGet.mockRejectedValueOnce(new axios.AxiosError("timeout"));
    },
    expectedStatus: 200,
    assertResponse: (response) => {
      expect(response.body.meta).toMatchObject({ cache: "stale" });
      expect(response.headers["x-cache-status"]).toBe("stale");
    },
  },
  {
    name: "invalid stale cache payload",
    route: "/api/v1/articles",
    configure: () => {
      setCacheStoreForTests({
        async get(key) {
          return key.endsWith(":stale") ? { invalid: true } : undefined;
        },
        async set() {},
        async delete() {},
      });
      mockGet.mockRejectedValueOnce(new axios.AxiosError("timeout"));
    },
    expectedStatus: 502,
    assertResponse: (response) => {
      expect(response.body.error).toMatchObject({ code: "upstream_unavailable" });
    },
  },
  {
    name: "upstream network failure",
    route: "/api/v1/articles",
    configure: () => {
      vi.stubEnv("UPSTREAM_RETRY_ATTEMPTS", "0");
      mockGet.mockRejectedValueOnce(new axios.AxiosError("connection reset", "ECONNRESET"));
    },
    expectedStatus: 502,
    assertResponse: (response) => {
      expect(response.body.error).toMatchObject({ code: "upstream_unavailable" });
    },
  },
  {
    name: "invalid upstream payload",
    route: "/api/v1/articles",
    configure: () => {
      mockGet.mockResolvedValueOnce({ data: { articles: "not-an-array" } });
    },
    expectedStatus: 502,
    assertResponse: (response) => {
      expect(response.body.error).toMatchObject({ code: "invalid_provider_payload" });
    },
  },
  {
    name: "upstream rate limit",
    route: "/api/v1/articles",
    configure: () => {
      vi.stubEnv("UPSTREAM_RETRY_ATTEMPTS", "3");
      mockGet.mockRejectedValueOnce(axiosErrorWithStatus(429, { "retry-after": "30" }));
    },
    expectedStatus: 429,
    assertResponse: (response) => {
      expect(response.headers["retry-after"]).toBe("30");
      expect(response.body.error).toMatchObject({ code: "upstream_rate_limited" });
    },
  },
  {
    name: "upstream unavailable with bounded retry hint",
    route: "/api/v1/articles",
    configure: () => {
      vi.stubEnv("UPSTREAM_RETRY_ATTEMPTS", "0");
      mockGet.mockRejectedValueOnce(axiosErrorWithStatus(503, { "retry-after": "999999" }));
    },
    expectedStatus: 503,
    assertResponse: (response) => {
      expect(response.headers["retry-after"]).toBe("86400");
      expect(response.body.error).toMatchObject({ code: "upstream_unavailable" });
    },
  },
  {
    name: "permanent upstream client error",
    route: "/api/v1/articles",
    configure: () => {
      mockGet.mockRejectedValueOnce(axiosErrorWithStatus(401));
    },
    expectedStatus: 502,
    assertResponse: (response) => {
      expect(response.body.error).toMatchObject({ code: "upstream_unavailable" });
    },
  },
  {
    name: "retry budget is bounded",
    route: "/api/v1/articles",
    configure: () => {
      vi.stubEnv("UPSTREAM_RETRY_ATTEMPTS", "3");
      vi.stubEnv("UPSTREAM_RETRY_BASE_DELAY_MS", "1");
      mockGet.mockRejectedValue(new axios.AxiosError("connection reset", "ECONNRESET"));
    },
    expectedStatus: 502,
    assertResponse: () => {
      expect(mockGet).toHaveBeenCalledTimes(4);
    },
  },
];

describe("degraded-mode fault matrix", () => {
  beforeEach(() => {
    mockGet.mockReset();
    resetCacheStoreForTests();
    resetGNewsCircuitForTests();
    resetNewsServiceForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    resetCacheStoreForTests();
    resetGNewsCircuitForTests();
    resetNewsServiceForTests();
  });

  it.each(toleratedFaults)("$name has a bounded public outcome", async (faultCase) => {
    faultCase.configure();
    const route = faultCase.route ?? "/api/articles";
    const query = encodeURIComponent(`fault-${faultCase.name}-${Date.now()}`);
    const response = await request(app).get(`${route}?query=${query}&count=1`);

    expect(response.status).toBe(faultCase.expectedStatus);
    faultCase.assertResponse?.(response);
  });

  it("opens the circuit and stops making provider calls after the threshold", async () => {
    vi.stubEnv("UPSTREAM_RETRY_ATTEMPTS", "0");
    mockGet.mockRejectedValue(new axios.AxiosError("connection reset", "ECONNRESET"));
    const statuses: number[] = [];

    for (const attempt of [1, 2, 3, 4]) {
      const response = await request(app).get(
        `/api/v1/articles?query=fault-circuit-${attempt}-${Date.now()}&count=1`
      );
      statuses.push(response.status);
    }

    expect(statuses).toEqual([502, 502, 502, 503]);
    expect(mockGet).toHaveBeenCalledTimes(3);
  });

  it("maps total upstream deadline exhaustion to a transient provider failure", async () => {
    vi.useFakeTimers();
    vi.stubEnv("UPSTREAM_CIRCUIT_FAILURE_THRESHOLD", "1");
    mockGet.mockImplementation((_url: string, config: { signal: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        config.signal.addEventListener(
          "abort",
          () => reject(new axios.AxiosError("deadline", "ERR_CANCELED")),
          { once: true }
        );
      });
    });

    const pending = searchArticles({
      query: `fault-total-deadline-${Date.now()}`,
      count: 1,
      page: 1,
    });
    await vi.waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));
    vi.advanceTimersByTime(60_000);

    await expect(pending).rejects.toMatchObject({
      statusCode: 502,
      code: "upstream_unavailable",
    });
    expect(mockGet).toHaveBeenCalledTimes(1);
    const metrics = await register.metrics();
    expect(metrics).toContain('news_upstream_requests_total{outcome="timeout"}');
    expect(metrics).toContain('news_upstream_circuit_events_total{event="opened"}');
    vi.useRealTimers();
  });
});
