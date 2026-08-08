import { Writable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import express from "express";
import pino from "pino";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  boundedRequestPath,
  MAX_LOG_PATH_LENGTH,
  MAX_REQUEST_ID_LENGTH,
  normalizeRequestId,
} from "../src/http/requestId";
import { createHttpLogger, serializeHttpRequest, serializeHttpResponse } from "../src/logger";

describe("HTTP logging privacy boundary", () => {
  it("accepts bounded safe request IDs and rejects unsafe values", () => {
    expect(normalizeRequestId(" trace_2026/08 ")).toBe("trace_2026/08");
    expect(normalizeRequestId("bad id")).toBeUndefined();
    expect(normalizeRequestId("x".repeat(MAX_REQUEST_ID_LENGTH + 1))).toBeUndefined();
    expect(normalizeRequestId(["trace-id"])).toBeUndefined();
  });

  it("serializes an allowlist without headers or query text", () => {
    const serialized = serializeHttpRequest({
      id: "trace-id",
      method: "GET",
      originalUrl: "/api/v1/articles?query=secret-search",
      url: "/api/v1/articles?query=secret-search",
      headers: {
        cookie: "session-secret",
        "x-api-key": "api-secret",
        "x-private-header": "private-value",
      },
    } as unknown as IncomingMessage & { originalUrl?: string });

    expect(serialized).toEqual({ id: "trace-id", method: "GET", path: "/api/v1/articles" });
    expect(JSON.stringify(serialized)).not.toContain("secret");
    expect(serialized).not.toHaveProperty("headers");
  });

  it("bounds logged paths and keeps response serialization minimal", () => {
    const path = `/${"x".repeat(MAX_LOG_PATH_LENGTH)}?query=secret-search`;
    const serialized = serializeHttpRequest({
      id: "trace-id",
      method: "GET",
      url: path,
    } as unknown as IncomingMessage & { originalUrl?: string });

    expect(serialized.path).toHaveLength(MAX_LOG_PATH_LENGTH);
    expect(serialized.path.endsWith("...")).toBe(true);
    expect(serialized.path).not.toContain("secret-search");
    expect(boundedRequestPath(undefined)).toBe("/");
    expect(serializeHttpResponse({ statusCode: 401 } as ServerResponse)).toEqual({
      statusCode: 401,
    });
  });

  it("keeps emitted access logs free of request headers and query text", async () => {
    const lines: string[] = [];
    const output = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const accessLogger = pino({ level: "info" }, output);
    const app = express();
    app.use(createHttpLogger(accessLogger));
    app.get("/secret", (_req, res) => res.end("ok"));

    await request(app)
      .get("/secret?query=secret-search")
      .set("X-API-Key", "api-secret")
      .set("Cookie", "session-secret")
      .set("X-Private-Header", "private-value")
      .set("X-Request-Id", "trace-id");
    accessLogger.flush();

    const logOutput = lines.join("");
    expect(logOutput).toContain('"reqId":"trace-id"');
    expect(logOutput).toContain('"path":"/secret"');
    expect(logOutput).not.toContain("api-secret");
    expect(logOutput).not.toContain("session-secret");
    expect(logOutput).not.toContain("private-value");
    expect(logOutput).not.toContain("secret-search");
  });
});
