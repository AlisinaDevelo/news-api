import type { components, operations } from "./openapi-types";

export type Article = components["schemas"]["Article"];
export type ArticleSearchEnvelope = components["schemas"]["ArticleSearchEnvelope"];
export type ArticleEnvelope = components["schemas"]["ArticleEnvelope"];
export type SourceArticlesEnvelope = components["schemas"]["SourceArticlesEnvelope"];
export type ErrorEnvelope = components["schemas"]["ErrorEnvelope"];
export type SearchArticlesParams = operations["searchArticlesV1"]["parameters"]["query"];
export type SourceArticlesParams = NonNullable<
  operations["listArticlesBySourceV1"]["parameters"]["query"]
>;

interface NewsApiClientOptions {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

interface RequestOptions {
  query?: Record<string, string | number | undefined>;
  apiKey?: string;
}

export class NewsApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;

  constructor(status: number, error: ErrorEnvelope["error"]) {
    super(error.message);
    this.name = "NewsApiClientError";
    this.status = status;
    this.code = error.code;
    this.requestId = error.requestId;
  }
}

export class NewsApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: NewsApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  searchArticles(params: SearchArticlesParams): Promise<ArticleSearchEnvelope> {
    return this.getJson<ArticleSearchEnvelope>("/api/v1/articles", { query: params });
  }

  getArticleByTitle(title: string): Promise<ArticleEnvelope> {
    return this.getJson<ArticleEnvelope>(`/api/v1/articles/title/${encodeURIComponent(title)}`);
  }

  listSourceArticles(
    source: string,
    params: SourceArticlesParams = {}
  ): Promise<SourceArticlesEnvelope> {
    return this.getJson<SourceArticlesEnvelope>(
      `/api/v1/sources/${encodeURIComponent(source)}/articles`,
      { query: params }
    );
  }

  private async getJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const apiKey = options.apiKey ?? this.apiKey;
    const res = await this.fetchImpl(url, {
      headers: apiKey ? { "X-API-Key": apiKey } : undefined,
    });

    const body = await this.readJson(res);
    if (!res.ok) {
      if (this.isErrorEnvelope(body)) {
        throw new NewsApiClientError(res.status, body.error);
      }
      throw new Error(`news-api request failed with HTTP ${res.status}`);
    }

    return body as T;
  }

  private async readJson(res: Response): Promise<unknown> {
    const text = await res.text();
    if (!text) {
      return undefined;
    }
    return JSON.parse(text) as unknown;
  }

  private isErrorEnvelope(value: unknown): value is ErrorEnvelope {
    if (value === null || typeof value !== "object" || !("error" in value)) {
      return false;
    }
    const error = (value as { error: unknown }).error;
    return (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      "message" in error &&
      "requestId" in error
    );
  }
}
