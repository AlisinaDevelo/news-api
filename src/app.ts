import express from "express";
import routes from "./routes";
import { errorHandler } from "./middleware/errorHandler";
import { securityHeaders } from "./middleware/security";
import { apiRateLimiter } from "./middleware/rateLimit";
import { applyTrustProxy } from "./middleware/trustProxy";
import { httpLogger } from "./logger";

const app = express();

applyTrustProxy(app);
app.use(httpLogger);
app.use(securityHeaders);
app.use(express.json());
app.use(apiRateLimiter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.get("/ready", (_req, res) => {
  if (process.env.NODE_ENV === "test" || process.env.VITEST === "true") {
    res.json({ status: "ready" });
    return;
  }
  const key = process.env.GNEWS_API_KEY?.trim();
  if (!key) {
    res.status(503).json({ status: "not_ready", reason: "missing_api_key" });
    return;
  }
  res.json({ status: "ready" });
});

app.get("/", (_req, res) => {
  res.json({
    name: "news-api",
    readme: "README.md",
    openapi: "/docs/openapi.yaml (repository file)",
    health: "/health",
    ready: "/ready",
  });
});

app.use("/api", routes);

app.use(errorHandler);

export default app;
