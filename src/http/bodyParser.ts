export interface BodyParserErrorContract {
  type: string;
  statusCode: number;
  code: string;
  message: string;
}

const BODY_PARSER_ERROR_CONTRACTS: Readonly<Record<string, BodyParserErrorContract>> = {
  "entity.too.large": {
    type: "entity.too.large",
    statusCode: 413,
    code: "request_body_too_large",
    message: "Request body too large",
  },
  "entity.parse.failed": {
    type: "entity.parse.failed",
    statusCode: 400,
    code: "invalid_json_body",
    message: "Invalid JSON request body",
  },
  "request.aborted": {
    type: "request.aborted",
    statusCode: 400,
    code: "request_body_aborted",
    message: "Request body was aborted",
  },
  "request.size.invalid": {
    type: "request.size.invalid",
    statusCode: 400,
    code: "invalid_request_size",
    message: "Invalid request body size",
  },
  "encoding.unsupported": {
    type: "encoding.unsupported",
    statusCode: 415,
    code: "unsupported_content_encoding",
    message: "Unsupported request content encoding",
  },
  "charset.unsupported": {
    type: "charset.unsupported",
    statusCode: 415,
    code: "unsupported_charset",
    message: "Unsupported request charset",
  },
  "entity.verify.failed": {
    type: "entity.verify.failed",
    statusCode: 403,
    code: "request_body_rejected",
    message: "Request body rejected",
  },
  "parameters.too.many": {
    type: "parameters.too.many",
    statusCode: 413,
    code: "too_many_parameters",
    message: "Too many request parameters",
  },
};

interface TypedBodyParserError extends Error {
  type?: unknown;
}

export function getBodyParserErrorContract(
  err: unknown
): BodyParserErrorContract | undefined {
  if (!(err instanceof Error)) {
    return undefined;
  }
  const type = (err as TypedBodyParserError).type;
  return typeof type === "string" ? BODY_PARSER_ERROR_CONTRACTS[type] : undefined;
}
