import { describe, expect, it } from "vitest";
import { createWeakEntityTag, matchesIfNoneMatch } from "../src/http/conditional";

describe("conditional response validators", () => {
  it("creates a stable weak SHA-256 entity tag", () => {
    const first = createWeakEntityTag({ data: [{ title: "Alpha" }] });
    const second = createWeakEntityTag({ data: [{ title: "Alpha" }] });

    expect(first).toMatch(/^W\/"sha256-[A-Za-z0-9_-]+"$/);
    expect(second).toBe(first);
    expect(createWeakEntityTag({ data: [{ title: "Beta" }] })).not.toBe(first);
  });

  it.each([
    ['W/"abc"', true],
    ['"other", W/"abc"', true],
    ["*", true],
    ['"contains,comma"', false],
    ['"other"', false],
  ])("matches If-None-Match %s as %s", (header, expected) => {
    expect(matchesIfNoneMatch(header, '"abc"')).toBe(expected);
  });

  it("supports opaque tags containing commas", () => {
    expect(matchesIfNoneMatch('"contains,comma", "other"', 'W/"contains,comma"')).toBe(true);
  });

  it("supports repeated header values", () => {
    expect(matchesIfNoneMatch(['"other"', 'W/"abc"'], 'W/"abc"')).toBe(true);
  });
});
