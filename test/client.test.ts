import { describe, expect, it, vi } from "vitest";
import { NewsApiClient, NewsApiClientError } from "../src/client/newsApiClient";
import { sampleArticles } from "./fixtures/articles";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

describe("NewsApiClient", () => {
  it("searches v1 articles with typed query params", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: sampleArticles,
        meta: {
          query: "postgres",
          count: 2,
          filters: { lang: "en" },
          cache: "miss",
          requestId: "req-1",
        },
      })
    );
    const client = new NewsApiClient({
      baseUrl: "https://news-api.example",
      apiKey: "client-key",
      fetchImpl,
    });

    const result = await client.searchArticles({
      query: "postgres",
      count: 2,
      page: 2,
      lang: "en",
    });

    expect(result.data).toEqual(sampleArticles);
    expect(result.meta.cache).toBe("miss");
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://news-api.example/api/v1/articles?query=postgres&count=2&page=2&lang=en"),
      { headers: { "X-API-Key": "client-key" } }
    );
  });

  it("returns a typed 200 conditional result and sends the validator", async () => {
    const etag = 'W/"sha256-search"';
    const body = {
      data: sampleArticles,
      meta: {
        query: "postgres",
        count: 2,
        filters: { lang: "en" },
        cache: "hit" as const,
        requestId: "req-2",
      },
    };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(body, { headers: { ETag: etag } })
    );
    const client = new NewsApiClient({
      baseUrl: "https://news-api.example",
      apiKey: "client-key",
      fetchImpl,
    });

    const result = await client.searchArticlesConditional(
      { query: "postgres", count: 2 },
      etag
    );

    expect(result).toEqual({ status: 200, etag, body });
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://news-api.example/api/v1/articles?query=postgres&count=2"),
      { headers: { "X-API-Key": "client-key", "If-None-Match": etag } }
    );
  });

  it("returns a bodyless 304 result for a conditional title request", async () => {
    const etag = 'W/"sha256-title"';
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 304, headers: { ETag: etag } })
    );
    const client = new NewsApiClient({
      baseUrl: "https://news-api.example",
      fetchImpl,
    });

    const result = await client.getArticleByTitleConditional("Alpha headline", etag);

    expect(result).toEqual({ status: 304, etag });
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://news-api.example/api/v1/articles/title/Alpha%20headline"),
      { headers: { "If-None-Match": etag } }
    );
  });

  it("keeps structured errors for conditional source requests", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "upstream_unavailable",
            message: "Upstream news service unavailable",
            requestId: "req-source-error",
          },
        },
        { status: 503 }
      )
    );
    const client = new NewsApiClient({
      baseUrl: "https://news-api.example",
      fetchImpl,
    });

    await expect(
      client.listSourceArticlesConditional("BBC", { count: 5 }, 'W/"sha256-source"')
    ).rejects.toMatchObject({
      name: "NewsApiClientError",
      status: 503,
      code: "upstream_unavailable",
      requestId: "req-source-error",
    } satisfies Partial<NewsApiClientError>);
  });

  it("throws structured API errors", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "missing_query_parameter",
            message: "Missing or empty query parameter: query",
            requestId: "req-err",
          },
        },
        { status: 400 }
      )
    );
    const client = new NewsApiClient({
      baseUrl: "https://news-api.example",
      fetchImpl,
    });

    await expect(client.searchArticles({ query: "" })).rejects.toMatchObject({
      name: "NewsApiClientError",
      status: 400,
      code: "missing_query_parameter",
      requestId: "req-err",
    } satisfies Partial<NewsApiClientError>);
  });

  it("keeps Retry-After on structured upstream errors", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "upstream_rate_limited",
            message: "Upstream news service rate limit exceeded",
            requestId: "req-limit",
          },
        },
        { status: 429, headers: { "Retry-After": "120" } }
      )
    );
    const client = new NewsApiClient({
      baseUrl: "https://news-api.example",
      fetchImpl,
    });

    await expect(client.searchArticles({ query: "postgres" })).rejects.toMatchObject({
      name: "NewsApiClientError",
      status: 429,
      code: "upstream_rate_limited",
      retryAfter: "120",
    } satisfies Partial<NewsApiClientError>);
  });
});
