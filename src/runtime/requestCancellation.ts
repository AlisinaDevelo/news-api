import type { Response } from "express";
import { requestCancellationsTotal } from "../metrics/register";

export class RequestAbortedError extends Error {
  constructor() {
    super("request aborted");
    this.name = "AbortError";
  }
}

export function isRequestAbortedError(error: unknown): boolean {
  if (error instanceof RequestAbortedError) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  const code = (error as Error & { code?: unknown }).code;
  return error.name === "AbortError" || code === "ABORT_ERR" || code === "ERR_CANCELED";
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new RequestAbortedError();
  }
}

export function combineAbortSignals(...signals: Array<AbortSignal | undefined>): AbortSignal {
  const active = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  if (active.length === 0) {
    return new AbortController().signal;
  }
  if (active.length === 1) {
    return active[0];
  }
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any(active);
  }

  const controller = new AbortController();
  const abort = (): void => {
    for (const signal of active) {
      signal.removeEventListener("abort", abort);
    }
    controller.abort();
  };
  if (active.some((signal) => signal.aborted)) {
    abort();
    return controller.signal;
  }
  for (const signal of active) {
    signal.addEventListener("abort", abort, { once: true });
  }
  return controller.signal;
}

export interface AbortDeadline {
  signal: AbortSignal;
  cancel(): void;
}

export function createAbortDeadline(timeoutMs: number): AbortDeadline {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
  };
}

export function createRequestAbortSignal(res: Response): AbortSignal {
  const controller = new AbortController();
  const abortOnPrematureClose = (): void => {
    if (res.writableEnded || controller.signal.aborted) {
      return;
    }
    requestCancellationsTotal.inc({ reason: "client_disconnect" });
    controller.abort();
  };

  res.once("close", abortOnPrematureClose);
  res.once("finish", () => {
    res.removeListener("close", abortOnPrematureClose);
  });
  return controller.signal;
}
