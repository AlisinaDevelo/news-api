import { describe, expect, it } from "vitest";
import {
  DEFAULT_SERVER_MAX_JSON_BODY_BYTES,
  MAX_SERVER_MAX_JSON_BODY_BYTES,
  resolveServerMaxJsonBodyBytes,
} from "../src/config/httpBody";
import { getBodyParserErrorContract } from "../src/http/bodyParser";

describe("HTTP JSON body configuration", () => {
  it("uses a conservative default and clamps the operator override", () => {
    expect(resolveServerMaxJsonBodyBytes(undefined)).toBe(DEFAULT_SERVER_MAX_JSON_BODY_BYTES);
    expect(resolveServerMaxJsonBodyBytes("nope")).toBe(DEFAULT_SERVER_MAX_JSON_BODY_BYTES);
    expect(resolveServerMaxJsonBodyBytes("0")).toBe(DEFAULT_SERVER_MAX_JSON_BODY_BYTES);
    expect(resolveServerMaxJsonBodyBytes("1.5")).toBe(DEFAULT_SERVER_MAX_JSON_BODY_BYTES);
    expect(resolveServerMaxJsonBodyBytes("900000")).toBe(MAX_SERVER_MAX_JSON_BODY_BYTES);
    expect(resolveServerMaxJsonBodyBytes("16384")).toBe(16384);
  });

  it("maps typed parser failures to fixed client-safe contracts", () => {
    const oversized = Object.assign(new Error("raw body should not escape"), {
      type: "entity.too.large",
      body: "secret request content",
    });
    expect(getBodyParserErrorContract(oversized)).toEqual({
      type: "entity.too.large",
      statusCode: 413,
      code: "request_body_too_large",
      message: "Request body too large",
    });

    const malformed = Object.assign(new Error("Unexpected token secret"), {
      type: "entity.parse.failed",
      body: "secret request content",
    });
    expect(getBodyParserErrorContract(malformed)).toEqual({
      type: "entity.parse.failed",
      statusCode: 400,
      code: "invalid_json_body",
      message: "Invalid JSON request body",
    });

    expect(getBodyParserErrorContract(new Error("unrelated failure"))).toBeUndefined();
  });
});
