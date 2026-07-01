import { Router } from "express";
import {
  getArticles,
  getArticlesBySource,
  getArticlesByTitle,
  getArticlesBySourceV1,
  getArticlesByTitleV1,
  searchArticlesV1,
} from "./controllers/newsController";
import { asyncHandler } from "./middleware/asyncHandler";

const router = Router();

router.get("/v1/articles", asyncHandler(searchArticlesV1));
router.get("/v1/articles/search", asyncHandler(searchArticlesV1));
router.get("/v1/articles/title/:title", asyncHandler(getArticlesByTitleV1));
router.get("/v1/sources/:source/articles", asyncHandler(getArticlesBySourceV1));

router.get("/articles", asyncHandler(getArticles));
router.get("/articles/title/:title", asyncHandler(getArticlesByTitle));
router.get("/articles/source", asyncHandler(getArticlesBySource));

export default router;
