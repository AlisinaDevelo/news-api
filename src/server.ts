import "dotenv/config";
import "./otel-bootstrap";
import app from "./app";
import { disconnectCacheStore } from "./cache/store";
import { requireApiKeyUnlessTest } from "./config/env";
import { resolvePositiveIntegerEnv } from "./config/numbers";
import { logger } from "./logger";
import { disconnectRateLimitStore } from "./middleware/rateLimit";
import { shutdownTracing } from "./tracing";
import { createShutdownHandler } from "./runtime/shutdown";

requireApiKeyUnlessTest();

const PORT = resolvePositiveIntegerEnv(process.env.PORT, 3000, 65_535);
const shutdownTimeoutMs = resolvePositiveIntegerEnv(process.env.SHUTDOWN_TIMEOUT_MS, 10_000);

const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, "server listening");
});

const shutdown = createShutdownHandler({
  server,
  timeoutMs: shutdownTimeoutMs,
  cleanup: async () => {
    try {
      await disconnectCacheStore();
    } catch (e) {
      logger.error({ err: e }, "cache disconnect error");
    }
    try {
      await disconnectRateLimitStore();
    } catch (e) {
      logger.error({ err: e }, "rate-limit disconnect error");
    }
    try {
      await shutdownTracing();
    } catch (e) {
      logger.error({ err: e }, "tracing shutdown error");
    }
  },
  onStart: (signal) => logger.info({ signal }, "shutdown signal received"),
  onRepeat: (signal) => logger.warn({ signal }, "shutdown already in progress"),
  onForced: () => logger.error({ ms: shutdownTimeoutMs }, "forced exit after shutdown timeout"),
  onCloseError: (err) => logger.error({ err }, "error during server close"),
  onClosed: () => logger.info("http server closed"),
  onCleanupError: (err) => logger.error({ err }, "shutdown cleanup error"),
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  shutdown("SIGINT");
});
