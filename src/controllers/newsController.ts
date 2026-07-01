import { Request, Response } from "express";
import {
  fetchArticles,
  fetchArticlesBySource,
  fetchArticlesByTitle,
  searchArticles,
} from "../services/newsService";
import {
  parseArticleCount,
  parseArticleSearchFilters,
  requireQueryString,
} from "../utils/validation";
import { HttpError } from "../errors/HttpError";
import { sendEnvelope } from "../http/responses";

export const getArticles = async (req: Request, res: Response): Promise<void> => {
  const q = requireQueryString(req.query.query, "query");
  const count = parseArticleCount(req.query.count);
  const filters = parseArticleSearchFilters(req.query);
  const articles = await fetchArticles({ query: q, count, ...filters });
  res.json(articles);
};

export const searchArticlesV1 = async (req: Request, res: Response): Promise<void> => {
  const query = requireQueryString(req.query.query, "query");
  const count = parseArticleCount(req.query.count);
  const filters = parseArticleSearchFilters(req.query);
  const result = await searchArticles({ query, count, ...filters });

  sendEnvelope(req, res, result.articles, {
    query,
    count,
    filters,
    cache: result.cache,
  });
};

export const getArticlesByTitle = async (req: Request, res: Response): Promise<void> => {
  const title = decodeURIComponent(req.params.title);
  const article = await fetchArticlesByTitle(title);
  if (article) {
    res.json(article);
  } else {
    res.status(404).json({ error: "Article not found" });
  }
};

export const getArticlesByTitleV1 = async (req: Request, res: Response): Promise<void> => {
  const title = decodeURIComponent(req.params.title);
  const article = await fetchArticlesByTitle(title);
  if (!article) {
    throw new HttpError(404, "Article not found", "article_not_found");
  }
  sendEnvelope(req, res, article, { title });
};

export const getArticlesBySource = async (req: Request, res: Response): Promise<void> => {
  const source = requireQueryString(req.query.source, "source");
  const count = parseArticleCount(req.query.count);
  const filters = parseArticleSearchFilters(req.query);
  const articles = await fetchArticlesBySource(source, count, filters);
  res.json(articles);
};

export const getArticlesBySourceV1 = async (req: Request, res: Response): Promise<void> => {
  const source = requireQueryString(req.params.source, "source");
  const count = parseArticleCount(req.query.count);
  const filters = parseArticleSearchFilters(req.query);
  const articles = await fetchArticlesBySource(source, count, filters);

  sendEnvelope(req, res, articles, {
    source,
    count,
    filters,
  });
};
