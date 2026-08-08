# TypeScript Client

The repository includes a tiny typed client wrapper for the versioned API plus generated
types from `docs/openapi.yaml`.

## Regenerate types

```bash
npm run client:generate
```

CI runs:

```bash
npm run client:check
```

That command regenerates `src/client/openapi-types.ts` and fails if the checked-in generated
types drift from the OpenAPI contract.

## Usage

```ts
import { NewsApiClient, NewsApiClientError } from "./src/client/newsApiClient";

const client = new NewsApiClient({
  baseUrl: "https://your-news-api.example",
  apiKey: process.env.NEWS_API_CLIENT_KEY,
});

const result = await client.searchArticles({
  query: "postgres",
  count: 5,
  page: 2,
  lang: "en",
  sortBy: "relevance",
});

console.log(result.meta.cache, result.data.map((article) => article.title));
```

Structured errors from `/api/v1/*` become `NewsApiClientError` instances:

```ts
try {
  await client.searchArticles({ query: "" });
} catch (err) {
  if (err instanceof NewsApiClientError) {
    console.error(err.status, err.code, err.requestId, err.retryAfter);
  }
}
```

For upstream throttling or temporary unavailability, `NewsApiClientError.retryAfter` contains the
validated `Retry-After` delta-seconds value when the API received one.

## Conditional GETs

Every successful `/api/v1/*` read returns a weak `ETag`. Send that value as `If-None-Match` on a
later `GET` or `HEAD` request. When the selected representation is unchanged, the API returns
`304 Not Modified` with the current `ETag` and no body. The small convenience methods above always
return a fresh `200` envelope; use the OpenAPI contract or a direct `fetch` call when the caller
needs to manage a conditional request and retain its cached envelope.

The wrapper intentionally targets `/api/v1/*` only. Legacy `/api/articles*` routes remain
available for backward compatibility, but new consumers should use v1 envelopes.
