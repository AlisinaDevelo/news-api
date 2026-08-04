import NodeCache from "node-cache";
import Redis from "ioredis";
import { logger } from "../logger";
import { cacheEvictionsTotal } from "../metrics/register";

const TTL_SEC = 600;
const DEFAULT_MAX_KEYS = 2_000;
const ABSOLUTE_MAX_KEYS = 100_000;

export type CacheStore = {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown, ttlSec?: number): Promise<void>;
};

let singleton: CacheStore | null = null;
let redisClient: Redis | null = null;

function resolveMemoryCacheMaxKeys(): number {
  const configured = Number(process.env.CACHE_MAX_KEYS);
  if (!Number.isInteger(configured) || configured < 1) {
    return DEFAULT_MAX_KEYS;
  }
  return Math.min(configured, ABSOLUTE_MAX_KEYS);
}

function createMemoryStore(): CacheStore {
  const maxKeys = resolveMemoryCacheMaxKeys();
  const c = new NodeCache({ stdTTL: TTL_SEC, maxKeys });
  const recency = new Map<string, true>();

  const touch = (key: string): void => {
    recency.delete(key);
    recency.set(key, true);
  };

  const evictLeastRecentlyUsed = (): boolean => {
    const oldest = recency.keys().next().value;
    if (typeof oldest === "string") {
      recency.delete(oldest);
      c.del(oldest);
      cacheEvictionsTotal.inc();
      return true;
    }

    const fallback = c.keys()[0];
    if (!fallback) {
      return false;
    }
    c.del(fallback);
    cacheEvictionsTotal.inc();
    return true;
  };

  const makeRoom = (key: string): void => {
    if (c.has(key)) {
      c.del(key);
      recency.delete(key);
    } else {
      recency.delete(key);
    }

    while (c.getStats().keys >= maxKeys && evictLeastRecentlyUsed()) {
      // Keep removing the oldest entry until NodeCache accepts the new key.
    }
  };

  return {
    async get(key: string) {
      const value = c.get(key);
      if (value === undefined) {
        recency.delete(key);
      } else {
        touch(key);
      }
      return value;
    },
    async set(key: string, value: unknown, ttlSec = TTL_SEC) {
      makeRoom(key);
      c.set(key, value, ttlSec);
      touch(key);
    },
  };
}

export function parseRedisCacheValue(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error("invalid JSON in Redis cache entry");
  }
}

function createRedisStore(url: string): CacheStore {
  const client = new Redis(url, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    lazyConnect: false,
  });
  redisClient = client;
  client.on("error", (err) => {
    logger.error({ err }, "redis connection error");
  });
  return {
    async get(key: string) {
      const raw = await client.get(key);
      if (raw === null) {
        return undefined;
      }
      return parseRedisCacheValue(raw);
    },
    async set(key: string, value: unknown, ttlSec = TTL_SEC) {
      await client.setex(key, ttlSec, JSON.stringify(value));
    },
  };
}

export function getCacheStore(): CacheStore {
  if (!singleton) {
    const url = process.env.REDIS_URL?.trim();
    singleton = url ? createRedisStore(url) : createMemoryStore();
    if (url) {
      logger.info("using redis cache backend");
    } else {
      logger.info({ maxKeys: resolveMemoryCacheMaxKeys() }, "using memory cache backend");
    }
  }
  return singleton;
}

/** @internal tests */
export function setCacheStoreForTests(store: CacheStore): void {
  singleton = store;
  redisClient = null;
}

export async function disconnectCacheStore(): Promise<void> {
  if (redisClient) {
    try {
      await redisClient.quit();
    } finally {
      redisClient = null;
      singleton = null;
    }
  }
}

/** @internal tests */
export function resetCacheStoreForTests(): void {
  singleton = null;
  redisClient = null;
}
