import axios from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isRetryableUpstreamError } from "../src/providers/retry";
import { withUpstreamRetries } from "../src/providers/retry";
import { RequestAbortedError } from "../src/runtime/requestCancellation";

describe("isRetryableUpstreamError", () => {
  it("accepts transient network errors", () => {
    expect(isRetryableUpstreamError(new axios.AxiosError("connection reset", "ECONNRESET"))).toBe(
      true
    );
  });

  it("does not retry non-transient client errors or internal errors", () => {
    expect(isRetryableUpstreamError(new axios.AxiosError("bad request", "ERR_BAD_REQUEST"))).toBe(
      false
    );
    expect(isRetryableUpstreamError(new Error("internal failure"))).toBe(false);
  });
});

describe("withUpstreamRetries cancellation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("interrupts a retry delay when the signal aborts", async () => {
    vi.stubEnv("UPSTREAM_RETRY_ATTEMPTS", "1");
    vi.stubEnv("UPSTREAM_RETRY_BASE_DELAY_MS", "2000");
    const controller = new AbortController();
    const operation = vi
      .fn()
      .mockRejectedValue(new axios.AxiosError("network failure", "ECONNRESET"));

    const retrying = withUpstreamRetries(operation, controller.signal);
    await vi.waitFor(() => expect(operation).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(retrying).rejects.toBeInstanceOf(RequestAbortedError);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
