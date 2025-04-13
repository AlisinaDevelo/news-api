import type { Request, Response, NextFunction } from "express";
import { httpRequestsTotal } from "../metrics/register";

export function metricsRequestObserver(req: Request, res: Response, next: NextFunction): void {
  res.on("finish", () => {
    httpRequestsTotal.inc({
      method: req.method,
      status_code: String(res.statusCode),
    });
  });
  next();
}
