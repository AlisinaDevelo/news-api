import { Request, Response } from "express";
import {
  fetchArticles,
  fetchArticlesBySource,
  fetchArticlesByTitle,
} from "../services/newsService";
import { parseArticleCount, requireQueryString } from "../utils/validation";

export const getArticles = async (req: Request, res: Response): Promise<void> => {
  const q = requireQueryString(req.query.query, "query");
  const count = parseArticleCount(req.query.count);
  const articles = await fetchArticles(q, count);
  res.json(articles);
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

export const getArticlesBySource = async (req: Request, res: Response): Promise<void> => {
  const source = requireQueryString(req.query.source, "source");
  const count = parseArticleCount(req.query.count);
  const articles = await fetchArticlesBySource(source, count);
  res.json(articles);
};
