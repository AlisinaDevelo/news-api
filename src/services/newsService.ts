import { Article } from "../types/article";
import { CacheStore, getCacheStore } from "../cache/store";
import { ArticleSearchFilters, ArticleSearchOptions } from "../types/search";
import { cacheErrorsTotal, cacheEventsTotal } from "../metrics/register";
import { logger } from "../logger";
import { newsProvider } from "../providers/gnewsProvider";

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
  const raw = Number(process.env.STALE_CACHE_TTL_SEC ?? 3_600);
  return Number.isFinite(raw) && raw > 600 ? Math.min(Math.floor(raw), 86_400) : 3_600;
}

async function readCachedArticles(
  store: CacheStore,
  cacheKey: string
): Promise<ArticleSearchResult | undefined> {
  try {
    const cached = await store.get(cacheKey);
    if (cached !== undefined) {
      cacheEventsTotal.inc({ result: "hit" });
      return { articles: cached as Article[], cache: "hit" };
    }
  } catch (err) {
    cacheEventsTotal.inc({ result: "error" });
    cacheErrorsTotal.inc({ operation: "get" });
    logger.warn({ err }, "cache get failed; falling through to upstream");
    return undefined;
  }

  cacheEventsTotal.inc({ result: "miss" });
  return undefined;
}

async function readStaleCachedArticles(
  store: CacheStore,
  cacheKey: string
): Promise<ArticleSearchResult | undefined> {
  try {
    const cached = await store.get(staleCacheKey(cacheKey));
    if (cached !== undefined) {
      cacheEventsTotal.inc({ result: "stale" });
      return { articles: cached as Article[], cache: "stale" };
    }
  } catch (err) {
    cacheErrorsTotal.inc({ operation: "get_stale" });
    logger.warn({ err }, "stale cache get failed; returning upstream error");
  }

  return undefined;
}

async function writeCachedArticles(
  store: CacheStore,
  cacheKey: string,
  articles: Article[]
): Promise<void> {
  try {
    await store.set(cacheKey, articles);
  } catch (err) {
    cacheErrorsTotal.inc({ operation: "set" });
    logger.warn({ err }, "cache set failed; returning upstream response without caching");
  }

  try {
    await store.set(staleCacheKey(cacheKey), articles, STALE_CACHE_TTL_SEC);
  } catch (err) {
    cacheErrorsTotal.inc({ operation: "set_stale" });
    logger.warn({ err }, "stale cache set failed; returning upstream response without stale copy");
  }
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
    const stale = await readStaleCachedArticles(store, cacheKey);
    if (stale) {
      logger.warn({ err }, "upstream failed; returning stale cached articles");
      return stale;
    }
    throw err;
  }

  await writeCachedArticles(store, cacheKey, articles);
  return { articles, cache: "miss" };
}

export const searchArticles = async (
  options: ArticleSearchOptions
): Promise<ArticleSearchResult> => {
  const cacheKey = searchCacheKey(options);
  const store = getCacheStore();
  const cached = await readCachedArticles(store, cacheKey);
  if (cached) {
    return cached;
  }

  const existing = inFlightSearches.get(cacheKey);
  if (existing) {
    cacheEventsTotal.inc({ result: "coalesced" });
    const result = await existing;
    return { ...result, cache: result.cache === "miss" ? "coalesced" : result.cache };
  }

  const search = fetchArticlesFromUpstream(options, store, cacheKey);
  inFlightSearches.set(cacheKey, search);
  try {
    return await search;
  } finally {
    inFlightSearches.delete(cacheKey);
  }
};

export const fetchArticles = async (options: ArticleSearchOptions): Promise<Article[]> => {
  const result = await searchArticles(options);
  return result.articles;
};

export const fetchArticlesByTitle = async (title: string): Promise<Article | undefined> => {
  const articles = await fetchArticles({ query: title, count: 10 });
  return articles.find((article) => article.title === title);
};

export const fetchArticlesBySource = async (
  sourceName: string,
  count: number,
  filters: ArticleSearchFilters = {}
): Promise<Article[]> => {
  const articles = await fetchArticles({ query: sourceName, count, ...filters });
  const target = sourceName.toLowerCase();
  return articles.filter((article) => article.source.name.toLowerCase() === target);
};
