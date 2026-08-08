import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const workflowDirectory = path.resolve(process.cwd(), ".github", "workflows");
const fullShaReference = /^[^@\s]+@[0-9a-f]{40}$/;
const workflowFiles = fs
  .readdirSync(workflowDirectory)
  .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
  .sort();
const violations = [];
let actionCount = 0;

function inspect(value, file) {
  if (Array.isArray(value)) {
    for (const item of value) {
      inspect(item, file);
    }
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === "uses" && typeof child === "string" && !child.startsWith("./")) {
      actionCount += 1;
      if (!fullShaReference.test(child)) {
        violations.push(`${file}: ${child}`);
      }
    }
    inspect(child, file);
  }
}

for (const file of workflowFiles) {
  const relativeFile = path.join(".github", "workflows", file);
  const document = YAML.parse(fs.readFileSync(path.join(workflowDirectory, file), "utf8"));
  inspect(document, relativeFile);
}

if (violations.length > 0) {
  console.error("Workflow actions must use full 40-character commit SHAs:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Checked ${actionCount} workflow action references; all use full commit SHAs.`);
}
