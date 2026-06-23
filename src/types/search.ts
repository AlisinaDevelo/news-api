export type ArticleSortBy = "publishedAt" | "relevance";

export interface ArticleSearchFilters {
  lang?: string;
  country?: string;
  from?: string;
  to?: string;
  sortBy?: ArticleSortBy;
}

export interface ArticleSearchOptions extends ArticleSearchFilters {
  query: string;
  count: number;
}
