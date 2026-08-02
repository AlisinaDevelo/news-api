import { describe, it, expect } from "vitest";
import {
  parseArticleCount,
  parseArticlePage,
  parseArticleSearchFilters,
  requireQueryString,
} from "../src/utils/validation";
import { HttpError } from "../src/errors/HttpError";
import {
  DEFAULT_ARTICLE_COUNT,
  DEFAULT_ARTICLE_PAGE,
  MAX_ARTICLE_COUNT,
  MAX_ARTICLE_PAGE,
} from "../src/constants";

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

describe("parseArticlePage", () => {
  it("defaults when omitted", () => {
    expect(parseArticlePage(undefined)).toBe(DEFAULT_ARTICLE_PAGE);
    expect(parseArticlePage("")).toBe(DEFAULT_ARTICLE_PAGE);
  });

  it("parses valid page numbers", () => {
    expect(parseArticlePage("5")).toBe(5);
  });

  it("caps at max", () => {
    expect(parseArticlePage(String(MAX_ARTICLE_PAGE + 50))).toBe(MAX_ARTICLE_PAGE);
  });

  it("rejects non-positive pages", () => {
    expect(() => parseArticlePage("0")).toThrow(HttpError);
    expect(() => parseArticlePage("-1")).toThrow(HttpError);
    expect(() => parseArticlePage("nope")).toThrow(HttpError);
    expect(() => parseArticlePage("2.5")).toThrow(HttpError);
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

describe("parseArticleSearchFilters", () => {
  it("normalizes language, country, dates, and sort", () => {
    expect(
      parseArticleSearchFilters({
        lang: "EN",
        country: "Us",
        from: "2026-01-01T00:00:00Z",
        to: "2026-01-02T00:00:00Z",
        sortBy: "publishedAt",
      })
    ).toEqual({
      lang: "en",
      country: "us",
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-02T00:00:00.000Z",
      sortBy: "publishedAt",
    });
  });

  it("accepts GNews-style sortby casing", () => {
    expect(parseArticleSearchFilters({ sortby: "relevance" })).toEqual({
      sortBy: "relevance",
    });
  });

  it("rejects invalid filter values", () => {
    expect(() => parseArticleSearchFilters({ lang: "eng" })).toThrow(HttpError);
    expect(() => parseArticleSearchFilters({ country: "1t" })).toThrow(HttpError);
    expect(() => parseArticleSearchFilters({ from: "not-a-date" })).toThrow(HttpError);
    expect(() => parseArticleSearchFilters({ sortBy: "popular" })).toThrow(HttpError);
    expect(() =>
      parseArticleSearchFilters({
        from: "2026-01-02T00:00:00Z",
        to: "2026-01-01T00:00:00Z",
      })
    ).toThrow(HttpError);
  });
});
