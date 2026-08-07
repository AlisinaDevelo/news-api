import type { Server } from "node:http";
import type { Duplex } from "node:stream";
import {
  resolveHttpServerLogSettings,
  type HttpServerLogSettings,
} from "../config/httpServer";
import { logger } from "../logger";
import {
  httpServerEventsTotal,
  httpServerLogSuppressedTotal,
} from "../metrics/register";

export type HttpClientErrorEvent =
  | "client_error"
  | "request_timeout"
  | "header_overflow"
  | "chunk_extensions_overflow";

export const HTTP_SERVER_DROPPED_REQUEST_EVENT = "dropped_request" as const;
export type HttpServerEvent = HttpClientErrorEvent | typeof HTTP_SERVER_DROPPED_REQUEST_EVENT;

type HttpClientError = Error & { code?: string };
type HttpSocket = Duplex & {
  _httpMessage?: { _headerSent?: boolean };
};

export interface HttpServerLogDecision {
  emit: boolean;
  suppressed: number;
}

type HttpServerLogState = {
  windowStartedAt: number;
  emitted: number;
  suppressed: number;
};

export class HttpServerLogLimiter {
  private readonly states = new Map<HttpServerEvent, HttpServerLogState>();

  public constructor(
    private readonly burst: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now
  ) {}

  public take(event: HttpServerEvent): HttpServerLogDecision {
    const currentTime = this.now();
    const existing = this.states.get(event);

    if (existing === undefined || currentTime - existing.windowStartedAt >= this.windowMs) {
      const suppressed = existing?.suppressed ?? 0;
      this.states.set(event, {
        windowStartedAt: currentTime,
        emitted: 1,
        suppressed: 0,
      });
      return { emit: true, suppressed };
    }

    if (existing.emitted < this.burst) {
      existing.emitted += 1;
      return { emit: true, suppressed: 0 };
    }

    existing.suppressed += 1;
    return { emit: false, suppressed: 0 };
  }
}

const CLIENT_ERROR_RESPONSES: Record<HttpClientErrorEvent, string> = {
  client_error: "HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n",
  request_timeout: "HTTP/1.1 408 Request Timeout\r\nConnection: close\r\n\r\n",
  header_overflow: "HTTP/1.1 431 Request Header Fields Too Large\r\nConnection: close\r\n\r\n",
  chunk_extensions_overflow: "HTTP/1.1 413 Payload Too Large\r\nConnection: close\r\n\r\n",
};

const instrumentedServers = new WeakSet<Server>();
const defaultHttpServerLogLimiter = (() => {
  const settings = resolveHttpServerLogSettings();
  return new HttpServerLogLimiter(settings.burst, settings.windowMs);
})();

function logHttpServerEvent(
  event: HttpServerEvent,
  message: string,
  limiter: HttpServerLogLimiter
): void {
  if (!logger.isLevelEnabled("warn")) {
    return;
  }

  const decision = limiter.take(event);
  if (!decision.emit) {
    httpServerLogSuppressedTotal.inc({ event });
    return;
  }

  const fields: { event: HttpServerEvent; suppressed?: number } = { event };
  if (decision.suppressed > 0) {
    fields.suppressed = decision.suppressed;
  }
  logger.warn(fields, message);
}

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

export function handleHttpClientError(
  error: Error,
  socket: Duplex,
  limiter = defaultHttpServerLogLimiter
): void {
  const event = classifyHttpClientError(error);
  httpServerEventsTotal.inc({ event });
  logHttpServerEvent(event, "HTTP client transport error", limiter);

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

export function instrumentHttpServer(
  server: Server,
  logSettings: HttpServerLogSettings = resolveHttpServerLogSettings()
): Server {
  if (instrumentedServers.has(server)) {
    return server;
  }

  instrumentedServers.add(server);
  const limiter = new HttpServerLogLimiter(logSettings.burst, logSettings.windowMs);
  server.on("clientError", (error, socket) => handleHttpClientError(error, socket, limiter));
  server.on("dropRequest", () => {
    httpServerEventsTotal.inc({ event: HTTP_SERVER_DROPPED_REQUEST_EVENT });
    logHttpServerEvent(
      HTTP_SERVER_DROPPED_REQUEST_EVENT,
      "HTTP request dropped after per-socket request limit",
      limiter
    );
  });
  return server;
}
