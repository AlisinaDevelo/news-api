import axios from "axios";
import {
  resolveNonNegativeIntegerEnv,
  resolvePositiveIntegerEnv,
} from "../config/numbers";
import { upstreamRetriesTotal } from "../metrics/register";
import {
  isRequestAbortedError,
  RequestAbortedError,
  throwIfAborted,
} from "../runtime/requestCancellation";
import { withSpan } from "../tracing";

const RETRYABLE_STATUS_CODES = new Set([408, 425, 500, 502, 503, 504]);
const RETRYABLE_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ECONNRESET",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
  "ERR_NETWORK",
]);
const MAX_RETRY_DELAY_MS = 2_000;

function retryAttempts(): number {
  return resolveNonNegativeIntegerEnv(process.env.UPSTREAM_RETRY_ATTEMPTS, 1, 3);
}

function retryBaseDelayMs(): number {
  return resolvePositiveIntegerEnv(process.env.UPSTREAM_RETRY_BASE_DELAY_MS, 100, 2_000);
}

export function isRetryableUpstreamError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }
  const status = error.response?.status;
  if (status !== undefined) {
    return RETRYABLE_STATUS_CODES.has(status);
  }
  return typeof error.code === "string" && RETRYABLE_ERROR_CODES.has(error.code);
}

function retryDelayMs(attempt: number): number {
  const exponential = Math.min(retryBaseDelayMs() * 2 ** attempt, MAX_RETRY_DELAY_MS);
  return Math.max(1, Math.round(exponential * (0.5 + Math.random())));
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

function retryReason(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    if (status !== undefined && RETRYABLE_STATUS_CODES.has(status)) {
      return `http_${status}`;
    }
    if (typeof error.code === "string" && RETRYABLE_ERROR_CODES.has(error.code)) {
      return "network";
    }
  }
  return "transient_error";
}

export async function withUpstreamRetries<T>(
  operation: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  const maxRetries = retryAttempts();

  for (let attempt = 0; ; attempt += 1) {
    try {
      throwIfAborted(signal);
      return await operation();
    } catch (error) {
      if (signal?.aborted || isRequestAbortedError(error)) {
        throw error instanceof RequestAbortedError ? error : new RequestAbortedError();
      }
      if (attempt >= maxRetries || !isRetryableUpstreamError(error)) {
        throw error;
      }
      upstreamRetriesTotal.inc();
      await withSpan(
        "news.upstream.retry",
        {
          "news.retry.attempt": attempt + 1,
          "news.retry.reason": retryReason(error),
        },
        () => sleep(retryDelayMs(attempt), signal)
      );
    }
  }
}
