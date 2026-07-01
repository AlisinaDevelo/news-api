import type { Request, Response } from "express";

type RequestWithId = Request & { id?: unknown };

export function requestId(req: Request): string {
  const id = (req as RequestWithId).id;
  if (typeof id === "string" && id.trim()) {
    return id;
  }
  const header = req.headers["x-request-id"];
  if (typeof header === "string" && header.trim()) {
    return header;
  }
  return "unknown";
}

export function sendEnvelope<TData, TMeta extends Record<string, unknown>>(
  req: Request,
  res: Response,
  data: TData,
  meta: TMeta
): void {
  res.json({
    data,
    meta: {
      ...meta,
      requestId: requestId(req),
    },
  });
}
