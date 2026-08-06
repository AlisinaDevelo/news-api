import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import {
  configureHttpServer,
  resolveHttpServerSettings,
  resolveServerHeadersTimeoutMs,
  resolveServerKeepAliveTimeoutMs,
  resolveServerMaxRequestsPerSocket,
  resolveServerRequestTimeoutMs,
} from "../src/config/httpServer";

describe("HTTP server configuration", () => {
  it("uses defaults compatible with the provider deadline", () => {
    expect(resolveServerRequestTimeoutMs(undefined)).toBe(75_000);
    expect(resolveServerHeadersTimeoutMs(undefined, 75_000)).toBe(10_000);
    expect(resolveServerKeepAliveTimeoutMs(undefined)).toBe(5_000);
    expect(resolveServerMaxRequestsPerSocket(undefined)).toBe(1_000);
    expect(resolveHttpServerSettings()).toEqual({
      requestTimeout: 75_000,
      headersTimeout: 10_000,
      keepAliveTimeout: 5_000,
      maxRequestsPerSocket: 1_000,
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
  });

  it("applies settings to the actual Node HTTP server", () => {
    const server = createServer();
    configureHttpServer(server, {
      requestTimeout: 80_000,
      headersTimeout: 12_000,
      keepAliveTimeout: 4_000,
      maxRequestsPerSocket: 250,
    });

    expect(server.requestTimeout).toBe(80_000);
    expect(server.headersTimeout).toBe(12_000);
    expect(server.keepAliveTimeout).toBe(4_000);
    expect(server.maxRequestsPerSocket).toBe(250);
  });
});
