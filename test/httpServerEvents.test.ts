import { createServer, type Server } from "node:http";
import { connect, type Socket } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  classifyHttpClientError,
  handleHttpClientError,
  instrumentHttpServer,
} from "../src/runtime/httpServerEvents";
import { httpServerEventsTotal, register } from "../src/metrics/register";
import {
  createConfiguredHttpServer,
  resolveHttpServerSettings,
} from "../src/config/httpServer";
import type { Duplex } from "node:stream";

function errorWithCode(code: string): Error {
  return Object.assign(new Error("parser error"), { code });
}

function recordingSocket(headerSent = false): {
  socket: Duplex;
  writes: string[];
  destroyed: () => boolean;
} {
  let wasDestroyed = false;
  const writes: string[] = [];
  const socket = {
    destroyed: false,
    writable: true,
    _httpMessage: headerSent ? { _headerSent: true } : undefined,
    write(chunk: string): boolean {
      writes.push(chunk);
      return true;
    },
    destroy(): Duplex {
      wasDestroyed = true;
      return socket as unknown as Duplex;
    },
  } as unknown as Duplex;

  return {
    socket,
    writes,
    destroyed: () => wasDestroyed,
  };
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("server did not receive an address"));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function rawRequest(port: number, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket: Socket = connect(port, "127.0.0.1");
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("raw HTTP request timed out"));
    }, 2_000);

    socket.on("connect", () => socket.write(payload));
    socket.on("data", (chunk) => {
      chunks.push(chunk);
      const response = Buffer.concat(chunks).toString("ascii");
      if (response.includes("\r\n\r\n")) {
        clearTimeout(timer);
        socket.destroy();
        resolve(response);
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

describe("HTTP server transport events", () => {
  beforeEach(() => {
    httpServerEventsTotal.reset();
  });

  afterEach(() => {
    httpServerEventsTotal.reset();
  });

  it("classifies bounded parser error categories", () => {
    expect(classifyHttpClientError(errorWithCode("ERR_HTTP_REQUEST_TIMEOUT"))).toBe(
      "request_timeout"
    );
    expect(classifyHttpClientError(errorWithCode("HPE_HEADER_OVERFLOW"))).toBe(
      "header_overflow"
    );
    expect(classifyHttpClientError(errorWithCode("HPE_CHUNK_EXTENSIONS_OVERFLOW"))).toBe(
      "chunk_extensions_overflow"
    );
    expect(classifyHttpClientError(errorWithCode("unexpected"))).toBe("client_error");
  });

  it.each([
    ["ERR_HTTP_REQUEST_TIMEOUT", "408 Request Timeout"],
    ["HPE_HEADER_OVERFLOW", "431 Request Header Fields Too Large"],
    ["HPE_CHUNK_EXTENSIONS_OVERFLOW", "413 Payload Too Large"],
    ["unexpected", "400 Bad Request"],
  ])("preserves Node's response for %s", (code, statusLine) => {
    const recorded = recordingSocket();

    handleHttpClientError(errorWithCode(code), recorded.socket);

    expect(recorded.writes[0]).toContain(`HTTP/1.1 ${statusLine}`);
    expect(recorded.writes[0]).toContain("Connection: close");
    expect(recorded.destroyed()).toBe(true);
  });

  it("destroys a socket when a response has already started", () => {
    const recorded = recordingSocket(true);

    handleHttpClientError(new Error("parser error"), recorded.socket);

    expect(recorded.writes).toEqual([]);
    expect(recorded.destroyed()).toBe(true);
  });

  it("wires client errors once and counts malformed traffic", async () => {
    const server = instrumentHttpServer(createServer((_req, res) => res.end("ok")));
    const port = await listen(server);

    try {
      const response = await rawRequest(port, "not-http\r\n\r\n");

      expect(response).toContain("HTTP/1.1 400 Bad Request");
      expect(server.listenerCount("clientError")).toBe(1);
      expect(server.listenerCount("dropRequest")).toBe(1);
      expect(await register.metrics()).toContain(
        'news_http_server_events_total{event="client_error"} 1'
      );
    } finally {
      await close(server);
    }
  });

  it("returns 431 and counts an oversized request header", async () => {
    const server = instrumentHttpServer(
      createConfiguredHttpServer((_req, res) => res.end("ok"), {
        ...resolveHttpServerSettings(),
        maxHeaderSize: 1_024,
      })
    );
    const port = await listen(server);

    try {
      const response = await rawRequest(
        port,
        `GET / HTTP/1.1\r\nHost: localhost\r\nX-Large: ${"x".repeat(2_000)}\r\n\r\n`
      );

      expect(response).toContain("HTTP/1.1 431 Request Header Fields Too Large");
      expect(await register.metrics()).toContain(
        'news_http_server_events_total{event="header_overflow"} 1'
      );
    } finally {
      await close(server);
    }
  });

  it("counts requests dropped after the keep-alive limit", async () => {
    const server = instrumentHttpServer(createServer((_req, res) => res.end("ok")));
    server.maxRequestsPerSocket = 1;
    const port = await listen(server);

    try {
      const response = await rawRequest(
        port,
        "GET /one HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n" +
          "GET /two HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"
      );

      expect(response).toContain("HTTP/1.1 200 OK");
      expect(response).toContain("HTTP/1.1 503 Service Unavailable");
      expect(await register.metrics()).toContain(
        'news_http_server_events_total{event="dropped_request"} 1'
      );
    } finally {
      await close(server);
    }
  });
});
