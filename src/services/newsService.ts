import { isArticleList, type Article } from "../types/article";
import { CacheCorruptionError, CacheStore, getCacheStore } from "../cache/store";
import { resolvePositiveIntegerEnv } from "../config/numbers";
import { ArticleSearchFilters, ArticleSearchOptions } from "../types/search";
import { cacheErrorsTotal, cacheEventsTotal } from "../metrics/register";
import { logger } from "../logger";
import { newsProvider } from "../providers/gnewsProvider";
import { markSpanError, withSpan } from "../tracing";

const inFlightSearches = new Map<string, Promise<ArticleSearchResult>>();
const STALE_CACHE_TTL_SEC = resolveStaleCacheTtlSec();

export type ArticleSearchCacheStatus = "hit" | "miss" | "coalesced" | "stale";

export interface ArticleSearchResult {
  articles: Article[];
  cache: ArticleSearchCacheStatus;
}

function searchCacheKey(options: ArticleSearchOptions): string {
  return JSON.stringify({
    query: options.query,
    count: options.count,
    page: options.page,
    lang: options.lang ?? null,
    country: options.country ?? null,
    from: options.from ?? null,
    to: options.to ?? null,
    sortBy: options.sortBy ?? null,
  });
}

function staleCacheKey(cacheKey: string): string {
  return `${cacheKey}:stale`;
}

function resolveStaleCacheTtlSec(): number {
  const configured = resolvePositiveIntegerEnv(process.env.STALE_CACHE_TTL_SEC, 3_600, 86_400);
  return configured > 600 ? configured : 3_600;
}

async function readCachedArticles(
  store: CacheStore,
  cacheKey: string
): Promise<ArticleSearchResult | undefined> {
  return withSpan("news.cache.lookup", { "news.cache.kind": "fresh" }, async (span) => {
    let cached: unknown | undefined;
    try {
      cached = await store.get(cacheKey);
    } catch (err) {
      span.setAttribute("news.cache.result", "error");
      markSpanError(span, err, "cache_get_failed");
      cacheEventsTotal.inc({ result: "error" });
      cacheErrorsTotal.inc({ operation: "get" });
      logger.warn({ err }, "cache get failed; falling through to upstream");
      if (err instanceof CacheCorruptionError) {
        await deleteCorruptCacheEntry(store, cacheKey, "delete");
      }
      return undefined;
    }

    if (cached !== undefined) {
      if (!isArticleList(cached)) {
        span.setAttribute("news.cache.result", "invalid");
        markSpanError(span, new Error("invalid cached article payload"), "cache_payload_invalid");
        cacheEventsTotal.inc({ result: "error" });
        cacheErrorsTotal.inc({ operation: "get" });
        logger.warn(
          { err: new Error("invalid cached article payload") },
          "cache payload is invalid"
        );
        await deleteCorruptCacheEntry(store, cacheKey, "delete");
        return undefined;
      }
      span.setAttribute("news.cache.result", "hit");
      cacheEventsTotal.inc({ result: "hit" });
      return { articles: cached, cache: "hit" };
    }

    span.setAttribute("news.cache.result", "miss");
    cacheEventsTotal.inc({ result: "miss" });
    return undefined;
  });
}

async function readStaleCachedArticles(
  store: CacheStore,
  cacheKey: string
): Promise<ArticleSearchResult | undefined> {
  return withSpan("news.cache.lookup", { "news.cache.kind": "stale" }, async (span) => {
    const staleKey = staleCacheKey(cacheKey);
    let cached: unknown | undefined;
    try {
      cached = await store.get(staleKey);
    } catch (err) {
      span.setAttribute("news.cache.result", "error");
      markSpanError(span, err, "stale_cache_get_failed");
      cacheErrorsTotal.inc({ operation: "get_stale" });
      logger.warn({ err }, "stale cache get failed; returning upstream error");
      if (err instanceof CacheCorruptionError) {
        await deleteCorruptCacheEntry(store, staleKey, "delete_stale");
      }
      return undefined;
    }

    if (cached !== undefined) {
      if (!isArticleList(cached)) {
        span.setAttribute("news.cache.result", "invalid");
        markSpanError(
          span,
          new Error("invalid stale cached article payload"),
          "stale_cache_payload_invalid"
        );
        cacheErrorsTotal.inc({ operation: "get_stale" });
        logger.warn(
          { err: new Error("invalid stale cached article payload") },
          "stale cache payload is invalid"
        );
        await deleteCorruptCacheEntry(store, staleKey, "delete_stale");
        return undefined;
      }
      span.setAttribute("news.cache.result", "stale");
      cacheEventsTotal.inc({ result: "stale" });
      return { articles: cached, cache: "stale" };
    }

    span.setAttribute("news.cache.result", "miss");
    return undefined;
  });
}

