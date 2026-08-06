import { EventEmitter } from "node:events";
import type Redis from "ioredis";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRedisCommandRunner } from "../src/redis/commandRunner";

type FakeRedis = Redis & EventEmitter;

function fakeRedis(status: "connecting" | "ready" | "end"): FakeRedis {
  const client = new EventEmitter() as FakeRedis;
  Object.assign(client, { status });
  return client;
}

function setStatus(client: FakeRedis, status: "connecting" | "ready" | "end"): void {
  Object.assign(client, { status });
}

describe("Redis command runner", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for readiness before issuing a command", async () => {
    const client = fakeRedis("connecting");
    const command = vi.fn().mockResolvedValue("ok");
    const runCommand = createRedisCommandRunner(client, 100);

    const result = runCommand(command);

    expect(command).not.toHaveBeenCalled();
    setStatus(client, "ready");
    client.emit("ready");

    await expect(result).resolves.toBe("ok");
    expect(command).toHaveBeenCalledOnce();
  });

  it("rejects when readiness exceeds the connection budget", async () => {
    vi.useFakeTimers();
    const client = fakeRedis("connecting");
    const command = vi.fn().mockResolvedValue("ok");
    const runCommand = createRedisCommandRunner(client, 100);
    const result = runCommand(command);
    const rejected = expect(result).rejects.toThrow("Redis connection timed out");

    await vi.advanceTimersByTimeAsync(100);

    await rejected;
    expect(command).not.toHaveBeenCalled();
  });

  it("rejects when the client ends before readiness", async () => {
    const client = fakeRedis("connecting");
    const runCommand = createRedisCommandRunner(client, 100);
    const result = runCommand(() => Promise.resolve("ok"));

    setStatus(client, "end");
    client.emit("end");

    await expect(result).rejects.toThrow("Redis connection closed");
  });

  it("runs immediately when Redis is already ready", async () => {
    const client = fakeRedis("ready");
    const command = vi.fn().mockResolvedValue(42);
    const runCommand = createRedisCommandRunner(client, 100);

    await expect(runCommand(command)).resolves.toBe(42);
    expect(command).toHaveBeenCalledOnce();
  });
});
