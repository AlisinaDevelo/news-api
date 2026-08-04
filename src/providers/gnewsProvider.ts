import axios from "axios";
import { resolvePositiveIntegerEnv } from "../config/numbers";
import { UPSTREAM_BASE_URL, UPSTREAM_TIMEOUT_MS } from "../config/upstream";
import { MAX_ARTICLE_COUNT, MAX_UPSTREAM_RESPONSE_BYTES } from "../constants";
import { HttpError } from "../errors/HttpError";
import {
  upstreamCircuitEventsTotal,
  upstreamRequestDurationSeconds,
  upstreamRequestsTotal,
} from "../metrics/register";
import { isArticleList, type Article } from "../types/article";
import { ArticleSearchOptions } from "../types/search";
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

export class GNewsProvider implements NewsProvider {
  async search(options: ArticleSearchOptions): Promise<Article[]> {
    assertCircuitAllowsRequest();
    const stopUpstreamTimer = upstreamRequestDurationSeconds.startTimer();

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
