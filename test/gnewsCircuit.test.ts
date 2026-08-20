import axios from "axios";
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

import {
  GNewsProvider,
  resetGNewsCircuitForTests,
} from "../src/providers/gnewsProvider";
import { resetLifecycleForTests } from "../src/runtime/lifecycle";
import { RequestAbortedError } from "../src/runtime/requestCancellation";
import { sampleArticles } from "./fixtures/articles";

function axiosErrorWithStatus(status: number): axios.AxiosError {
  const error = new axios.AxiosError(`upstream ${status}`, "ERR_BAD_RESPONSE");
  Object.defineProperty(error, "response", { value: { status, headers: {} } });
  return error;
}

function searchOptions(query: string) {
  return { query, count: 1, page: 1 };
}

describe("GNews provider circuit recovery", () => {
  let now = 0;

  beforeEach(() => {
    now = 0;
    mockGet.mockReset();
    resetGNewsCircuitForTests();
    resetLifecycleForTests();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.stubEnv("UPSTREAM_CIRCUIT_FAILURE_THRESHOLD", "1");
    vi.stubEnv("UPSTREAM_CIRCUIT_COOLDOWN_MS", "1000");
    vi.stubEnv("UPSTREAM_RETRY_ATTEMPTS", "0");
  });

  afterEach(() => {
    resetGNewsCircuitForTests();
    resetLifecycleForTests();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("admits a new recovery probe after a canceled probe cooldown", async () => {
    const provider = new GNewsProvider();
    mockGet.mockRejectedValueOnce(new axios.AxiosError("timeout", "ECONNRESET"));

    await expect(provider.search(searchOptions("open-circuit"))).rejects.toMatchObject({
      statusCode: 502,
      code: "upstream_unavailable",
    });

    now = 1_000;
    const controller = new AbortController();
    mockGet.mockImplementationOnce(
      (_url: string, config: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          const rejectCanceled = () =>
            reject(new axios.AxiosError("canceled", "ERR_CANCELED"));
          if (config.signal.aborted) {
            rejectCanceled();
            return;
          }
          config.signal.addEventListener("abort", rejectCanceled, { once: true });
        })
    );

    const canceledProbe = provider.search(searchOptions("canceled-probe"), controller.signal);
    await vi.waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
    controller.abort();
    await expect(canceledProbe).rejects.toBeInstanceOf(RequestAbortedError);

    await expect(provider.search(searchOptions("during-new-cooldown"))).rejects.toMatchObject({
      statusCode: 503,
      code: "upstream_circuit_open",
    });
    expect(mockGet).toHaveBeenCalledTimes(2);

    now = 2_000;
    mockGet.mockResolvedValueOnce({ data: { articles: sampleArticles } });
    await expect(provider.search(searchOptions("next-probe"))).resolves.toEqual(sampleArticles);
    expect(mockGet).toHaveBeenCalledTimes(3);
  });

  it("releases a half-open probe after a permanent provider response", async () => {
    const provider = new GNewsProvider();
    mockGet.mockRejectedValueOnce(new axios.AxiosError("timeout", "ECONNRESET"));

    await expect(provider.search(searchOptions("open-circuit"))).rejects.toMatchObject({
      statusCode: 502,
      code: "upstream_unavailable",
    });

    now = 1_000;
    mockGet.mockRejectedValueOnce(axiosErrorWithStatus(401));
    await expect(provider.search(searchOptions("permanent-response"))).rejects.toMatchObject({
      statusCode: 502,
      code: "upstream_unavailable",
    });

    mockGet.mockResolvedValueOnce({ data: { articles: sampleArticles } });
    await expect(provider.search(searchOptions("after-permanent-response"))).resolves.toEqual(
      sampleArticles
    );
    expect(mockGet).toHaveBeenCalledTimes(3);
  });
});
