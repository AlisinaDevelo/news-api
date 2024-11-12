import type { Article } from "../../src/types/article";

export const sampleArticles: Article[] = [
  {
    title: "Alpha headline",
    description: "d1",
    content: "c1",
    url: "https://example.com/a",
    image: null,
    publishedAt: "2024-01-01T00:00:00Z",
    source: { name: "BBC", url: "https://bbc.com" },
  },
  {
    title: "Beta headline",
    description: "d2",
    content: "c2",
    url: "https://example.com/b",
    image: null,
    publishedAt: "2024-01-02T00:00:00Z",
    source: { name: "CNN", url: "https://cnn.com" },
  },
];
