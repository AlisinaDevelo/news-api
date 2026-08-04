import rateLimit from "express-rate-limit";
import type { Request } from "express";
import { resolvePositiveIntegerEnv } from "../config/numbers";

const windowMs = resolvePositiveIntegerEnv(process.env.RATE_LIMIT_WINDOW_MS, 60_000);
const max = resolvePositiveIntegerEnv(process.env.RATE_LIMIT_MAX, 120);

function skipRateLimit(req: Request): boolean {
  if (
    process.env.NODE_ENV === "test" ||
    process.env.VITEST === "true" ||
    process.env.DISABLE_RATE_LIMIT === "1"
  ) {
    return true;
  }
  const path = req.path ?? "";
  return (
    path === "/health" ||
    path === "/ready" ||
    path === "/openapi.yaml" ||
    path === "/metrics"
  );
}

export const apiRateLimiter = rateLimit({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipRateLimit,
});
