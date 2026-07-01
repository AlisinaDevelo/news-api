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
    console.error(err.status, err.code, err.requestId);
  }
}
```

The wrapper intentionally targets `/api/v1/*` only. Legacy `/api/articles*` routes remain
available for backward compatibility, but new consumers should use v1 envelopes.
