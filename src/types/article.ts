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
