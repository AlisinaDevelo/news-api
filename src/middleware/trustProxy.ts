import type { Express } from "express";

/** Enable when running behind a reverse proxy so rate limits use the real client IP (X-Forwarded-For). */
export function applyTrustProxy(app: Express): void {
  if (process.env.TRUST_PROXY === "1") {
    app.set("trust proxy", 1);
  }
}
