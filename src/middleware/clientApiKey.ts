import { createHash, timingSafeEqual } from "node:crypto";
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

function digestClientKey(key: string): Buffer {
  return createHash("sha256").update(key, "utf8").digest();
}

function matchesClientKey(provided: string, configuredKeys: string[]): boolean {
  const providedDigest = digestClientKey(provided);
  let matches = 0;

  for (const configuredKey of configuredKeys) {
    const configuredDigest = digestClientKey(configuredKey);
    matches += Number(timingSafeEqual(providedDigest, configuredDigest));
  }

  return matches > 0;
}

export function clientApiKeyGate(req: Request, _res: Response, next: NextFunction): void {
  const keys = parseClientKeys();
  if (keys.length === 0) {
    next();
    return;
  }
  const provided = req.headers["x-api-key"];
  if (typeof provided !== "string" || !matchesClientKey(provided, keys)) {
    next(new HttpError(401, "Invalid or missing API key", "invalid_api_key"));
    return;
  }
  next();
}
