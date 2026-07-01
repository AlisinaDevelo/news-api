import fs from "fs";
import path from "path";
import express from "express";
import routes from "./routes";
import { HttpError } from "./errors/HttpError";
import { errorHandler } from "./middleware/errorHandler";
import { securityHeaders } from "./middleware/security";
import { apiRateLimiter } from "./middleware/rateLimit";
import { applyTrustProxy } from "./middleware/trustProxy";
import { httpLogger } from "./logger";
import { metricsRequestObserver } from "./middleware/metricsHttp";
import { clientApiKeyGate } from "./middleware/clientApiKey";
import { register as metricsRegister } from "./metrics/register";

const openApiFile = path.resolve(process.cwd(), "docs", "openapi.yaml");

const app = express();

applyTrustProxy(app);
app.use(httpLogger);
app.use(metricsRequestObserver);
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

app.get("/openapi.yaml", (_req, res, next) => {
  if (!fs.existsSync(openApiFile)) {
    next(new HttpError(404, "OpenAPI spec not found"));
    return;
  }
  res.type("application/yaml");
  res.sendFile(openApiFile, (err) => {
    if (err) {
      next(err);
    }
  });
});

app.get("/metrics", async (_req, res, next) => {
  try {
    res.setHeader("Content-Type", metricsRegister.contentType);
    res.end(await metricsRegister.metrics());
  } catch (err) {
    next(err);
  }
});

app.get("/", (_req, res) => {
  res.json({
    name: "news-api",
    api: {
      current: "v1",
      v1: {
        articles: "/api/v1/articles",
        articleSearch: "/api/v1/articles/search",
        articleByTitle: "/api/v1/articles/title/{title}",
        sourceArticles: "/api/v1/sources/{source}/articles",
      },
      legacy: {
        articles: "/api/articles",
        articleByTitle: "/api/articles/title/{title}",
        sourceArticles: "/api/articles/source?source={source}",
      },
    },
    docs: {
      readme: "README.md",
      openapi: "/openapi.yaml",
      client: "docs/CLIENT.md",
      operations: "docs/OPERATIONS.md",
    },
    observability: {
      metrics: "/metrics",
      health: "/health",
      ready: "/ready",
    },
  });
});

app.use("/api", clientApiKeyGate, routes);

app.use(errorHandler);

export default app;
