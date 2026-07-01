import { Registry, Counter, Histogram, collectDefaultMetrics } from "prom-client";

export const register = new Registry();

collectDefaultMetrics({ register });

export const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total HTTP responses",
  labelNames: ["method", "status_code"],
  registers: [register],
});

export const cacheEventsTotal = new Counter({
  name: "news_cache_events_total",
  help: "Total news search cache lookups by result",
  labelNames: ["result"],
  registers: [register],
});

export const cacheErrorsTotal = new Counter({
  name: "news_cache_errors_total",
  help: "Total news search cache errors by operation",
  labelNames: ["operation"],
  registers: [register],
});

export const upstreamRequestsTotal = new Counter({
  name: "news_upstream_requests_total",
  help: "Total upstream news provider requests by outcome",
  labelNames: ["outcome"],
  registers: [register],
});

export const upstreamRequestDurationSeconds = new Histogram({
  name: "news_upstream_request_duration_seconds",
  help: "Duration of upstream news provider requests in seconds",
  labelNames: ["outcome"],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15],
  registers: [register],
});

export const upstreamCircuitEventsTotal = new Counter({
  name: "news_upstream_circuit_events_total",
  help: "Total upstream provider circuit breaker events",
  labelNames: ["event"],
  registers: [register],
});
