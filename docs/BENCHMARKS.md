# Benchmarks

`news-api` includes a deterministic local benchmark so performance claims can be reproduced without a live GNews key, provider quota, or public-internet latency.

The benchmark:

1. Builds the TypeScript app.
2. Starts a local GNews-compatible fake provider.
3. Starts `news-api` with `GNEWS_BASE_URL` pointed at the fake provider.
4. Measures cold unique searches and warm cached searches.

```bash
npm run benchmark:local
```

Useful overrides:

```bash
BENCHMARK_PROVIDER_DELAY_MS=25 \
BENCHMARK_COLD_REQUESTS=500 \
BENCHMARK_COLD_CONCURRENCY=25 \
BENCHMARK_WARM_REQUESTS=1000 \
BENCHMARK_WARM_CONCURRENCY=100 \
npm run benchmark:local
```

## Latest Local Run

Run this on your machine before publishing numbers in a profile or portfolio; benchmark results depend on host CPU, Node version, and local load.

Command: `npm run benchmark:local`

- Date: `2026-06-24T00:07:47.186Z`
- Commit: `07a171e`
- Node: `v26.0.0`
- Host: `Darwin 25.5.0 (Apple M1)`
- Fake provider delay: `15ms`
- Rate limiting: disabled for benchmark

| Scenario | Requests | Concurrency | Upstream calls | Success | Failed | p50 ms | p95 ms | p99 ms | Throughput req/s |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Cold unique searches | 300 | 20 | 300 | 300 | 0 | 28.6 | 54.2 | 67.7 | 611 |
| Warm cached search | 500 | 50 | 0 | 500 | 0 | 9.1 | 101.8 | 180.0 | 2484 |

## Metric Notes

- **Cold unique searches** use a different query per request, so every successful request should call the upstream provider.
- **Warm cached search** performs one warmup request, then measures repeated identical searches. The warmup request is excluded from the table, so upstream calls should be `0` during the measured run.
- Rate limiting is disabled by the benchmark process because the goal is service/cache behavior, not limiter behavior.
- The fake provider adds a configurable delay (`BENCHMARK_PROVIDER_DELAY_MS`, default `15`) to make cache behavior visible.
