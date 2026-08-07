import type { Server } from "node:http";
import type { Duplex } from "node:stream";
import { logger } from "../logger";
import { httpServerEventsTotal } from "../metrics/register";

export type HttpClientErrorEvent =
  | "client_error"
  | "request_timeout"
  | "header_overflow"
  | "chunk_extensions_overflow";

export const HTTP_SERVER_DROPPED_REQUEST_EVENT = "dropped_request" as const;

type HttpClientError = Error & { code?: string };
type HttpSocket = Duplex & {
  _httpMessage?: { _headerSent?: boolean };
};

const CLIENT_ERROR_RESPONSES: Record<HttpClientErrorEvent, string> = {
  client_error: "HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n",
  request_timeout: "HTTP/1.1 408 Request Timeout\r\nConnection: close\r\n\r\n",
  header_overflow: "HTTP/1.1 431 Request Header Fields Too Large\r\nConnection: close\r\n\r\n",
  chunk_extensions_overflow: "HTTP/1.1 413 Payload Too Large\r\nConnection: close\r\n\r\n",
};

const instrumentedServers = new WeakSet<Server>();

export function classifyHttpClientError(error: Error): HttpClientErrorEvent {
  switch ((error as HttpClientError).code) {
    case "ERR_HTTP_REQUEST_TIMEOUT":
      return "request_timeout";
    case "HPE_HEADER_OVERFLOW":
      return "header_overflow";
    case "HPE_CHUNK_EXTENSIONS_OVERFLOW":
      return "chunk_extensions_overflow";
    default:
      return "client_error";
  }
}

function hasSentResponse(socket: HttpSocket): boolean {
  return socket._httpMessage?._headerSent === true;
}

export function handleHttpClientError(error: Error, socket: Duplex): void {
  const event = classifyHttpClientError(error);
  httpServerEventsTotal.inc({ event });
  logger.warn({ event }, "HTTP client transport error");

  const httpSocket = socket as HttpSocket;
  if (httpSocket.destroyed || !httpSocket.writable || hasSentResponse(httpSocket)) {
    httpSocket.destroy();
    return;
  }

  // Installing a clientError listener disables Node's default response path.
  try {
    httpSocket.write(CLIENT_ERROR_RESPONSES[event]);
  } finally {
    httpSocket.destroy();
  }
}

export function instrumentHttpServer(server: Server): Server {
  if (instrumentedServers.has(server)) {
    return server;
  }

  instrumentedServers.add(server);
  server.on("clientError", handleHttpClientError);
  server.on("dropRequest", () => {
    httpServerEventsTotal.inc({ event: HTTP_SERVER_DROPPED_REQUEST_EVENT });
    logger.warn(
      { event: HTTP_SERVER_DROPPED_REQUEST_EVENT },
      "HTTP request dropped after per-socket request limit"
    );
  });
  return server;
}
