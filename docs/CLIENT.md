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
`304 Not Modified` with the current `ETag` and no body. The client exposes parallel conditional
methods that preserve the existing unconditional API:

Successful v1 reads also return `Cache-Control: private, no-cache`. A private client cache may
retain the representation, but it must validate it before reuse; the API-keyed response is not
intended for shared-cache replay. The internal Redis/article cache is a separate server-side
optimization and is not controlled by this HTTP header.

```ts
const params = { query: "postgres", count: 5 };
const first = await client.searchArticlesConditional(params);

if (first.status === 200) {
  cache.store(first.body, first.etag);
}

const cached = cache.load();
const next = await client.searchArticlesConditional(params, cached?.etag);
const envelope = next.status === 304 ? cached?.body : next.body;
```

`getArticleByTitleConditional` and `listSourceArticlesConditional` follow the same result shape.
On `200`, the result is `{ status: 200, etag, body }`; on `304`, it is `{ status: 304, etag }`,
so callers can retain their cached envelope without attempting to parse an empty response.

The wrapper intentionally targets `/api/v1/*` only. Legacy `/api/articles*` routes remain
available for backward compatibility, but new consumers should use v1 envelopes.
