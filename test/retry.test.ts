import axios from "axios";
import { describe, expect, it } from "vitest";
import { isRetryableUpstreamError } from "../src/providers/retry";

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
