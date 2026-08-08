import { Registry, Counter, Histogram, collectDefaultMetrics } from "prom-client";

export const register = new Registry();

collectDefaultMetrics({ register });

export const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total HTTP responses",
  labelNames: ["method", "status_code"],
  registers: [register],
});

export const httpServerEventsTotal = new Counter({
  name: "news_http_server_events_total",
  help: "Total HTTP transport events outside Express request handling",
  labelNames: ["event"],
  registers: [register],
});

export const httpServerLogSuppressedTotal = new Counter({
  name: "news_http_server_log_suppressed_total",
  help: "Total HTTP transport warning logs suppressed by the per-event budget",
  labelNames: ["event"],
  registers: [register],
});

export const requestIdRejectionsTotal = new Counter({
  name: "news_request_id_rejections_total",
  help: "Total client request IDs rejected by the HTTP logging boundary",
  registers: [register],
});

export const httpBodyErrorsTotal = new Counter({
  name: "news_http_body_errors_total",
  help: "Total rejected HTTP request bodies by parser error type",
  labelNames: ["type"],
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

export const cacheEvictionsTotal = new Counter({
  name: "news_cache_evictions_total",
  help: "Total least-recently-used evictions from the in-process cache",
  registers: [register],
});

export const cacheCoordinationEventsTotal = new Counter({
  name: "news_cache_coordination_events_total",
  help: "Total cross-replica cache-miss coordination events by outcome",
  labelNames: ["event"],
  registers: [register],
});

export const rateLimitStoreErrorsTotal = new Counter({
  name: "news_rate_limit_store_errors_total",
  help: "Total rate-limit store errors by source",
  labelNames: ["source"],
  registers: [register],
});

export const requestCancellationsTotal = new Counter({
  name: "news_request_cancellations_total",
  help: "Total downstream request cancellations by reason",
  labelNames: ["reason"],
  registers: [register],
});

export const upstreamRequestsTotal = new Counter({
  name: "news_upstream_requests_total",
  help: "Total upstream news provider requests by outcome",
  labelNames: ["outcome"],
  registers: [register],
});

export const upstreamRetriesTotal = new Counter({
  name: "news_upstream_retries_total",
  help: "Total transient retry attempts for upstream news provider requests",
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
