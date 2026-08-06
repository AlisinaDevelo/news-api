import rateLimit, {
  type RateLimitRequestHandler,
  type Store,
  type ValueDeterminingMiddleware,
} from "express-rate-limit";
import Redis from "ioredis";
import { RedisStore, type RedisReply } from "rate-limit-redis";
import type { Request } from "express";
import { resolvePositiveIntegerEnv } from "../config/numbers";
import { resolveRateLimitRedisOptions } from "../config/redis";
import { HttpError } from "../errors/HttpError";
import { logger } from "../logger";
import { rateLimitStoreErrorsTotal } from "../metrics/register";
import { createRedisCommandRunner } from "../redis/commandRunner";

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 120;
const IPV6_SUBNET = 56;
const REDIS_KEY_PREFIX = "news-api:rate-limit:";

let redisClient: Redis | null = null;

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

function rateLimitLogger() {
  return {
    error(error: unknown, message?: string): void {
      rateLimitStoreErrorsTotal.inc({ source: "lifecycle" });
      logger.error({ err: error }, message ?? "rate-limit store error");
    },
    warn(error: unknown, message?: string): void {
      logger.warn({ err: error }, message ?? "rate-limit warning");
    },
  };
}

function createRedisStore(url: string): Store {
  const options = resolveRateLimitRedisOptions();
  const client = new Redis(url, options);
  redisClient = client;
  const runCommand = createRedisCommandRunner(client, options.connectTimeout ?? 1_000);
  client.on("error", (err) => {
    rateLimitStoreErrorsTotal.inc({ source: "connection" });
    logger.error({ err }, "rate-limit redis connection error");
  });

  return new RedisStore({
    prefix: REDIS_KEY_PREFIX,
    sendCommand: (command: string, ...args: string[]) =>
      runCommand(() => client.call(command, ...args)) as Promise<RedisReply>,
  });
}

export interface RateLimiterOptions {
  store?: Store;
  skip?: ValueDeterminingMiddleware<boolean>;
  windowMs?: number;
  limit?: number;
}

function resolveStore(store?: Store): Store | undefined {
  if (store) {
    return store;
  }
  const url = process.env.REDIS_URL?.trim();
  return url ? createRedisStore(url) : undefined;
}

export function createApiRateLimiter(options: RateLimiterOptions = {}): RateLimitRequestHandler {
  const limiter = rateLimit({
    windowMs:
      options.windowMs ??
      resolvePositiveIntegerEnv(process.env.RATE_LIMIT_WINDOW_MS, DEFAULT_WINDOW_MS),
    limit: options.limit ?? resolvePositiveIntegerEnv(process.env.RATE_LIMIT_MAX, DEFAULT_LIMIT),
    standardHeaders: "draft-8",
    legacyHeaders: false,
    ipv6Subnet: IPV6_SUBNET,
    passOnStoreError: false,
    store: resolveStore(options.store),
    skip: options.skip ?? skipRateLimit,
    handler: (_req, _res, next, config) => {
      next(
        new HttpError(
          config.statusCode,
          "Too many requests, please try again later.",
          "rate_limit_exceeded"
        )
      );
    },
    logger: rateLimitLogger(),
  });

  const middleware = ((req, res, next) => {
    limiter(req, res, (err?: unknown) => {
      if (err !== undefined) {
        if (err instanceof HttpError && err.code === "rate_limit_exceeded") {
          next(err);
          return;
        }
        rateLimitStoreErrorsTotal.inc({ source: "request" });
        next(
          new HttpError(503, "Rate limit store unavailable", "rate_limit_store_unavailable")
        );
        return;
      }
      next();
    });
  }) as RateLimitRequestHandler;
  middleware.resetKey = limiter.resetKey;
  middleware.getKey = limiter.getKey;
  return middleware;
}

export const apiRateLimiter = createApiRateLimiter();

export async function disconnectRateLimitStore(): Promise<void> {
  if (!redisClient) {
    return;
  }
  try {
    await redisClient.quit();
  } finally {
    redisClient = null;
  }
}
