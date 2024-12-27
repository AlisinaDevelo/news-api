import { Request, Response, NextFunction } from "express";
import { HttpError } from "../errors/HttpError";
import { logger } from "../logger";

/** Avoid `instanceof` alone: test runners may load duplicate class copies. */
function isHttpError(err: unknown): err is HttpError {
  if (!(err instanceof Error) || err.name !== "HttpError") {
    return false;
  }
  const code = (err as HttpError).statusCode;
  return typeof code === "number" && code >= 400 && code < 600;
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
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  if (err instanceof Error) {
    log.error({ err }, err.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }
  log.error({ err }, "unknown error");
  res.status(500).json({ error: "Internal server error" });
}
