import axios from "axios";
import { Article } from "../types/article";
import { HttpError } from "../errors/HttpError";
import { getCache, setCache } from "../utils/cache";
import { UPSTREAM_TIMEOUT_MS } from "../config/upstream";

const API_KEY = process.env.GNEWS_API_KEY;
const BASE_URL = "https://gnews.io/api/v4";

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

export const fetchArticles = async (query: string, count: number): Promise<Article[]> => {
  const cacheKey = `${query}-${count}`;
  const cached = getCache(cacheKey);
  if (cached) {
    return cached as Article[];
  }

  try {
    const response = await axios.get<{ articles: Article[] }>(`${BASE_URL}/search`, {
      params: {
        q: query,
        max: count,
        token: API_KEY,
      },
      timeout: UPSTREAM_TIMEOUT_MS,
      validateStatus: (s) => s >= 200 && s < 300,
    });

    const articles = normalizeArticles(response.data);
    setCache(cacheKey, articles);
    return articles;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      throw new HttpError(502, "Upstream news service unavailable");
    }
    throw err;
  }
};

export const fetchArticlesByTitle = async (title: string): Promise<Article | undefined> => {
  const articles = await fetchArticles(title, 10);
  return articles.find((article) => article.title === title);
};

export const fetchArticlesBySource = async (
  sourceName: string,
  count: number
): Promise<Article[]> => {
  const articles = await fetchArticles(sourceName, count);
  const target = sourceName.toLowerCase();
  return articles.filter((article) => article.source.name.toLowerCase() === target);
};
