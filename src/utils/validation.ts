import { DEFAULT_ARTICLE_COUNT, MAX_ARTICLE_COUNT } from "../constants";
import { HttpError } from "../errors/HttpError";
import { ArticleSearchFilters, ArticleSortBy } from "../types/search";

const SORT_VALUES = new Set<ArticleSortBy>(["publishedAt", "relevance"]);

export function parseArticleCount(raw: unknown): number {
  if (raw === undefined || raw === null || raw === "") {
    return DEFAULT_ARTICLE_COUNT;
  }
  const n = parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new HttpError(400, "count must be a positive integer");
  }
  return Math.min(n, MAX_ARTICLE_COUNT);
}

export function requireQueryString(value: unknown, fieldName: string): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) {
    throw new HttpError(400, `Missing or empty query parameter: ${fieldName}`);
  }
  return s;
}

function optionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new HttpError(400, `${fieldName} must be a string`);
  }
  const s = value.trim();
  if (!s) {
    return undefined;
  }
  return s;
}

function parseTwoLetterCode(value: unknown, fieldName: "lang" | "country"): string | undefined {
  const s = optionalString(value, fieldName);
  if (!s) {
    return undefined;
  }
  if (!/^[a-z]{2}$/i.test(s)) {
    throw new HttpError(400, `${fieldName} must be a two-letter code`);
  }
  return s.toLowerCase();
}

function parseIsoDate(value: unknown, fieldName: "from" | "to"): string | undefined {
  const s = optionalString(value, fieldName);
  if (!s) {
    return undefined;
  }
  const timestamp = Date.parse(s);
  if (!Number.isFinite(timestamp)) {
    throw new HttpError(400, `${fieldName} must be an ISO 8601 date`);
  }
  return new Date(timestamp).toISOString();
}

function parseSortBy(value: unknown): ArticleSortBy | undefined {
  const s = optionalString(value, "sortBy");
  if (!s) {
    return undefined;
  }
  if (!SORT_VALUES.has(s as ArticleSortBy)) {
    throw new HttpError(400, "sortBy must be one of: publishedAt, relevance");
  }
  return s as ArticleSortBy;
}

export function parseArticleSearchFilters(query: Record<string, unknown>): ArticleSearchFilters {
  const from = parseIsoDate(query.from, "from");
  const to = parseIsoDate(query.to, "to");

  if (from && to && Date.parse(from) > Date.parse(to)) {
    throw new HttpError(400, "from must be before or equal to to");
  }

  const sortBy = parseSortBy(query.sortBy ?? query.sortby);

  return {
    lang: parseTwoLetterCode(query.lang, "lang"),
    country: parseTwoLetterCode(query.country, "country"),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(sortBy ? { sortBy } : {}),
  };
}
