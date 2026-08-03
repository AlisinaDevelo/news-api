import axios from "axios";
import { UPSTREAM_BASE_URL, UPSTREAM_TIMEOUT_MS } from "../config/upstream";
import { HttpError } from "../errors/HttpError";
import {
  upstreamCircuitEventsTotal,
  upstreamRequestDurationSeconds,
  upstreamRequestsTotal,
} from "../metrics/register";
import type { Article, ArticleSource } from "../types/article";
import { ArticleSearchOptions } from "../types/search";

export interface NewsProvider {
  search(options: ArticleSearchOptions): Promise<Article[]>;
}

interface CircuitState {
  failures: number;
  openedAt: number | undefined;
  halfOpenInFlight: boolean;
}

const circuit: CircuitState = {
  failures: 0,
  openedAt: undefined,
  halfOpenInFlight: false,
};

function failureThreshold(): number {
  const raw = Number(process.env.UPSTREAM_CIRCUIT_FAILURE_THRESHOLD ?? 3);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 3;
}

function cooldownMs(): number {
  const raw = Number(process.env.UPSTREAM_CIRCUIT_COOLDOWN_MS ?? 30_000);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 300_000) : 30_000;
}

function assertCircuitAllowsRequest(now = Date.now()): void {
  if (circuit.openedAt === undefined && circuit.halfOpenInFlight) {
    upstreamCircuitEventsTotal.inc({ event: "short_circuit" });
    throw new HttpError(
      503,
      "Upstream news service temporarily unavailable",
      "upstream_circuit_open"
    );
  }

  if (circuit.openedAt === undefined) {
    return;
  }

  if (now - circuit.openedAt < cooldownMs()) {
    upstreamCircuitEventsTotal.inc({ event: "short_circuit" });
    throw new HttpError(
      503,
      "Upstream news service temporarily unavailable",
      "upstream_circuit_open"
    );
  }

  circuit.openedAt = undefined;
  circuit.halfOpenInFlight = true;
  upstreamCircuitEventsTotal.inc({ event: "half_open" });
}

function recordProviderSuccess(): void {
  if (circuit.failures > 0 || circuit.openedAt !== undefined || circuit.halfOpenInFlight) {
    upstreamCircuitEventsTotal.inc({ event: "closed" });
  }
  circuit.failures = 0;
  circuit.openedAt = undefined;
  circuit.halfOpenInFlight = false;
}

function recordProviderFailure(): void {
  circuit.halfOpenInFlight = false;
  circuit.failures += 1;
  if (circuit.failures >= failureThreshold() && circuit.openedAt === undefined) {
    circuit.openedAt = Date.now();
    upstreamCircuitEventsTotal.inc({ event: "opened" });
  }
}

/** @internal tests */
export function resetGNewsCircuitForTests(): void {
  circuit.failures = 0;
  circuit.openedAt = undefined;
  circuit.halfOpenInFlight = false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isArticleSource(value: unknown): value is ArticleSource {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.url === "string"
  );
}

function isArticle(value: unknown): value is Article {
  return (
    isRecord(value) &&
    typeof value.title === "string" &&
    isStringOrNull(value.description) &&
    isStringOrNull(value.content) &&
    typeof value.url === "string" &&
    isStringOrNull(value.image) &&
    typeof value.publishedAt === "string" &&
    isArticleSource(value.source)
  );
}

function normalizeArticles(data: unknown): Article[] {
  if (
    data === null ||
    typeof data !== "object" ||
    !("articles" in data) ||
    !Array.isArray((data as { articles: unknown }).articles)
  ) {
    throw new HttpError(502, "Invalid response from news provider", "invalid_provider_payload");
  }

  const articles = (data as { articles: unknown[] }).articles;
  if (!articles.every(isArticle)) {
    throw new HttpError(502, "Invalid response from news provider", "invalid_provider_payload");
  }
  return articles;
}

function toProviderParams(options: ArticleSearchOptions): Record<string, string | number | undefined> {
  return {
    q: options.query,
    max: options.count,
    page: options.page,
    token: process.env.GNEWS_API_KEY,
    lang: options.lang,
    country: options.country,
    from: options.from,
    to: options.to,
    sortby: options.sortBy,
  };
}

export class GNewsProvider implements NewsProvider {
  async search(options: ArticleSearchOptions): Promise<Article[]> {
    assertCircuitAllowsRequest();
    const stopUpstreamTimer = upstreamRequestDurationSeconds.startTimer();

    try {
      const response = await axios.get<{ articles: Article[] }>(`${UPSTREAM_BASE_URL}/search`, {
        params: toProviderParams(options),
        timeout: UPSTREAM_TIMEOUT_MS,
        validateStatus: (s) => s >= 200 && s < 300,
      });

      const articles = normalizeArticles(response.data);
      upstreamRequestsTotal.inc({ outcome: "success" });
      stopUpstreamTimer({ outcome: "success" });
      recordProviderSuccess();
      return articles;
    } catch (err) {
      const outcome =
        err instanceof HttpError && err.statusCode === 502 ? "invalid_payload" : "error";
      upstreamRequestsTotal.inc({ outcome });
      stopUpstreamTimer({ outcome });
      recordProviderFailure();
      if (axios.isAxiosError(err)) {
        throw new HttpError(502, "Upstream news service unavailable", "upstream_unavailable");
      }
      throw err;
    }
  }
}

export const newsProvider: NewsProvider = new GNewsProvider();
