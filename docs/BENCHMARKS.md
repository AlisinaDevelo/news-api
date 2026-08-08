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

- Date: `2026-08-08T23:08:44.445Z`
- Commit: `46001c8`
- Node: `v26.0.0`
- Host: `Darwin 25.5.0 (Apple M1)`
- Fake provider delay: `15ms`
- Rate limiting: disabled for benchmark

| Scenario | Requests | Concurrency | Upstream calls | Success | Failed | p50 ms | p95 ms | p99 ms | Throughput req/s |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Cold unique searches | 300 | 20 | 300 | 300 | 0 | 27.2 | 51.0 | 57.3 | 689 |
| Warm cached search | 500 | 50 | 0 | 500 | 0 | 14.5 | 25.4 | 72.9 | 3004 |

## Metric Notes

- **Cold unique searches** use a different query per request, so every successful request should call the upstream provider.
- **Warm cached search** performs one warmup request, then measures repeated identical searches. The warmup request is excluded from the table, so upstream calls should be `0` during the measured run.
- Rate limiting is disabled by the benchmark process because the goal is service/cache behavior, not limiter behavior.
- The fake provider adds a configurable delay (`BENCHMARK_PROVIDER_DELAY_MS`, default `15`) to make cache behavior visible.
