export interface ArticleSource {
  name: string;
  url: string;
}

export interface Article {
  title: string;
  description: string | null;
  content: string | null;
  url: string;
  image: string | null;
  publishedAt: string;
  source: ArticleSource;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function isArticle(value: unknown): value is Article {
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

export function isArticleSource(value: unknown): value is ArticleSource {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.url === "string"
  );
}

export function isArticleList(value: unknown): value is Article[] {
  return Array.isArray(value) && value.every(isArticle);
}
