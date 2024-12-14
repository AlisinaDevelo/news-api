import express from "express";
import routes from "./routes";
import { errorHandler } from "./middleware/errorHandler";
import { securityHeaders } from "./middleware/security";

const app = express();

app.use(securityHeaders);
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.get("/", (_req, res) => {
  res.json({ name: "news-api", docs: "See README.md", health: "/health" });
});

app.use("/api", routes);

app.use(errorHandler);

export default app;
