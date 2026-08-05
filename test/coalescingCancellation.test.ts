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

import { resetCacheStoreForTests } from "../src/cache/store";
import { resetGNewsCircuitForTests } from "../src/providers/gnewsProvider";
import {
  resetNewsServiceForTests,
  searchArticles,
} from "../src/services/newsService";
import { resetLifecycleForTests } from "../src/runtime/lifecycle";
import { RequestAbortedError } from "../src/runtime/requestCancellation";
import { sampleArticles } from "./fixtures/articles";

describe("coalesced request cancellation", () => {
  beforeEach(() => {
    mockGet.mockReset();
    resetCacheStoreForTests();
    resetGNewsCircuitForTests();
    resetNewsServiceForTests();
    resetLifecycleForTests();
  });

  afterEach(() => {
    resetNewsServiceForTests();
    resetLifecycleForTests();
  });

  it("does not cancel shared upstream work when one subscriber disconnects", async () => {
    let resolveUpstream: ((value: { data: { articles: typeof sampleArticles } }) => void) | undefined;
    let providerSignal: AbortSignal | undefined;
    mockGet.mockImplementation((_url: string, config: { signal: AbortSignal }) => {
      providerSignal = config.signal;
      return new Promise((resolve) => {
        resolveUpstream = resolve;
      });
    });

    const firstController = new AbortController();
    const secondController = new AbortController();
    const options = { query: "coalesced-cancellation", count: 1, page: 1 };
    const first = searchArticles(options, firstController.signal);
    await vi.waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));
    const second = searchArticles(options, secondController.signal);
    await new Promise<void>((resolve) => setImmediate(resolve));

    firstController.abort();
    await expect(first).rejects.toBeInstanceOf(RequestAbortedError);
    expect(providerSignal?.aborted).toBe(false);

    resolveUpstream?.({ data: { articles: sampleArticles } });
    await expect(second).resolves.toMatchObject({
      articles: sampleArticles,
      cache: "coalesced",
    });
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it("aborts the shared provider when every subscriber disconnects", async () => {
    let resolveUpstream: ((value: { data: { articles: typeof sampleArticles } }) => void) | undefined;
    let providerSignal: AbortSignal | undefined;
    mockGet.mockImplementation((_url: string, config: { signal: AbortSignal }) => {
      providerSignal = config.signal;
      return new Promise((resolve) => {
        resolveUpstream = resolve;
      });
    });

    const controller = new AbortController();
    const pending = searchArticles(
      { query: "all-subscribers-cancellation", count: 1, page: 1 },
      controller.signal
    );
    await vi.waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));

    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(RequestAbortedError);
    expect(providerSignal?.aborted).toBe(true);

    resolveUpstream?.({ data: { articles: sampleArticles } });
  });
});
