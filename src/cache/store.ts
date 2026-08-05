import NodeCache from "node-cache";
import Redis from "ioredis";
import { resolvePositiveIntegerEnv } from "../config/numbers";
import { logger } from "../logger";
import { cacheEvictionsTotal } from "../metrics/register";

const TTL_SEC = 600;
const DEFAULT_MAX_KEYS = 2_000;
const ABSOLUTE_MAX_KEYS = 100_000;

const RELEASE_LEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

const RENEW_LEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
end
return 0
`;

export interface CacheLeaseStore {
  tryAcquireLease(key: string, owner: string, ttlMs: number): Promise<boolean>;
  releaseLease(key: string, owner: string): Promise<void>;
  renewLease?(key: string, owner: string, ttlMs: number): Promise<boolean>;
}

export type CacheStore = {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown, ttlSec?: number): Promise<void>;
  delete(key: string): Promise<void>;
} & Partial<CacheLeaseStore>;

let singleton: CacheStore | null = null;
let redisClient: Redis | null = null;

function resolveMemoryCacheMaxKeys(): number {
  return resolvePositiveIntegerEnv(process.env.CACHE_MAX_KEYS, DEFAULT_MAX_KEYS, ABSOLUTE_MAX_KEYS);
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
    async delete(key: string) {
      c.del(key);
      recency.delete(key);
    },
  };
}

export class CacheCorruptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CacheCorruptionError";
  }
}

export function parseRedisCacheValue(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new CacheCorruptionError("invalid JSON in Redis cache entry");
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
    async delete(key: string) {
      await client.del(key);
    },
    async tryAcquireLease(key: string, owner: string, ttlMs: number) {
      const result = await client.set(key, owner, "PX", ttlMs, "NX");
      return result === "OK";
    },
    async releaseLease(key: string, owner: string) {
      await client.eval(RELEASE_LEASE_SCRIPT, 1, key, owner);
    },
    async renewLease(key: string, owner: string, ttlMs: number) {
      const result = await client.eval(RENEW_LEASE_SCRIPT, 1, key, owner, ttlMs);
      return Number(result) === 1;
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

export function getCacheLeaseStore(store: CacheStore): CacheLeaseStore | undefined {
  if (typeof store.tryAcquireLease !== "function" || typeof store.releaseLease !== "function") {
    return undefined;
  }
  return store as CacheLeaseStore;
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
