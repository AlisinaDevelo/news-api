import { afterEach, describe, expect, it, vi } from "vitest";
import {
  abortShutdown,
  beginDraining,
  isDraining,
  resetLifecycleForTests,
  shutdownSignal,
} from "../src/runtime/lifecycle";
import { createShutdownHandler, type ShutdownServer } from "../src/runtime/shutdown";

afterEach(() => {
  resetLifecycleForTests();
  vi.useRealTimers();
});

describe("runtime lifecycle", () => {
  it("transitions to draining once and aborts shutdown work once", () => {
    expect(isDraining()).toBe(false);
    expect(shutdownSignal().aborted).toBe(false);

    expect(beginDraining()).toBe(true);
    expect(beginDraining()).toBe(false);
    expect(isDraining()).toBe(true);

    expect(abortShutdown()).toBe(true);
    expect(abortShutdown()).toBe(false);
    expect(shutdownSignal().aborted).toBe(true);
  });

  it("closes and cleans up once when signals repeat", async () => {
    let closeCallback: ((error?: Error) => void) | undefined;
    const server: ShutdownServer = {
      close: vi.fn((callback: (error?: Error) => void) => {
        closeCallback = callback;
      }),
      closeAllConnections: vi.fn(),
    };
    const cleanup = vi.fn(async () => undefined);
    const exit = vi.fn();
    const onRepeat = vi.fn();
    const shutdown = createShutdownHandler({
      server,
      timeoutMs: 1_000,
      cleanup,
      exit,
      onRepeat,
    });

    shutdown("SIGTERM");
    shutdown("SIGINT");
    closeCallback?.();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(onRepeat).toHaveBeenCalledWith("SIGINT");
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(isDraining()).toBe(true);
  });

  it("aborts provider work and force-closes connections at the deadline", async () => {
    vi.useFakeTimers();
    const server: ShutdownServer = {
      close: vi.fn(),
      closeAllConnections: vi.fn(),
    };
    const cleanup = vi.fn(async () => undefined);
    const exit = vi.fn();
    const shutdown = createShutdownHandler({
      server,
      timeoutMs: 500,
      cleanup,
      exit,
    });

    shutdown("SIGTERM");
    expect(shutdownSignal().aborted).toBe(false);

    vi.advanceTimersByTime(500);
    await Promise.resolve();

    expect(shutdownSignal().aborted).toBe(true);
    expect(server.closeAllConnections).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("forces exit when cleanup exceeds the shutdown deadline", async () => {
    vi.useFakeTimers();
    let closeCallback: ((error?: Error) => void) | undefined;
    let resolveCleanup: (() => void) | undefined;
    const server: ShutdownServer = {
      close: vi.fn((callback: (error?: Error) => void) => {
        closeCallback = callback;
      }),
      closeAllConnections: vi.fn(),
    };
    const cleanup = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCleanup = resolve;
        })
    );
    const exit = vi.fn();
    const onForced = vi.fn();
    const shutdown = createShutdownHandler({
      server,
      timeoutMs: 500,
      cleanup,
      exit,
      onForced,
    });

    shutdown("SIGTERM");
    closeCallback?.();
    await Promise.resolve();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(exit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);

    expect(onForced).toHaveBeenCalledOnce();
    expect(server.closeAllConnections).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(1);

    resolveCleanup?.();
    await Promise.resolve();
    expect(exit).toHaveBeenCalledOnce();
  });
});
