import { randomUUID } from "crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import pino from "pino";
import pinoHttp from "pino-http";
import { boundedRequestPath, normalizeRequestId } from "./http/requestId";
import { requestIdRejectionsTotal } from "./metrics/register";

function resolveLevel(): string {
  if (process.env.LOG_LEVEL) {
    return process.env.LOG_LEVEL;
  }
  if (process.env.NODE_ENV === "test" || process.env.VITEST === "true") {
    return "silent";
  }
  return "info";
}

export const logger = pino({
  level: resolveLevel(),
});

type LoggableRequest = IncomingMessage & { originalUrl?: string };

export function serializeHttpRequest(request: LoggableRequest): {
  id: string | undefined;
  method: string | undefined;
  path: string;
} {
  return {
    id: normalizeRequestId(request.id),
    method: request.method,
    path: boundedRequestPath(request.originalUrl ?? request.url),
  };
}

export function serializeHttpResponse(response: ServerResponse): { statusCode: number } {
  return { statusCode: response.statusCode };
}

export function createHttpLogger(baseLogger = logger) {
  return pinoHttp({
    logger: baseLogger,
    genReqId: (req, res) => {
      const raw = req.headers["x-request-id"];
      const normalized = normalizeRequestId(raw);
      if (raw !== undefined && normalized === undefined) {
        requestIdRejectionsTotal.inc();
      }
      const id = normalized ?? randomUUID();
      res.setHeader("x-request-id", id);
      return id;
    },
    serializers: {
      err: pino.stdSerializers.err,
      req: serializeHttpRequest,
      res: serializeHttpResponse,
    },
    wrapSerializers: false,
    quietReqLogger: true,
    quietResLogger: true,
    customProps: (req) => {
      const request = req as LoggableRequest;
      return {
        method: request.method,
        path: boundedRequestPath(request.originalUrl ?? request.url),
      };
    },
    customLogLevel: (_req, res, err) => {
      if (err !== undefined || res.statusCode >= 500) {
        return "error";
      }
      if (res.statusCode >= 400) {
        return "warn";
      }
      return "info";
    },
  });
}

export const httpLogger = createHttpLogger();
