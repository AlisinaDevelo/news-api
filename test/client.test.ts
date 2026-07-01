import { describe, expect, it, vi } from "vitest";
import { NewsApiClient, NewsApiClientError } from "../src/client/newsApiClient";
import { sampleArticles } from "./fixtures/articles";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
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

    const result = await client.searchArticles({ query: "postgres", count: 2, lang: "en" });

    expect(result.data).toEqual(sampleArticles);
    expect(result.meta.cache).toBe("miss");
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://news-api.example/api/v1/articles?query=postgres&count=2&lang=en"),
      { headers: { "X-API-Key": "client-key" } }
    );
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
});
