import { Request, Response, NextFunction } from "express";
import { HttpError } from "../errors/HttpError";
import { logger } from "../logger";
import { requestId } from "../http/responses";

/** Avoid `instanceof` alone: test runners may load duplicate class copies. */
function isHttpError(err: unknown): err is HttpError {
  if (!(err instanceof Error) || err.name !== "HttpError") {
    return false;
  }
  const code = (err as HttpError).statusCode;
  return typeof code === "number" && code >= 400 && code < 600;
}

function usesStructuredErrors(req: Request): boolean {
  return req.path.startsWith("/api/v1/");
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const log = req.log ?? logger;

  if (isHttpError(err)) {
    if (err.statusCode >= 500) {
      log.error({ err, statusCode: err.statusCode }, err.message);
    } else {
      log.warn({ err, statusCode: err.statusCode }, err.message);
    }
    if (usesStructuredErrors(req)) {
      res.status(err.statusCode).json({
        error: {
          code: err.code,
          message: err.message,
          requestId: requestId(req),
        },
      });
      return;
    }
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  if (err instanceof Error) {
    log.error({ err }, err.message);
    if (usesStructuredErrors(req)) {
      res.status(500).json({
        error: {
          code: "internal_error",
          message: "Internal server error",
          requestId: requestId(req),
        },
      });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
    return;
  }
  log.error({ err }, "unknown error");
  if (usesStructuredErrors(req)) {
    res.status(500).json({
      error: {
        code: "internal_error",
        message: "Internal server error",
        requestId: requestId(req),
      },
    });
    return;
  }
  res.status(500).json({ error: "Internal server error" });
}
