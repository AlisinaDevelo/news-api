import rateLimit from "express-rate-limit";
import type { Request } from "express";

const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
const max = Number(process.env.RATE_LIMIT_MAX ?? 120);

function skipRateLimit(req: Request): boolean {
  if (
    process.env.NODE_ENV === "test" ||
    process.env.VITEST === "true" ||
    process.env.DISABLE_RATE_LIMIT === "1"
  ) {
    return true;
  }
  const path = req.path ?? "";
  return path === "/health" || path === "/ready" || path === "/openapi.yaml";
}

export const apiRateLimiter = rateLimit({
  windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 60_000,
  max: Number.isFinite(max) && max > 0 ? max : 120,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipRateLimit,
});
