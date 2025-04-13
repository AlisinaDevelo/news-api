import { Registry, Counter, collectDefaultMetrics } from "prom-client";

export const register = new Registry();

collectDefaultMetrics({ register });

export const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total HTTP responses",
  labelNames: ["method", "status_code"],
  registers: [register],
});
