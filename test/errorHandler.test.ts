import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { HttpError } from "../src/errors/HttpError";
import { errorHandler } from "../src/middleware/errorHandler";

describe("error handler", () => {
  it("delegates errors after response headers are sent", () => {
    const error = new HttpError(502, "upstream failed", "upstream_error");
    const request = { path: "/api/v1/articles" } as Request;
    const response = {
      headersSent: true,
      json: vi.fn(),
      setHeader: vi.fn(),
      status: vi.fn(),
    } as unknown as Response;
    const next = vi.fn();

    errorHandler(error, request, response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith(error);
    expect(response.setHeader).not.toHaveBeenCalled();
    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).not.toHaveBeenCalled();
  });
});
