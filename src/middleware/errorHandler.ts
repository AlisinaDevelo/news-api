import { Request, Response, NextFunction } from "express";
import { HttpError } from "../errors/HttpError";
import { logger } from "../logger";
import { requestId } from "../http/responses";
import { isRequestAbortedError } from "../runtime/requestCancellation";

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

function isMalformedPathError(err: unknown): err is URIError {
  return err instanceof Error && err.name === "URIError";
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const log = req.log ?? logger;

  if (isRequestAbortedError(err)) {
    return;
  }

  if (isHttpError(err)) {
    if (err.retryAfter !== undefined) {
      res.setHeader("Retry-After", err.retryAfter);
    }
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
  if (isMalformedPathError(err)) {
    const message = "Invalid URL-encoded path parameter";
    log.warn({ err, statusCode: 400 }, message);
    if (usesStructuredErrors(req)) {
      res.status(400).json({
        error: {
          code: "invalid_path_parameter",
          message,
          requestId: requestId(req),
        },
      });
      return;
    }
    res.status(400).json({ error: message });
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
