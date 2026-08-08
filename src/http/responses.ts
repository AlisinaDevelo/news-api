import type { Request, Response } from "express";
import { createWeakEntityTag, matchesIfNoneMatch } from "./conditional";
import { normalizeRequestId } from "./requestId";

type RequestWithId = Request & { id?: unknown };

const V1_CACHE_CONTROL = "private, no-cache";

export function requestId(req: Request): string {
  const id = (req as RequestWithId).id;
  return normalizeRequestId(id) ?? normalizeRequestId(req.headers["x-request-id"]) ?? "unknown";
}

export function sendEnvelope<TData, TMeta extends Record<string, unknown>>(
  req: Request,
  res: Response,
  data: TData,
  meta: TMeta
): void {
  res.setHeader("X-API-Version", "v1");
  res.setHeader("Cache-Control", V1_CACHE_CONTROL);
  if (typeof meta.cache === "string" && meta.cache.trim()) {
    res.setHeader("X-Cache-Status", meta.cache);
  }
  const envelopeMeta = {
    ...meta,
    requestId: requestId(req),
  };
  const body = {
    data,
    meta: envelopeMeta,
  };
  const validatorMeta = Object.fromEntries(
    Object.entries(envelopeMeta).filter(([key]) => key !== "cache" && key !== "requestId")
  );
  const entityTag = createWeakEntityTag({ data, meta: validatorMeta });
  res.setHeader("ETag", entityTag);

  if (matchesIfNoneMatch(req.headers["if-none-match"], entityTag)) {
    res.status(304).end();
    return;
  }

  res.type("json").send(JSON.stringify(body));
}
