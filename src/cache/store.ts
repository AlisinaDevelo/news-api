import NodeCache from "node-cache";
import Redis from "ioredis";
import { logger } from "../logger";

const TTL_SEC = 600;

export type CacheStore = {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
};

let singleton: CacheStore | null = null;
let redisClient: Redis | null = null;

function createMemoryStore(): CacheStore {
  const c = new NodeCache({ stdTTL: TTL_SEC });
  return {
    async get(key: string) {
      return c.get(key);
    },
    async set(key: string, value: unknown) {
      c.set(key, value);
    },
  };
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
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return undefined;
      }
    },
    async set(key: string, value: unknown) {
      await client.setex(key, TTL_SEC, JSON.stringify(value));
    },
  };
}

export function getCacheStore(): CacheStore {
  if (!singleton) {
    const url = process.env.REDIS_URL?.trim();
    singleton = url ? createRedisStore(url) : createMemoryStore();
    if (url) {
      logger.info("using redis cache backend");
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
