import http from "node:http";
import os from "node:os";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";

const require = createRequire(import.meta.url);

const providerDelayMs = Number(process.env.BENCHMARK_PROVIDER_DELAY_MS ?? 15);
const coldRequests = Number(process.env.BENCHMARK_COLD_REQUESTS ?? 300);
const coldConcurrency = Number(process.env.BENCHMARK_COLD_CONCURRENCY ?? 20);
const warmRequests = Number(process.env.BENCHMARK_WARM_REQUESTS ?? 500);
const warmConcurrency = Number(process.env.BENCHMARK_WARM_CONCURRENCY ?? 50);

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("expected TCP server address");
      }
      resolve(address.port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function percentile(values, p) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

async function runScenario({ baseUrl, name, requests, concurrency, queryFor }) {
  const latencies = [];
  let next = 0;
  let ok = 0;
  let failed = 0;
  const startedAt = performance.now();

  async function worker() {
    while (next < requests) {
      const index = next;
      next += 1;
      const query = encodeURIComponent(queryFor(index));
      const requestStartedAt = performance.now();
      try {
        const res = await fetch(`${baseUrl}/api/articles?query=${query}&count=5&lang=en`);
        const body = await res.json();
        if (!res.ok || !Array.isArray(body) || body.length !== 5) {
          failed += 1;
        } else {
          ok += 1;
          latencies.push(performance.now() - requestStartedAt);
        }
      } catch {
        failed += 1;
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  const durationMs = performance.now() - startedAt;

  return {
    name,
    requests,
    concurrency,
    ok,
    failed,
    durationMs,
    throughput: ok / (durationMs / 1000),
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
  };
}

function formatMs(value) {
  return value.toFixed(1);
}

function formatRate(value) {
  return value.toFixed(0);
}

function gitSha() {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

let providerRequests = 0;
const fakeProvider = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/search") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }

  providerRequests += 1;
  const query = url.searchParams.get("q") ?? "news";
  const max = Math.max(1, Math.min(Number(url.searchParams.get("max") ?? 5), 100));
  const articles = Array.from({ length: max }, (_, index) => ({
    title: `${query} headline ${index + 1}`,
    description: `Synthetic benchmark article ${index + 1}`,
    content: `Benchmark content for ${query}`,
    url: `https://example.test/${encodeURIComponent(query)}/${index + 1}`,
    image: null,
    publishedAt: "2026-01-01T00:00:00.000Z",
    source: {
      name: "Benchmark News",
      url: "https://example.test",
    },
  }));

  setTimeout(() => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ articles }));
  }, providerDelayMs);
});

const providerPort = await listen(fakeProvider);

process.env.GNEWS_API_KEY = "benchmark";
process.env.GNEWS_BASE_URL = `http://127.0.0.1:${providerPort}`;
process.env.DISABLE_RATE_LIMIT = "1";
process.env.HTTP_TIMEOUT_MS = "5000";
process.env.LOG_LEVEL = "silent";
process.env.NODE_ENV = "benchmark";

const { default: app } = require("../dist/app.js");
const { disconnectCacheStore } = require("../dist/cache/store.js");
const apiServer = http.createServer(app);
const apiPort = await listen(apiServer);
const baseUrl = `http://127.0.0.1:${apiPort}`;

try {
  const ready = await fetch(`${baseUrl}/ready`);
  if (!ready.ok) {
    throw new Error(`/ready returned HTTP ${ready.status}`);
  }

  providerRequests = 0;
  const cold = await runScenario({
    baseUrl,
    name: "Cold unique searches",
    requests: coldRequests,
    concurrency: coldConcurrency,
    queryFor: (index) => `cold-${index}`,
  });
  const coldUpstream = providerRequests;

  await fetch(`${baseUrl}/api/articles?query=warm-cache&count=5&lang=en`);
  providerRequests = 0;
  const warm = await runScenario({
    baseUrl,
    name: "Warm cached search",
    requests: warmRequests,
    concurrency: warmConcurrency,
    queryFor: () => "warm-cache",
  });
  const warmUpstream = providerRequests;

  const rows = [
    { ...cold, upstream: coldUpstream },
    { ...warm, upstream: warmUpstream },
  ];

  console.log(`# news-api local benchmark\n`);
  console.log(`- Date: ${new Date().toISOString()}`);
  console.log(`- Commit: ${gitSha()}`);
  console.log(`- Node: ${process.version}`);
  console.log(`- Host: ${os.type()} ${os.release()} (${os.cpus()[0]?.model ?? "unknown CPU"})`);
  console.log(`- Fake provider delay: ${providerDelayMs}ms`);
  console.log(`- Rate limiting: disabled for benchmark\n`);
  console.log(
    "| Scenario | Requests | Concurrency | Upstream calls | Success | Failed | p50 ms | p95 ms | p99 ms | Throughput req/s |"
  );
  console.log(
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|"
  );
  for (const row of rows) {
    console.log(
      `| ${row.name} | ${row.requests} | ${row.concurrency} | ${row.upstream} | ${row.ok} | ${row.failed} | ${formatMs(row.p50)} | ${formatMs(row.p95)} | ${formatMs(row.p99)} | ${formatRate(row.throughput)} |`
    );
  }
} finally {
  await disconnectCacheStore();
  await close(apiServer);
  await close(fakeProvider);
}
