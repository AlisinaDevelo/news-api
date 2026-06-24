import http from "node:http";

const port = Number(process.env.PORT ?? 4010);
const delayMs = Number(process.env.FAKE_GNEWS_DELAY_MS ?? 0);

function articleFor(query, index) {
  return {
    title: `${query} headline ${index + 1}`,
    description: `Synthetic article ${index + 1} for ${query}`,
    content: `Synthetic content for ${query}`,
    url: `https://example.test/news/${encodeURIComponent(query)}/${index + 1}`,
    image: null,
    publishedAt: "2026-01-01T00:00:00.000Z",
    source: {
      name: "CI News",
      url: "https://example.test",
    },
  };
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");

  if (url.pathname === "/health") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (url.pathname !== "/search") {
    sendJson(res, 404, { error: "not found" });
    return;
  }

  const query = url.searchParams.get("q") ?? "news";
  const count = Math.max(1, Math.min(Number(url.searchParams.get("max") ?? 3), 100));
  const articles = Array.from({ length: count }, (_, index) => articleFor(query, index));

  setTimeout(() => sendJson(res, 200, { articles }), delayMs);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`fake GNews provider listening on ${port}`);
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
