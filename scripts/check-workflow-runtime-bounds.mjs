import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const repositoryRoot = process.cwd();
const workflowDirectory = path.join(repositoryRoot, ".github", "workflows");
const maximumTimeoutMinutes = 60;
const cancellableWorkflows = new Set([
  "ci.yml",
  "codeql.yml",
  "dependency-review.yml",
  "provenance.yml",
  "supply-chain.yml"
]);

const workflowFiles = fs
  .readdirSync(workflowDirectory)
  .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
  .sort();
const violations = [];
let jobCount = 0;

function hasWorkflowScopedGroup(concurrency) {
  if (concurrency === null || typeof concurrency !== "object") {
    return false;
  }

  const group = concurrency.group;
  return (
    typeof group === "string" &&
    group.includes("${{ github.workflow }}") &&
    group.includes("${{ github.ref }}")
  );
}

function hasCancellationPolicy(concurrency) {
  const cancelInProgress = concurrency?.["cancel-in-progress"];
  return (
    cancelInProgress === true ||
    (typeof cancelInProgress === "string" && cancelInProgress.trim().length > 0)
  );
}

for (const file of workflowFiles) {
  const relativeFile = path.join(".github", "workflows", file);
  const document = YAML.parse(fs.readFileSync(path.join(workflowDirectory, file), "utf8"));
  const jobs = document?.jobs;

  if (jobs === null || typeof jobs !== "object" || Array.isArray(jobs)) {
    violations.push(`${relativeFile}: jobs must be a mapping`);
    continue;
  }

  for (const [jobName, job] of Object.entries(jobs)) {
    jobCount += 1;
    const timeout = job?.["timeout-minutes"];
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > maximumTimeoutMinutes) {
      violations.push(
        `${relativeFile}: jobs.${jobName}.timeout-minutes must be an integer from 1 to ${maximumTimeoutMinutes}`
      );
    }
  }

  if (cancellableWorkflows.has(file)) {
    if (!hasWorkflowScopedGroup(document.concurrency)) {
      violations.push(`${relativeFile}: concurrency.group must include github.workflow and github.ref`);
    }
    if (!hasCancellationPolicy(document.concurrency)) {
      violations.push(`${relativeFile}: concurrency.cancel-in-progress must be configured`);
    }
  }

  if (file === "codeql.yml") {
    const cancelInProgress = document.concurrency?.["cancel-in-progress"];
    if (
      typeof cancelInProgress !== "string" ||
      !cancelInProgress.includes("github.event_name") ||
      !cancelInProgress.includes("schedule")
    ) {
      violations.push(
        `${relativeFile}: scheduled CodeQL runs must use conditional cancel-in-progress`
      );
    }
  }

  if (file === "release.yml" && document.concurrency !== undefined) {
    violations.push(`${relativeFile}: release workflow must not define a cancellation group`);
  }
}

if (violations.length > 0) {
  console.error(
    `Workflow jobs must define bounded timeouts and replaceable workflows must define scoped cancellation (checked ${workflowFiles.length} files, ${jobCount} jobs):`
  );
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Checked ${workflowFiles.length} workflows and ${jobCount} jobs; timeouts and concurrency policies are valid.`
  );
}
