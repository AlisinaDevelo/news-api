import { createHash, randomUUID } from "node:crypto";
import {
  resolveCacheLeaseHeartbeatMs,
  resolveCacheLeasePollMs,
  resolveCacheLeaseTtlMs,
  resolveCacheLeaseWaitMs,
} from "../config/cache";
import { cacheCoordinationEventsTotal } from "../metrics/register";
import { RequestAbortedError, throwIfAborted } from "../runtime/requestCancellation";
import { CacheStore, getCacheLeaseStore } from "./store";

const LEASE_KEY_PREFIX = "news-api:cache-lease:";

export interface CacheMissCoordinationOptions<T> {
  store: CacheStore;
  cacheKey: string;
  signal?: AbortSignal;
  readFresh: () => Promise<T | undefined>;
  load: () => Promise<T>;
}

export interface CacheMissCoordinationResult<T> {
  value: T;
  source: "upstream" | "shared-cache" | "bypassed";
}

function leaseKey(cacheKey: string): string {
  const fingerprint = createHash("sha256").update(cacheKey).digest("hex");
  return `${LEASE_KEY_PREFIX}${fingerprint}`;
}

function waitDelayMs(): number {
  const pollMs = resolveCacheLeasePollMs();
  return Math.max(1, Math.round(pollMs * (0.5 + Math.random())));
}

function sleep(delayMs: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new RequestAbortedError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function loadWithoutCoordination<T>(
  options: CacheMissCoordinationOptions<T>,
  event: "bypassed" | "error"
): Promise<CacheMissCoordinationResult<T>> {
  cacheCoordinationEventsTotal.inc({ event });
  return { value: await options.load(), source: event === "bypassed" ? "bypassed" : "upstream" };
}

async function releaseLease(
  store: ReturnType<typeof getCacheLeaseStore>,
  key: string,
  owner: string
): Promise<void> {
  if (!store) {
    return;
  }
  try {
    await store.releaseLease(key, owner);
    cacheCoordinationEventsTotal.inc({ event: "released" });
  } catch {
    cacheCoordinationEventsTotal.inc({ event: "release_error" });
  }
}

function startLeaseHeartbeat(
  store: ReturnType<typeof getCacheLeaseStore>,
  key: string,
  owner: string,
  ttlMs: number,
  signal?: AbortSignal
): { stop(): void } {
  if (!store?.renewLease) {
    return { stop() {} };
  }

  let stopped = false;
  let renewalInFlight = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = (): void => {
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
  const renew = async (): Promise<void> => {
    if (stopped || signal?.aborted || renewalInFlight) {
      return;
    }
    renewalInFlight = true;
    try {
      const renewed = await store.renewLease?.(key, owner, ttlMs);
      if (stopped) {
        return;
      }
      if (renewed) {
        cacheCoordinationEventsTotal.inc({ event: "renewed" });
      } else {
        cacheCoordinationEventsTotal.inc({ event: "lost" });
        stop();
      }
    } catch {
      if (!stopped) {
        cacheCoordinationEventsTotal.inc({ event: "renewal_error" });
      }
    } finally {
      renewalInFlight = false;
    }
  };
  timer = setInterval(() => {
    void renew();
  }, resolveCacheLeaseHeartbeatMs(undefined, ttlMs));
  timer.unref?.();
  return { stop };
}

export async function coordinateCacheMiss<T>(
  options: CacheMissCoordinationOptions<T>
): Promise<CacheMissCoordinationResult<T>> {
  throwIfAborted(options.signal);
  const leaseStore = getCacheLeaseStore(options.store);
  if (!leaseStore) {
    return loadWithoutCoordination(options, "bypassed");
  }

  const key = leaseKey(options.cacheKey);
  const owner = randomUUID();
  const leaseTtlMs = resolveCacheLeaseTtlMs();
  const waitDeadline = Date.now() + resolveCacheLeaseWaitMs();
  let waited = false;

  while (true) {
    throwIfAborted(options.signal);
    let acquired: boolean;
    try {
      acquired = await leaseStore.tryAcquireLease(key, owner, leaseTtlMs);
      throwIfAborted(options.signal);
    } catch (error) {
      if (options.signal?.aborted) {
        throw error instanceof RequestAbortedError ? error : new RequestAbortedError();
      }
      return loadWithoutCoordination(options, "error");
    }

    if (acquired) {
      cacheCoordinationEventsTotal.inc({ event: "acquired" });
      try {
        try {
          const cached = await options.readFresh();
          if (cached !== undefined) {
            cacheCoordinationEventsTotal.inc({ event: "hit" });
            return { value: cached, source: "shared-cache" };
          }
        } catch (error) {
          if (options.signal?.aborted) {
            throw error instanceof RequestAbortedError ? error : new RequestAbortedError();
          }
          cacheCoordinationEventsTotal.inc({ event: "error" });
        }
        const heartbeat = startLeaseHeartbeat(leaseStore, key, owner, leaseTtlMs, options.signal);
        try {
          return { value: await options.load(), source: "upstream" };
        } finally {
          heartbeat.stop();
        }
      } finally {
        await releaseLease(leaseStore, key, owner);
      }
    }

    if (!waited) {
      waited = true;
      cacheCoordinationEventsTotal.inc({ event: "waited" });
    }

    let cached: T | undefined;
    try {
      cached = await options.readFresh();
    } catch (error) {
      if (options.signal?.aborted) {
        throw error instanceof RequestAbortedError ? error : new RequestAbortedError();
      }
      return loadWithoutCoordination(options, "error");
    }
    if (cached !== undefined) {
      cacheCoordinationEventsTotal.inc({ event: "hit" });
      return { value: cached, source: "shared-cache" };
    }

    const remainingMs = waitDeadline - Date.now();
    if (remainingMs <= 0) {
      cacheCoordinationEventsTotal.inc({ event: "expired" });
      return { value: await options.load(), source: "upstream" };
    }
    await sleep(Math.min(waitDelayMs(), remainingMs), options.signal);
  }
}

/** @internal tests */
export function cacheLeaseKeyForTests(cacheKey: string): string {
  return leaseKey(cacheKey);
}
