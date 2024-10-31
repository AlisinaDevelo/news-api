import { DEFAULT_ARTICLE_COUNT, MAX_ARTICLE_COUNT } from "../constants";
import { HttpError } from "../errors/HttpError";

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
