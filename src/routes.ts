import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import {
  getArticles,
  getArticlesBySource,
  getArticlesByTitle,
  getArticlesBySourceV1,
  getArticlesByTitleV1,
  searchArticlesV1,
} from "./controllers/newsController";
import { HttpError } from "./errors/HttpError";
import { asyncHandler } from "./middleware/asyncHandler";

const router = Router();
const READ_ONLY_ALLOW = "GET, HEAD, OPTIONS";

function methodNotAllowed(req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Allow", READ_ONLY_ALLOW);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next(new HttpError(405, "Method not allowed", "method_not_allowed"));
}

function readOnlyRoute(path: string, handler: RequestHandler): void {
  router.get(path, handler);
  router.all(path, methodNotAllowed);
}

readOnlyRoute("/v1/articles", asyncHandler(searchArticlesV1));
readOnlyRoute("/v1/articles/search", asyncHandler(searchArticlesV1));
readOnlyRoute("/v1/articles/title/:title", asyncHandler(getArticlesByTitleV1));
readOnlyRoute("/v1/sources/:source/articles", asyncHandler(getArticlesBySourceV1));

readOnlyRoute("/articles", asyncHandler(getArticles));
readOnlyRoute("/articles/title/:title", asyncHandler(getArticlesByTitle));
readOnlyRoute("/articles/source", asyncHandler(getArticlesBySource));

export default router;
