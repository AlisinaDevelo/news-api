import { describe, expect, it } from "vitest";
import { resolvePositiveIntegerEnv } from "../src/config/numbers";

describe("resolvePositiveIntegerEnv", () => {
  it("uses the fallback for missing, malformed, or non-positive values", () => {
    expect(resolvePositiveIntegerEnv(undefined, 15)).toBe(15);
    expect(resolvePositiveIntegerEnv("", 15)).toBe(15);
    expect(resolvePositiveIntegerEnv("nope", 15)).toBe(15);
    expect(resolvePositiveIntegerEnv("Infinity", 15)).toBe(15);
    expect(resolvePositiveIntegerEnv("0", 15)).toBe(15);
    expect(resolvePositiveIntegerEnv("-1", 15)).toBe(15);
  });

  it("rejects fractional and unsafe integers", () => {
    expect(resolvePositiveIntegerEnv("1.5", 15)).toBe(15);
    expect(resolvePositiveIntegerEnv("9007199254740992", 15)).toBe(15);
  });

  it("clamps values when a maximum is configured", () => {
    expect(resolvePositiveIntegerEnv("101", 15, 100)).toBe(100);
    expect(resolvePositiveIntegerEnv("25", 15, 100)).toBe(25);
  });
});
