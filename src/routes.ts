import { Router } from "express";
import {
  getArticles,
  getArticlesBySource,
  getArticlesByTitle,
} from "./controllers/newsController";
import { asyncHandler } from "./middleware/asyncHandler";

const router = Router();

router.get("/articles", asyncHandler(getArticles));
router.get("/articles/title/:title", asyncHandler(getArticlesByTitle));
router.get("/articles/source", asyncHandler(getArticlesBySource));

export default router;
