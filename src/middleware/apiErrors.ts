import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../errors/HttpError";

export function apiNotFound(_req: Request, _res: Response, next: NextFunction): void {
  next(new HttpError(404, "API route not found", "route_not_found"));
}
