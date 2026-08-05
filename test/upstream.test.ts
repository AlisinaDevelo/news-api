import { describe, expect, it } from "vitest";
import {
  resolveUpstreamBaseUrl,
  resolveUpstreamTotalTimeoutMs,
} from "../src/config/upstream";

describe("resolveUpstreamBaseUrl", () => {
  it("defaults to GNews", () => {
    expect(resolveUpstreamBaseUrl("")).toBe("https://gnews.io/api/v4");
    expect(resolveUpstreamBaseUrl(undefined)).toBe("https://gnews.io/api/v4");
  });

  it("trims trailing slashes from custom upstreams", () => {
    expect(resolveUpstreamBaseUrl(" http://127.0.0.1:4000/api/v4/// ")).toBe(
      "http://127.0.0.1:4000/api/v4"
    );
  });
});

describe("resolveUpstreamTotalTimeoutMs", () => {
  it("uses a bounded total deadline", () => {
    expect(resolveUpstreamTotalTimeoutMs(undefined)).toBe(60_000);
    expect(resolveUpstreamTotalTimeoutMs("120000")).toBe(120_000);
    expect(resolveUpstreamTotalTimeoutMs("120001")).toBe(120_000);
    expect(resolveUpstreamTotalTimeoutMs("0")).toBe(60_000);
    expect(resolveUpstreamTotalTimeoutMs("1.5")).toBe(60_000);
  });
});
