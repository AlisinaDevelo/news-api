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

export type ConditionalResult<T> =
  | { status: 200; etag: string | null; body: T }
  | { status: 304; etag: string | null };

interface NewsApiClientOptions {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

interface RequestOptions {
  query?: Record<string, string | number | undefined>;
  apiKey?: string;
  ifNoneMatch?: string;
}

export class NewsApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  readonly retryAfter?: string;

  constructor(status: number, error: ErrorEnvelope["error"], retryAfter?: string) {
    super(error.message);
    this.name = "NewsApiClientError";
    this.status = status;
    this.code = error.code;
    this.requestId = error.requestId;
    this.retryAfter = retryAfter;
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

  searchArticlesConditional(
    params: SearchArticlesParams,
    etag?: string
  ): Promise<ConditionalResult<ArticleSearchEnvelope>> {
    return this.getConditionalJson<ArticleSearchEnvelope>("/api/v1/articles", {
      query: params,
      ifNoneMatch: etag,
    });
  }

  getArticleByTitle(title: string): Promise<ArticleEnvelope> {
    return this.getJson<ArticleEnvelope>(`/api/v1/articles/title/${encodeURIComponent(title)}`);
  }

  getArticleByTitleConditional(
    title: string,
    etag?: string
  ): Promise<ConditionalResult<ArticleEnvelope>> {
    return this.getConditionalJson<ArticleEnvelope>(
      `/api/v1/articles/title/${encodeURIComponent(title)}`,
      { ifNoneMatch: etag }
    );
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

  listSourceArticlesConditional(
    source: string,
    params: SourceArticlesParams = {},
    etag?: string
  ): Promise<ConditionalResult<SourceArticlesEnvelope>> {
    return this.getConditionalJson<SourceArticlesEnvelope>(
      `/api/v1/sources/${encodeURIComponent(source)}/articles`,
      { query: params, ifNoneMatch: etag }
    );
  }

  private async getJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const res = await this.request(path, options);

    const body = await this.readJson(res);
    this.throwForError(res, body);

    return body as T;
  }

  private async getConditionalJson<T>(
    path: string,
    options: RequestOptions = {}
  ): Promise<ConditionalResult<T>> {
    const res = await this.request(path, options);
    const etag = res.headers.get("etag");

    if (res.status === 304) {
      return { status: 304, etag };
    }

    const body = await this.readJson(res);
    this.throwForError(res, body);
    return { status: 200, etag, body: body as T };
  }

  private request(path: string, options: RequestOptions): Promise<Response> {
    return this.fetchImpl(this.buildUrl(path, options.query), {
      headers: this.requestHeaders(options),
    });
  }

  private buildUrl(path: string, query?: RequestOptions["query"]): URL {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
    return url;
  }

  private requestHeaders(options: RequestOptions): Record<string, string> | undefined {
    const apiKey = options.apiKey ?? this.apiKey;
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers["X-API-Key"] = apiKey;
    }
    if (options.ifNoneMatch) {
      headers["If-None-Match"] = options.ifNoneMatch;
    }
    return Object.keys(headers).length > 0 ? headers : undefined;
  }

  private throwForError(res: Response, body: unknown): void {
    if (res.ok) {
      return;
    }
    if (this.isErrorEnvelope(body)) {
      throw new NewsApiClientError(
        res.status,
        body.error,
        res.headers.get("retry-after") ?? undefined
      );
    }
    throw new Error(`news-api request failed with HTTP ${res.status}`);
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
