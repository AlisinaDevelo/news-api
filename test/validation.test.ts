import { describe, it, expect } from "vitest";
import { parseArticleCount, requireQueryString } from "../src/utils/validation";
import { HttpError } from "../src/errors/HttpError";
import { DEFAULT_ARTICLE_COUNT, MAX_ARTICLE_COUNT } from "../src/constants";

describe("parseArticleCount", () => {
  it("defaults when omitted", () => {
    expect(parseArticleCount(undefined)).toBe(DEFAULT_ARTICLE_COUNT);
    expect(parseArticleCount("")).toBe(DEFAULT_ARTICLE_COUNT);
  });

  it("parses valid integer", () => {
    expect(parseArticleCount("5")).toBe(5);
  });

  it("caps at max", () => {
    expect(parseArticleCount(String(MAX_ARTICLE_COUNT + 50))).toBe(MAX_ARTICLE_COUNT);
  });

  it("rejects non-positive", () => {
    expect(() => parseArticleCount("0")).toThrow(HttpError);
    expect(() => parseArticleCount("-1")).toThrow(HttpError);
    expect(() => parseArticleCount("nope")).toThrow(HttpError);
  });
});

describe("requireQueryString", () => {
  it("returns trimmed string", () => {
    expect(requireQueryString("  tech  ", "query")).toBe("tech");
  });

  it("rejects empty", () => {
    expect(() => requireQueryString("", "query")).toThrow(HttpError);
    expect(() => requireQueryString("   ", "query")).toThrow(HttpError);
    expect(() => requireQueryString(undefined, "query")).toThrow(HttpError);
  });
});
