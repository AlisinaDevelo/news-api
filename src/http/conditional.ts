import { createHash } from "node:crypto";

type HeaderValue = string | string[] | undefined;

export function createWeakEntityTag(representation: unknown): string {
  const serialized = JSON.stringify(representation);
  const digest = createHash("sha256").update(serialized).digest("base64url");
  return `W/"sha256-${digest}"`;
}

function parseEntityTags(header: string): string[] {
  const tags: string[] = [];
  let index = 0;

  while (index < header.length) {
    while (index < header.length && (header[index] === "," || /\s/.test(header[index]))) {
      index += 1;
    }

    if (index >= header.length) {
      break;
    }

    if (header[index] === "*") {
      tags.push("*");
      index += 1;
      continue;
    }

    const start = index;
    if (header.startsWith("W/", index)) {
      index += 2;
    }

    if (header[index] !== '"') {
      while (index < header.length && header[index] !== ",") {
        index += 1;
      }
      continue;
    }

    index += 1;
    let closed = false;
    while (index < header.length) {
      if (header[index] === "\\") {
        index += 2;
        continue;
      }
      if (header[index] === '"') {
        index += 1;
        tags.push(header.slice(start, index));
        closed = true;
        break;
      }
      index += 1;
    }

    if (!closed) {
      break;
    }

    while (index < header.length && header[index] !== ",") {
      index += 1;
    }
  }

  return tags;
}

function withoutWeakPrefix(tag: string): string {
  return tag.startsWith("W/") ? tag.slice(2) : tag;
}

export function matchesIfNoneMatch(header: HeaderValue, currentTag: string): boolean {
  if (!header) {
    return false;
  }

  const value = Array.isArray(header) ? header.join(",") : header;
  return parseEntityTags(value).some(
    (candidate) => candidate === "*" || withoutWeakPrefix(candidate) === withoutWeakPrefix(currentTag)
  );
}
