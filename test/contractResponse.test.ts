import fs from "fs";
import path from "path";
import Ajv, { ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import request from "supertest";
import { parse } from "yaml";
import { describe, expect, it, vi } from "vitest";

const { mockGet } = vi.hoisted(() => ({
  mockGet: vi.fn(),
}));

vi.mock("axios", async (importOriginal) => {
  const actual = await importOriginal<typeof import("axios")>();
  return {
    ...actual,
    default: {
      ...actual.default,
      get: mockGet,
    },
  };
});

import app from "../src/app";
import { resetCacheStoreForTests } from "../src/cache/store";
import { sampleArticles } from "./fixtures/articles";

interface OpenApiDocument {
  paths: Record<
    string,
    {
      get?: {
        responses: Record<
          string,
          | {
              $ref: string;
            }
          | {
            content?: Record<string, { schema: Record<string, unknown> }>;
          }
        >;
      };
    }
  >;
  components: {
    schemas: Record<string, Record<string, unknown>>;
  } & Record<string, unknown>;
}

const openapi = parse(
  fs.readFileSync(path.resolve(process.cwd(), "docs", "openapi.yaml"), "utf8")
) as OpenApiDocument;

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
for (const [name, schema] of Object.entries(openapi.components.schemas)) {
  ajv.addSchema(schema, `#/components/schemas/${name}`);
}

function resolveComponentRef<T>(ref: string): T {
  const parts = ref.replace(/^#\//, "").split("/");
  let current: unknown = openapi;
  for (const part of parts) {
    if (current === null || typeof current !== "object" || !(part in current)) {
      throw new Error(`could not resolve OpenAPI ref ${ref}`);
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current as T;
}

function responseValidator(route: string, status: number): ValidateFunction {
  const response = openapi.paths[route]?.get?.responses[String(status)];
  const resolvedResponse =
    response && "$ref" in response
      ? resolveComponentRef<{ content?: Record<string, { schema: Record<string, unknown> }> }>(
          response.$ref
        )
      : response;
  const schema = resolvedResponse?.content?.["application/json"]?.schema;
  if (!schema) {
    throw new Error(`missing JSON response schema for GET ${route} ${status}`);
  }

  return ajv.compile(schema);
}

function expectValidResponse(validate: ValidateFunction, body: unknown): void {
  const valid = validate(body);
  expect(validate.errors ?? [], JSON.stringify(validate.errors, null, 2)).toEqual([]);
  expect(valid).toBe(true);
}

describe("OpenAPI response contract", () => {
  it("matches the documented v1 article search envelope", async () => {
    resetCacheStoreForTests();
    mockGet.mockReset();
    mockGet.mockResolvedValueOnce({ data: { articles: sampleArticles } });

    const res = await request(app).get("/api/v1/articles?query=contract&count=2");

    expect(res.status).toBe(200);
    expectValidResponse(responseValidator("/api/v1/articles", 200), res.body);
  });

  it("matches the documented v1 structured error envelope", async () => {
    resetCacheStoreForTests();
    mockGet.mockReset();

    const res = await request(app).get("/api/v1/articles");

    expect(res.status).toBe(400);
    expectValidResponse(responseValidator("/api/v1/articles", 400), res.body);
  });
});
