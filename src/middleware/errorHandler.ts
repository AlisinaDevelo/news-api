import { Request, Response, NextFunction } from "express";
import { HttpError } from "../errors/HttpError";

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  if (err instanceof Error) {
    res.status(500).json({ error: "Internal server error" });
    return;
  }
  res.status(500).json({ error: "Internal server error" });
}
