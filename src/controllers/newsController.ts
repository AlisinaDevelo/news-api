import { Request, Response } from "express";
import {
  fetchArticles,
  fetchArticlesBySource,
  fetchArticlesByTitle,
  searchArticles,
} from "../services/newsService";
import {
  parseArticleCount,
  parseArticlePage,
  parseArticleSearchFilters,
  requireQueryString,
} from "../utils/validation";
import { HttpError } from "../errors/HttpError";
import { sendEnvelope } from "../http/responses";
import { createRequestAbortSignal } from "../runtime/requestCancellation";

export const getArticles = async (req: Request, res: Response): Promise<void> => {
  const q = requireQueryString(req.query.query, "query");
  const count = parseArticleCount(req.query.count);
  const page = parseArticlePage(req.query.page);
  const filters = parseArticleSearchFilters(req.query);
  const signal = createRequestAbortSignal(res);
  const articles = await fetchArticles({ query: q, count, page, ...filters }, signal);
  res.json(articles);
};

export const searchArticlesV1 = async (req: Request, res: Response): Promise<void> => {
  const query = requireQueryString(req.query.query, "query");
  const count = parseArticleCount(req.query.count);
  const page = parseArticlePage(req.query.page);
  const filters = parseArticleSearchFilters(req.query);
  const signal = createRequestAbortSignal(res);
  const result = await searchArticles({ query, count, page, ...filters }, signal);

  sendEnvelope(req, res, result.articles, {
    query,
    count,
    page,
    filters,
    cache: result.cache,
  });
};

export const getArticlesByTitle = async (req: Request, res: Response): Promise<void> => {
  const title = requireQueryString(req.params.title, "title");
  const signal = createRequestAbortSignal(res);
  const article = await fetchArticlesByTitle(title, signal);
  if (article) {
    res.json(article);
  } else {
    res.status(404).json({ error: "Article not found" });
  }
};

export const getArticlesByTitleV1 = async (req: Request, res: Response): Promise<void> => {
  const title = requireQueryString(req.params.title, "title");
  const signal = createRequestAbortSignal(res);
  const article = await fetchArticlesByTitle(title, signal);
  if (!article) {
    throw new HttpError(404, "Article not found", "article_not_found");
  }
  sendEnvelope(req, res, article, { title });
};

export const getArticlesBySource = async (req: Request, res: Response): Promise<void> => {
  const source = requireQueryString(req.query.source, "source");
  const count = parseArticleCount(req.query.count);
  const page = parseArticlePage(req.query.page);
  const filters = parseArticleSearchFilters(req.query);
  const signal = createRequestAbortSignal(res);
  const articles = await fetchArticlesBySource(source, count, filters, page, signal);
  res.json(articles);
};

export const getArticlesBySourceV1 = async (req: Request, res: Response): Promise<void> => {
  const source = requireQueryString(req.params.source, "source");
  const count = parseArticleCount(req.query.count);
  const page = parseArticlePage(req.query.page);
  const filters = parseArticleSearchFilters(req.query);
  const signal = createRequestAbortSignal(res);
  const articles = await fetchArticlesBySource(source, count, filters, page, signal);

  sendEnvelope(req, res, articles, {
    source,
    count,
    page,
    filters,
  });
};