async function deleteCorruptCacheEntry(
  store: CacheStore,
  key: string,
  operation: "delete" | "delete_stale"
): Promise<void> {
  try {
    await store.delete(key);
  } catch (err) {
    cacheErrorsTotal.inc({ operation });
    logger.warn({ err }, "cache corruption quarantine failed; continuing without cache entry");
  }
}

async function writeCachedArticles(
  store: CacheStore,
  cacheKey: string,
  articles: Article[]
): Promise<void> {
  await withSpan("news.cache.write", { "news.cache.kind": "fresh" }, async (span) => {
    try {
      await store.set(cacheKey, articles);
      span.setAttribute("news.cache.result", "success");
    } catch (err) {
      span.setAttribute("news.cache.result", "error");
      markSpanError(span, err, "cache_set_failed");
      cacheErrorsTotal.inc({ operation: "set" });
      logger.warn({ err }, "cache set failed; returning upstream response without caching");
    }
  });

  await withSpan("news.cache.write", { "news.cache.kind": "stale" }, async (span) => {
    try {
      await store.set(staleCacheKey(cacheKey), articles, STALE_CACHE_TTL_SEC);
      span.setAttribute("news.cache.result", "success");
    } catch (err) {
      span.setAttribute("news.cache.result", "error");
      markSpanError(span, err, "stale_cache_set_failed");
      cacheErrorsTotal.inc({ operation: "set_stale" });
      logger.warn({ err }, "stale cache set failed; returning upstream response without stale copy");
    }
  });
}

async function fetchArticlesFromUpstream(
  options: ArticleSearchOptions,
  store: CacheStore,
  cacheKey: string
): Promise<ArticleSearchResult> {
  let articles: Article[];
  try {
    articles = await newsProvider.search(options);
  } catch (err) {
    return withSpan(
      "news.cache.stale_fallback",
      { "news.fallback.reason": "upstream_error" },
      async (span) => {
        const stale = await readStaleCachedArticles(store, cacheKey);
        if (stale) {
          span.setAttribute("news.fallback.result", "served");
          logger.warn({ err }, "upstream failed; returning stale cached articles");
          return stale;
        }
        span.setAttribute("news.fallback.result", "unavailable");
        throw err;
      }
    );
  }

  await writeCachedArticles(store, cacheKey, articles);
  return { articles, cache: "miss" };
}

export const searchArticles = async (
  options: ArticleSearchOptions
): Promise<ArticleSearchResult> =>
  withSpan("news.search", {}, async (span) => {
    const cacheKey = searchCacheKey(options);
    const store = getCacheStore();
    const cached = await readCachedArticles(store, cacheKey);
    if (cached) {
      span.setAttribute("news.search.cache", cached.cache);
      return cached;
    }

    const existing = inFlightSearches.get(cacheKey);
    if (existing) {
      cacheEventsTotal.inc({ result: "coalesced" });
      const result = await existing;
      const coalesced = { ...result, cache: result.cache === "miss" ? "coalesced" : result.cache };
      span.setAttribute("news.search.cache", coalesced.cache);
      return coalesced;
    }

    const search = fetchArticlesFromUpstream(options, store, cacheKey);
    inFlightSearches.set(cacheKey, search);
    try {
      const result = await search;
      span.setAttribute("news.search.cache", result.cache);
      return result;
    } finally {
      inFlightSearches.delete(cacheKey);
    }
  });

export const fetchArticles = async (options: ArticleSearchOptions): Promise<Article[]> => {
  const result = await searchArticles(options);
  return result.articles;
};

export const fetchArticlesByTitle = async (title: string): Promise<Article | undefined> => {
  const articles = await fetchArticles({ query: title, count: 10, page: 1 });
  return articles.find((article) => article.title === title);
};

export const fetchArticlesBySource = async (
  sourceName: string,
  count: number,
  filters: ArticleSearchFilters = {},
  page = 1
): Promise<Article[]> => {
  const articles = await fetchArticles({ query: sourceName, count, page, ...filters });
  const target = sourceName.toLowerCase();
  return articles.filter((article) => article.source.name.toLowerCase() === target);
};
