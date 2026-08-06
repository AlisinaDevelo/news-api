import type Redis from "ioredis";

export type RedisCommandRunner = <T>(command: () => Promise<T>) => Promise<T>;

export function createRedisCommandRunner(
  client: Redis,
  connectTimeoutMs: number
): RedisCommandRunner {
  const waitForReady = (): Promise<void> => {
    if (client.status === "ready") {
      return Promise.resolve();
    }
    if (client.status === "end") {
      return Promise.reject(new Error("Redis connection is closed"));
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (outcome: "ready" | "error", error?: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        client.off("ready", onReady);
        client.off("end", onEnd);
        if (outcome === "ready") {
          resolve();
        } else {
          reject(error ?? new Error("Redis connection failed"));
        }
      };
      const onReady = (): void => finish("ready");
      const onEnd = (): void => finish("error", new Error("Redis connection closed"));

      const timer = setTimeout(() => {
        finish("error", new Error("Redis connection timed out"));
      }, connectTimeoutMs);
      client.once("ready", onReady);
      client.once("end", onEnd);
      if (client.status === "ready") {
        onReady();
      }
    });
  };

  return async <T>(command: () => Promise<T>): Promise<T> => {
    await waitForReady();
    return command();
  };
}
