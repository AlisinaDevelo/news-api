import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const repositoryRoot = process.cwd();
const composeFiles = ["docker-compose.yml", "docker-compose.ci.yml"];
const digestPattern = /^[^@\s]+@sha256:[0-9a-f]{64}$/;

function hasTag(reference) {
  const imageName = reference.slice(0, reference.indexOf("@"));
  return imageName.slice(imageName.lastIndexOf("/") + 1).includes(":");
}

function isPinned(reference) {
  return digestPattern.test(reference) && hasTag(reference);
}

function inspectCompose(value, file, location, violations, references) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      inspectCompose(item, file, `${location}[${index}]`, violations, references);
    });
    return;
  }

  if (value === null || typeof value !== "object") {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const childLocation = location ? `${location}.${key}` : key;
    if (key === "image") {
      references.push(`${file}:${childLocation}`);
      if (typeof child !== "string" || !isPinned(child)) {
        violations.push(`${file}:${childLocation}: ${String(child)}`);
      }
      continue;
    }
    inspectCompose(child, file, childLocation, violations, references);
  }
}

function inspectDockerfile(file, violations, references) {
  const lines = fs.readFileSync(path.join(repositoryRoot, file), "utf8").split(/\r?\n/);
  const stageNames = new Set();

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const tokens = trimmed.split(/\s+/);
    if (tokens[0].toUpperCase() !== "FROM") {
      return;
    }

    let imageIndex = 1;
    while (tokens[imageIndex]?.startsWith("--")) {
      imageIndex += 1;
    }
    const reference = tokens[imageIndex];
    const asIndex = tokens.findIndex((token, tokenIndex) =>
      tokenIndex > imageIndex && token.toUpperCase() === "AS"
    );
    const stageName = asIndex >= 0 ? tokens[asIndex + 1] : null;

    if (reference && reference !== "scratch" && !stageNames.has(reference)) {
      references.push(`${file}:${index + 1}`);
      if (!isPinned(reference)) {
        violations.push(`${file}:${index + 1}: ${reference}`);
      }
    }

    if (stageName) {
      stageNames.add(stageName);
    }
  });
}

const violations = [];
const references = [];
inspectDockerfile("Dockerfile", violations, references);

for (const file of composeFiles) {
  const document = YAML.parse(fs.readFileSync(path.join(repositoryRoot, file), "utf8"));
  inspectCompose(document, file, "", violations, references);
}

if (violations.length > 0) {
  console.error("Container images must retain a tag and use a full 64-character sha256 digest:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Checked ${references.length} external container image references; all use tag-plus-digest references.`);
}
