import { Article } from "../types/article";
import { CacheStore, getCacheStore } from "../cache/store";
import { ArticleSearchFilters, ArticleSearchOptions } from "../types/search";
import { cacheErrorsTotal, cacheEventsTotal } from "../metrics/register";
import { logger } from "../logger";
import { newsProvider } from "../providers/gnewsProvider";

const inFlightSearches = new Map<string, Promise<ArticleSearchResult>>();

export type ArticleSearchCacheStatus = "hit" | "miss" | "coalesced";

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
}

async function fetchArticlesFromUpstream(
  options: ArticleSearchOptions,
  store: CacheStore,
  cacheKey: string
): Promise<ArticleSearchResult> {
  const articles = await newsProvider.search(options);
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
    return { ...result, cache: "coalesced" };
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
