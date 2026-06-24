import axios from "axios";
import { Article } from "../types/article";
import { HttpError } from "../errors/HttpError";
import { getCacheStore } from "../cache/store";
import { UPSTREAM_BASE_URL, UPSTREAM_TIMEOUT_MS } from "../config/upstream";
import { ArticleSearchFilters, ArticleSearchOptions } from "../types/search";
import {
  cacheEventsTotal,
  upstreamRequestDurationSeconds,
  upstreamRequestsTotal,
} from "../metrics/register";

const API_KEY = process.env.GNEWS_API_KEY;

function normalizeArticles(data: unknown): Article[] {
  if (
    data === null ||
    typeof data !== "object" ||
    !("articles" in data) ||
    !Array.isArray((data as { articles: unknown }).articles)
  ) {
    throw new HttpError(502, "Invalid response from news provider");
  }
  return (data as { articles: Article[] }).articles;
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

function toProviderParams(options: ArticleSearchOptions): Record<string, string | number | undefined> {
  return {
    q: options.query,
    max: options.count,
    token: API_KEY,
    lang: options.lang,
    country: options.country,
    from: options.from,
    to: options.to,
    sortby: options.sortBy,
  };
}

export const fetchArticles = async (options: ArticleSearchOptions): Promise<Article[]> => {
  const cacheKey = searchCacheKey(options);
  const store = getCacheStore();
  const cached = await store.get(cacheKey);
  if (cached) {
    cacheEventsTotal.inc({ result: "hit" });
    return cached as Article[];
  }
  cacheEventsTotal.inc({ result: "miss" });

  const stopUpstreamTimer = upstreamRequestDurationSeconds.startTimer();
  let articles: Article[];
  try {
    const response = await axios.get<{ articles: Article[] }>(`${UPSTREAM_BASE_URL}/search`, {
      params: toProviderParams(options),
      timeout: UPSTREAM_TIMEOUT_MS,
      validateStatus: (s) => s >= 200 && s < 300,
    });

    articles = normalizeArticles(response.data);
    upstreamRequestsTotal.inc({ outcome: "success" });
    stopUpstreamTimer({ outcome: "success" });
  } catch (err) {
    const outcome =
      err instanceof HttpError && err.statusCode === 502 ? "invalid_payload" : "error";
    upstreamRequestsTotal.inc({ outcome });
    stopUpstreamTimer({ outcome });
    if (axios.isAxiosError(err)) {
      throw new HttpError(502, "Upstream news service unavailable");
    }
    throw err;
  }

  await store.set(cacheKey, articles);
  return articles;
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
