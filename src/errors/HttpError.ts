export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly retryAfter: string | undefined;

  constructor(statusCode: number, message: string, code = "http_error", retryAfter?: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}
