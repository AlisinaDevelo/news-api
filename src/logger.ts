import { randomUUID } from "crypto";
import pino from "pino";
import pinoHttp from "pino-http";

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

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const raw = req.headers["x-request-id"];
    const id = typeof raw === "string" && raw.trim() ? raw.trim() : randomUUID();
    res.setHeader("x-request-id", id);
    return id;
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
