import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import axios from "axios";
import app from "../src/app";
import { sampleArticles } from "./fixtures/articles";

vi.mock("axios", () => ({
  default: { get: vi.fn() },
}));

const mockedGet = vi.mocked(axios.get);

describe("app", () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  it("GET /health returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok" });
    expect(typeof res.body.uptime).toBe("number");
  });

  it("GET / returns service metadata", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "news-api" });
  });

  it("GET /api/articles without query returns 400", async () => {
    const res = await request(app).get("/api/articles");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it("GET /api/articles with invalid count returns 400", async () => {
    const res = await request(app).get("/api/articles?query=tech&count=abc");
    expect(res.status).toBe(400);
  });

  it("GET /api/articles proxies gnews and returns articles", async () => {
    mockedGet.mockResolvedValueOnce({ data: { articles: sampleArticles } });
    const res = await request(app).get("/api/articles?query=tech&count=2");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(sampleArticles);
    expect(mockedGet).toHaveBeenCalledWith(
      "https://gnews.io/api/v4/search",
      expect.objectContaining({
        params: expect.objectContaining({ q: "tech", max: 2 }),
      })
    );
  });

  it("reuses cache for identical search params", async () => {
    mockedGet.mockResolvedValue({ data: { articles: sampleArticles } });
    const q = `cached-${Math.random().toString(36).slice(2)}`;
    await request(app).get(`/api/articles?query=${encodeURIComponent(q)}&count=2`);
    await request(app).get(`/api/articles?query=${encodeURIComponent(q)}&count=2`);
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it("GET /api/articles/title returns article when matched", async () => {
    mockedGet.mockResolvedValueOnce({ data: { articles: sampleArticles } });
    const title = encodeURIComponent("Alpha headline");
    const res = await request(app).get(`/api/articles/title/${title}`);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Alpha headline");
  });

  it("GET /api/articles/title returns 404 when missing", async () => {
    mockedGet.mockResolvedValueOnce({ data: { articles: sampleArticles } });
    const title = encodeURIComponent("Missing");
    const res = await request(app).get(`/api/articles/title/${title}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Article not found");
  });

  it("GET /api/articles/source requires source param", async () => {
    const res = await request(app).get("/api/articles/source");
    expect(res.status).toBe(400);
  });

  it("GET /api/articles/source filters by source name", async () => {
    mockedGet.mockResolvedValueOnce({ data: { articles: sampleArticles } });
    const res = await request(app).get("/api/articles/source?source=BBC&count=10");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].source.name).toBe("BBC");
  });

  it("returns 500 when upstream request fails", async () => {
    mockedGet.mockRejectedValueOnce(new Error("network"));
    const res = await request(app).get("/api/articles?query=fail&count=1");
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Internal server error");
  });
});
