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

app.get("/", (_req, res) => {
  res.json({ name: "news-api", docs: "See README.md", health: "/health" });
});

app.use("/api", routes);

app.use(errorHandler);

export default app;
