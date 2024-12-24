import { Request, Response, NextFunction } from "express";
import { HttpError } from "../errors/HttpError";
import { logger } from "../logger";

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const log = req.log ?? logger;

  if (err instanceof HttpError) {
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
