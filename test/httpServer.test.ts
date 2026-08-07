import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import {
  configureHttpServer,
  createConfiguredHttpServer,
  DEFAULT_SERVER_MAX_HEADER_SIZE_BYTES,
  MAX_SERVER_MAX_HEADER_SIZE_BYTES,
  DEFAULT_SERVER_TRANSPORT_LOG_BURST,
  DEFAULT_SERVER_TRANSPORT_LOG_WINDOW_MS,
  MAX_SERVER_TRANSPORT_LOG_BURST,
  MAX_SERVER_TRANSPORT_LOG_WINDOW_MS,
  resolveHttpServerSettings,
  resolveHttpServerLogSettings,
  resolveServerHeadersTimeoutMs,
  resolveServerKeepAliveTimeoutMs,
  resolveServerMaxHeaderSizeBytes,
  resolveServerMaxRequestsPerSocket,
  resolveServerRequestTimeoutMs,
  resolveServerTransportLogBurst,
  resolveServerTransportLogWindowMs,
} from "../src/config/httpServer";

describe("HTTP server configuration", () => {
  it("uses defaults compatible with the provider deadline", () => {
    expect(resolveServerRequestTimeoutMs(undefined)).toBe(75_000);
    expect(resolveServerHeadersTimeoutMs(undefined, 75_000)).toBe(10_000);
    expect(resolveServerKeepAliveTimeoutMs(undefined)).toBe(5_000);
    expect(resolveServerMaxRequestsPerSocket(undefined)).toBe(1_000);
    expect(resolveServerMaxHeaderSizeBytes(undefined)).toBe(DEFAULT_SERVER_MAX_HEADER_SIZE_BYTES);
    expect(resolveServerTransportLogBurst(undefined)).toBe(DEFAULT_SERVER_TRANSPORT_LOG_BURST);
    expect(resolveServerTransportLogWindowMs(undefined)).toBe(DEFAULT_SERVER_TRANSPORT_LOG_WINDOW_MS);
    expect(resolveHttpServerLogSettings()).toEqual({
      burst: DEFAULT_SERVER_TRANSPORT_LOG_BURST,
      windowMs: DEFAULT_SERVER_TRANSPORT_LOG_WINDOW_MS,
    });
    expect(resolveHttpServerSettings()).toEqual({
      requestTimeout: 75_000,
      headersTimeout: 10_000,
      keepAliveTimeout: 5_000,
      maxRequestsPerSocket: 1_000,
      maxHeaderSize: DEFAULT_SERVER_MAX_HEADER_SIZE_BYTES,
    });
  });

  it("rejects invalid values, clamps maxima, and preserves header ordering", () => {
    expect(resolveServerRequestTimeoutMs("nope")).toBe(75_000);
    expect(resolveServerRequestTimeoutMs("0")).toBe(75_000);
    expect(resolveServerRequestTimeoutMs("1.5")).toBe(75_000);
    expect(resolveServerRequestTimeoutMs("900000")).toBe(120_000);
    expect(resolveServerHeadersTimeoutMs("90000", 20_000)).toBe(20_000);
    expect(resolveServerHeadersTimeoutMs("0", 20_000)).toBe(10_000);
    expect(resolveServerKeepAliveTimeoutMs("900000")).toBe(120_000);
    expect(resolveServerMaxRequestsPerSocket("900000")).toBe(10_000);
    expect(resolveServerMaxRequestsPerSocket("0")).toBe(0);
    expect(resolveServerMaxHeaderSizeBytes("nope")).toBe(DEFAULT_SERVER_MAX_HEADER_SIZE_BYTES);
    expect(resolveServerMaxHeaderSizeBytes("0")).toBe(DEFAULT_SERVER_MAX_HEADER_SIZE_BYTES);
    expect(resolveServerMaxHeaderSizeBytes("1.5")).toBe(DEFAULT_SERVER_MAX_HEADER_SIZE_BYTES);
    expect(resolveServerMaxHeaderSizeBytes("900000")).toBe(MAX_SERVER_MAX_HEADER_SIZE_BYTES);
    expect(resolveServerTransportLogBurst("nope")).toBe(DEFAULT_SERVER_TRANSPORT_LOG_BURST);
    expect(resolveServerTransportLogBurst("0")).toBe(DEFAULT_SERVER_TRANSPORT_LOG_BURST);
    expect(resolveServerTransportLogBurst("900000")).toBe(MAX_SERVER_TRANSPORT_LOG_BURST);
    expect(resolveServerTransportLogWindowMs("1.5")).toBe(DEFAULT_SERVER_TRANSPORT_LOG_WINDOW_MS);
    expect(resolveServerTransportLogWindowMs("900000")).toBe(MAX_SERVER_TRANSPORT_LOG_WINDOW_MS);
  });

  it("applies settings to the actual Node HTTP server", () => {
    const server = createServer();
    configureHttpServer(server, {
      requestTimeout: 80_000,
      headersTimeout: 12_000,
      keepAliveTimeout: 4_000,
      maxRequestsPerSocket: 250,
      maxHeaderSize: 24_000,
    });

    expect(server.requestTimeout).toBe(80_000);
    expect(server.headersTimeout).toBe(12_000);
    expect(server.keepAliveTimeout).toBe(4_000);
    expect(server.maxRequestsPerSocket).toBe(250);
  });

  it("passes the header-size budget to Node at server construction", () => {
    const server = createConfiguredHttpServer((_req, res) => res.end(), {
      requestTimeout: 80_000,
      headersTimeout: 12_000,
      keepAliveTimeout: 4_000,
      maxRequestsPerSocket: 250,
      maxHeaderSize: 24_000,
    });

    expect((server as typeof server & { maxHeaderSize: number }).maxHeaderSize).toBe(24_000);
  });
});
