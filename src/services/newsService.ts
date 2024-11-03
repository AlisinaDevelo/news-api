import axios from "axios";
import { Article } from "../types/article";
import { getCache, setCache } from "../utils/cache";

const API_KEY = process.env.GNEWS_API_KEY;
const BASE_URL = "https://gnews.io/api/v4";

export const fetchArticles = async (query: string, count: number): Promise<Article[]> => {
  const cacheKey = `${query}-${count}`;
  const cached = getCache(cacheKey);
  if (cached) {
    return cached as Article[];
  }

  const response = await axios.get<{ articles: Article[] }>(`${BASE_URL}/search`, {
    params: {
      q: query,
      max: count,
      token: API_KEY,
    },
  });

  const articles = response.data.articles;
  setCache(cacheKey, articles);
  return articles;
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
