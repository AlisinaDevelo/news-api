import axios, { AxiosError } from "axios";
import { resolvePositiveIntegerEnv } from "../config/numbers";
import { UPSTREAM_BASE_URL, UPSTREAM_TIMEOUT_MS } from "../config/upstream";
import { MAX_ARTICLE_COUNT, MAX_UPSTREAM_RESPONSE_BYTES } from "../constants";
import { HttpError } from "../errors/HttpError";
import { retryAfterFromHeaders } from "../http/retryAfter";
import {
  upstreamCircuitEventsTotal,
  upstreamRequestDurationSeconds,
  upstreamRequestsTotal,
} from "../metrics/register";
import { isArticleList, type Article } from "../types/article";
import { ArticleSearchOptions } from "../types/search";
import { withSpan } from "../tracing";
import { withUpstreamRetries } from "./retry";

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
  return resolvePositiveIntegerEnv(process.env.UPSTREAM_CIRCUIT_FAILURE_THRESHOLD, 3);
}

function cooldownMs(): number {
  return resolvePositiveIntegerEnv(process.env.UPSTREAM_CIRCUIT_COOLDOWN_MS, 30_000, 300_000);
}

function assertCircuitAllowsRequest(now = Date.now()): "closed" | "half_open" {
  if (circuit.openedAt === undefined && circuit.halfOpenInFlight) {
    upstreamCircuitEventsTotal.inc({ event: "short_circuit" });
    throw new HttpError(
      503,
      "Upstream news service temporarily unavailable",
      "upstream_circuit_open"
    );
  }

  if (circuit.openedAt === undefined) {
    return "closed";
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
  return "half_open";
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

function shouldRecordProviderFailure(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return true;
  }
  const status = error.response?.status;
  if (status === undefined) {
    return true;
  }
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/** @internal tests */
export function resetGNewsCircuitForTests(): void {
  circuit.failures = 0;
  circuit.openedAt = undefined;
  circuit.halfOpenInFlight = false;
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

  const articles = (data as { articles: unknown }).articles;
  if (!isArticleList(articles) || articles.length > MAX_ARTICLE_COUNT) {
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

function mapAxiosError(error: AxiosError): HttpError {
  const status = error.response?.status;
  const retryAfter = retryAfterFromHeaders(error.response?.headers);

  if (status === 429) {
    return new HttpError(
      429,
      "Upstream news service rate limit exceeded",
      "upstream_rate_limited",
      retryAfter
    );
  }
  if (status === 503) {
    return new HttpError(
      503,
      "Upstream news service temporarily unavailable",
      "upstream_unavailable",
      retryAfter
    );
  }
  return new HttpError(502, "Upstream news service unavailable", "upstream_unavailable");
}

export class GNewsProvider implements NewsProvider {
  async search(options: ArticleSearchOptions): Promise<Article[]> {
    const circuitState = await withSpan("news.upstream.circuit", {}, async (span) => {
      try {
        const state = assertCircuitAllowsRequest();
        span.setAttribute("news.circuit.state", state);
        return state;
      } catch (err) {
        span.setAttribute("news.circuit.state", "open");
        span.setAttribute("news.circuit.event", "short_circuit");
        throw err;
      }
    });

    const stopUpstreamTimer = upstreamRequestDurationSeconds.startTimer();
    return withSpan(
      "news.upstream.request",
      {
        "news.upstream.provider": "gnews",
        "news.circuit.state": circuitState,
      },
      async (span) => {
        try {
          const response = await withUpstreamRetries(() =>
            axios.get<{ articles: Article[] }>(`${UPSTREAM_BASE_URL}/search`, {
              params: toProviderParams(options),
              timeout: UPSTREAM_TIMEOUT_MS,
              maxContentLength: MAX_UPSTREAM_RESPONSE_BYTES,
              validateStatus: (s) => s >= 200 && s < 300,
            })
          );

          const articles = normalizeArticles(response.data);
          span.setAttribute("news.upstream.outcome", "success");
          upstreamRequestsTotal.inc({ outcome: "success" });
          stopUpstreamTimer({ outcome: "success" });
          recordProviderSuccess();
          return articles;
        } catch (err) {
          const outcome =
            err instanceof HttpError && err.statusCode === 502 ? "invalid_payload" : "error";
          span.setAttribute("news.upstream.outcome", outcome);
          upstreamRequestsTotal.inc({ outcome });
          stopUpstreamTimer({ outcome });
          if (shouldRecordProviderFailure(err)) {
            recordProviderFailure();
          }
          if (axios.isAxiosError(err)) {
            throw mapAxiosError(err);
          }
          throw err;
        }
      }
    );
  }
}

export const newsProvider: NewsProvider = new GNewsProvider();
