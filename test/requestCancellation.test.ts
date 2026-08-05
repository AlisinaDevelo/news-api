import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import {
  combineAbortSignals,
  createRequestAbortSignal,
} from "../src/runtime/requestCancellation";
import { resetLifecycleForTests } from "../src/runtime/lifecycle";

function responseDouble(): EventEmitter & { writableEnded: boolean } {
  const response = new EventEmitter() as EventEmitter & { writableEnded: boolean };
  response.writableEnded = false;
  return response;
}

afterEach(() => {
  resetLifecycleForTests();
  vi.useRealTimers();
});

describe("request cancellation", () => {
  it("does not abort after a normally completed response", () => {
    const response = responseDouble();
    const signal = createRequestAbortSignal(response as unknown as Response);

    response.writableEnded = true;
    response.emit("finish");
    response.emit("close");

    expect(signal.aborted).toBe(false);
  });

  it("aborts when the response closes before it ends", () => {
    const response = responseDouble();
    const signal = createRequestAbortSignal(response as unknown as Response);

    response.emit("close");

    expect(signal.aborted).toBe(true);
  });

  it("composes client and shutdown signals", () => {
    const client = new AbortController();
    const shutdown = new AbortController();
    const combined = combineAbortSignals(client.signal, shutdown.signal);

    client.abort();

    expect(combined.aborted).toBe(true);
  });
});
