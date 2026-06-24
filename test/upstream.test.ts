import { describe, expect, it } from "vitest";
import { resolveUpstreamBaseUrl } from "../src/config/upstream";

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
