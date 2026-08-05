import { describe, expect, it } from "vitest";
import { normalizeRetryAfter, retryAfterFromHeaders } from "../src/http/retryAfter";

describe("normalizeRetryAfter", () => {
  it("keeps valid delta-seconds values", () => {
    expect(normalizeRetryAfter("120")).toBe("120");
  });

  it("converts HTTP dates to bounded delta-seconds", () => {
    const now = Date.parse("Wed, 21 Oct 2015 07:28:00 GMT");
    expect(normalizeRetryAfter("Wed, 21 Oct 2015 07:28:45 GMT", now)).toBe("45");
    expect(normalizeRetryAfter("Wed, 21 Oct 2015 07:27:00 GMT", now)).toBe("0");
  });

  it("rejects malformed values and caps excessive delays", () => {
    expect(normalizeRetryAfter("later")).toBeUndefined();
    expect(normalizeRetryAfter("999999")).toBe("86400");
    expect(normalizeRetryAfter("-1")).toBeUndefined();
  });
});

describe("retryAfterFromHeaders", () => {
  it("supports AxiosHeaders-like accessors and plain headers", () => {
    expect(
      retryAfterFromHeaders({
        get: () => "30",
      })
    ).toBe("30");
    expect(retryAfterFromHeaders({ "retry-after": "60" })).toBe("60");
  });

  it("does not accept arbitrary header values", () => {
    expect(retryAfterFromHeaders({ "retry-after": ["bad", "30"] })).toBeUndefined();
    expect(retryAfterFromHeaders({ "x-provider-secret": "hidden" })).toBeUndefined();
  });
});
