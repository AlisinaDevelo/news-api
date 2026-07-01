import type { Request, Response, NextFunction } from "express";
import { HttpError } from "../errors/HttpError";

function parseClientKeys(): string[] {
  const raw = process.env.CLIENT_API_KEYS?.trim();
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

export function clientApiKeyGate(req: Request, _res: Response, next: NextFunction): void {
  const keys = parseClientKeys();
  if (keys.length === 0) {
    next();
    return;
  }
  const provided = req.headers["x-api-key"];
  if (typeof provided !== "string" || !keys.includes(provided)) {
    next(new HttpError(401, "Invalid or missing API key", "invalid_api_key"));
    return;
  }
  next();
}
