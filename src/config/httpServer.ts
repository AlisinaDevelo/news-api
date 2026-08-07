import { createServer, type RequestListener, type Server } from "node:http";
import { resolveNonNegativeIntegerEnv, resolvePositiveIntegerEnv } from "./numbers";

export const DEFAULT_SERVER_REQUEST_TIMEOUT_MS = 75_000;
export const MAX_SERVER_REQUEST_TIMEOUT_MS = 120_000;
export const DEFAULT_SERVER_HEADERS_TIMEOUT_MS = 10_000;
export const MAX_SERVER_HEADERS_TIMEOUT_MS = 60_000;
export const DEFAULT_SERVER_KEEP_ALIVE_TIMEOUT_MS = 5_000;
export const MAX_SERVER_KEEP_ALIVE_TIMEOUT_MS = 120_000;
export const DEFAULT_SERVER_MAX_REQUESTS_PER_SOCKET = 1_000;
export const MAX_SERVER_MAX_REQUESTS_PER_SOCKET = 10_000;
export const DEFAULT_SERVER_MAX_HEADER_SIZE_BYTES = 16_384;
export const MAX_SERVER_MAX_HEADER_SIZE_BYTES = 65_536;
export const DEFAULT_SERVER_TRANSPORT_LOG_BURST = 10;
export const MAX_SERVER_TRANSPORT_LOG_BURST = 100;
export const DEFAULT_SERVER_TRANSPORT_LOG_WINDOW_MS = 60_000;
export const MAX_SERVER_TRANSPORT_LOG_WINDOW_MS = 300_000;

export function resolveServerRequestTimeoutMs(
  rawValue = process.env.SERVER_REQUEST_TIMEOUT_MS
): number {
  return resolvePositiveIntegerEnv(
    rawValue,
    DEFAULT_SERVER_REQUEST_TIMEOUT_MS,
    MAX_SERVER_REQUEST_TIMEOUT_MS
  );
}

export function resolveServerHeadersTimeoutMs(
  rawValue = process.env.SERVER_HEADERS_TIMEOUT_MS,
  requestTimeoutMs = resolveServerRequestTimeoutMs()
): number {
  const maximum = Math.min(MAX_SERVER_HEADERS_TIMEOUT_MS, requestTimeoutMs);
  const fallback = Math.min(DEFAULT_SERVER_HEADERS_TIMEOUT_MS, maximum);
  return resolvePositiveIntegerEnv(rawValue, fallback, maximum);
}

export function resolveServerKeepAliveTimeoutMs(
  rawValue = process.env.SERVER_KEEP_ALIVE_TIMEOUT_MS
): number {
  return resolvePositiveIntegerEnv(
    rawValue,
    DEFAULT_SERVER_KEEP_ALIVE_TIMEOUT_MS,
    MAX_SERVER_KEEP_ALIVE_TIMEOUT_MS
  );
}

export function resolveServerMaxRequestsPerSocket(
  rawValue = process.env.SERVER_MAX_REQUESTS_PER_SOCKET
): number {
  return resolveNonNegativeIntegerEnv(
    rawValue,
    DEFAULT_SERVER_MAX_REQUESTS_PER_SOCKET,
    MAX_SERVER_MAX_REQUESTS_PER_SOCKET
  );
}

export function resolveServerMaxHeaderSizeBytes(
  rawValue = process.env.SERVER_MAX_HEADER_SIZE_BYTES
): number {
  return resolvePositiveIntegerEnv(
    rawValue,
    DEFAULT_SERVER_MAX_HEADER_SIZE_BYTES,
    MAX_SERVER_MAX_HEADER_SIZE_BYTES
  );
}

export function resolveServerTransportLogBurst(
  rawValue = process.env.SERVER_TRANSPORT_LOG_BURST
): number {
  return resolvePositiveIntegerEnv(
    rawValue,
    DEFAULT_SERVER_TRANSPORT_LOG_BURST,
    MAX_SERVER_TRANSPORT_LOG_BURST
  );
}

export function resolveServerTransportLogWindowMs(
  rawValue = process.env.SERVER_TRANSPORT_LOG_WINDOW_MS
): number {
  return resolvePositiveIntegerEnv(
    rawValue,
    DEFAULT_SERVER_TRANSPORT_LOG_WINDOW_MS,
    MAX_SERVER_TRANSPORT_LOG_WINDOW_MS
  );
}

export interface HttpServerSettings {
  requestTimeout: number;
  headersTimeout: number;
  keepAliveTimeout: number;
  maxRequestsPerSocket: number;
  maxHeaderSize: number;
}

export interface HttpServerLogSettings {
  burst: number;
  windowMs: number;
}

export function resolveHttpServerSettings(): HttpServerSettings {
  const requestTimeout = resolveServerRequestTimeoutMs();
  return {
    requestTimeout,
    headersTimeout: resolveServerHeadersTimeoutMs(undefined, requestTimeout),
    keepAliveTimeout: resolveServerKeepAliveTimeoutMs(),
    maxRequestsPerSocket: resolveServerMaxRequestsPerSocket(),
    maxHeaderSize: resolveServerMaxHeaderSizeBytes(),
  };
}

export function resolveHttpServerLogSettings(): HttpServerLogSettings {
  return {
    burst: resolveServerTransportLogBurst(),
    windowMs: resolveServerTransportLogWindowMs(),
  };
}

export function configureHttpServer(
  server: Server,
  settings = resolveHttpServerSettings()
): Server {
  server.requestTimeout = settings.requestTimeout;
  server.headersTimeout = settings.headersTimeout;
  server.keepAliveTimeout = settings.keepAliveTimeout;
  server.maxRequestsPerSocket = settings.maxRequestsPerSocket;
  return server;
}

export function createConfiguredHttpServer(
  requestListener: RequestListener,
  settings = resolveHttpServerSettings()
): Server {
  return configureHttpServer(
    createServer({ maxHeaderSize: settings.maxHeaderSize }, requestListener),
    settings
  );
}
