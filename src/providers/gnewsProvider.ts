import axios from "axios";
import { UPSTREAM_BASE_URL, UPSTREAM_TIMEOUT_MS } from "../config/upstream";
import { HttpError } from "../errors/HttpError";
import {
  upstreamRequestDurationSeconds,
  upstreamRequestsTotal,
} from "../metrics/register";
import { Article } from "../types/article";
import { ArticleSearchOptions } from "../types/search";

export interface NewsProvider {
  search(options: ArticleSearchOptions): Promise<Article[]>;
}

function normalizeArticles(data: unknown): Article[] {
  if (
    data === null ||
    typeof data !== "object" ||
    !("articles" in data) ||
    !Array.isArray((data as { articles: unknown }).articles)
  ) {
    throw new HttpError(502, "Invalid response from news provider", "invalid_provider_payload");
  }
  return (data as { articles: Article[] }).articles;
}

function toProviderParams(options: ArticleSearchOptions): Record<string, string | number | undefined> {
  return {
    q: options.query,
    max: options.count,
    token: process.env.GNEWS_API_KEY,
    lang: options.lang,
    country: options.country,
    from: options.from,
    to: options.to,
    sortby: options.sortBy,
  };
}

export class GNewsProvider implements NewsProvider {
  async search(options: ArticleSearchOptions): Promise<Article[]> {
    const stopUpstreamTimer = upstreamRequestDurationSeconds.startTimer();

    try {
      const response = await axios.get<{ articles: Article[] }>(`${UPSTREAM_BASE_URL}/search`, {
        params: toProviderParams(options),
        timeout: UPSTREAM_TIMEOUT_MS,
        validateStatus: (s) => s >= 200 && s < 300,
      });

      const articles = normalizeArticles(response.data);
      upstreamRequestsTotal.inc({ outcome: "success" });
      stopUpstreamTimer({ outcome: "success" });
      return articles;
    } catch (err) {
      const outcome =
        err instanceof HttpError && err.statusCode === 502 ? "invalid_payload" : "error";
      upstreamRequestsTotal.inc({ outcome });
      stopUpstreamTimer({ outcome });
      if (axios.isAxiosError(err)) {
        throw new HttpError(502, "Upstream news service unavailable", "upstream_unavailable");
      }
      throw err;
    }
  }
}

export const newsProvider: NewsProvider = new GNewsProvider();
