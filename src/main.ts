import * as fs from "node:fs";
import * as path from "node:path";
import * as core from "@actions/core";
import * as github from "@actions/github";
import { detectSpecPath, diffSpecs, type Finding } from "./rules";

const MARKER = "<!-- simple-swagger-check -->";
const NAME = "Simple Swagger Check";

function walk(root: string): string[] {
  const out: string[] = [];
  function rec(dir: string): void {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) rec(full);
      else out.push(path.relative(root, full));
    }
  }
  rec(root);
  return out;
}

function formatFindings(findings: Finding[]): string {
  if (!findings.length) {
    return [MARKER, `## ${NAME}`, "", "No OpenAPI/Swagger breaking path/method removals detected."].join("\n");
  }
  const rows = findings.map((f) => `| ${f.severity} | \`${f.ruleId}\` | ${f.file} | ${f.title} |`).join("\n");
  return [
    MARKER,
    `## ${NAME}`,
    "",
    `Found **${findings.length}** issue(s).`,
    "",
    "| Severity | Rule | Location | Detail |",
    "| --- | --- | --- | --- |",
    rows,
  ].join("\n");
}

async function upsertPrComment(token: string, body: string): Promise<void> {
  const { context } = github;
  if (context.eventName !== "pull_request" && context.eventName !== "pull_request_target") return;
  const issue_number = context.payload.pull_request?.number;
  if (!issue_number) return;
  const octokit = github.getOctokit(token);
  const { data: comments } = await octokit.rest.issues.listComments({ ...context.repo, issue_number });
  const existing = comments.find((c) => c.body?.includes(MARKER));
  if (existing) {
    await octokit.rest.issues.updateComment({ ...context.repo, comment_id: existing.id, body });
    return;
  }
  await octokit.rest.issues.createComment({ ...context.repo, issue_number, body });
}

async function fetchBaseFile(token: string, filePath: string): Promise<string | null> {
  const { context } = github;
  const base = context.payload.pull_request?.base?.sha;
  if (!base) return null;
  const octokit = github.getOctokit(token);
  try {
    const { data } = await octokit.rest.repos.getContent({
      ...context.repo,
      path: filePath,
      ref: base,
    });
    if (Array.isArray(data) || !("content" in data) || !data.content) return null;
    return Buffer.from(data.content, "base64").toString("utf8");
  } catch {
    return null;
  }
}

async function run(): Promise<void> {
  const token = core.getInput("github-token") || process.env.GITHUB_TOKEN || "";
  const failOn = (core.getInput("fail-on") || "none").toLowerCase();
  const forced = core.getInput("spec-path") || "";
  const files = walk(process.cwd());
  const specPath = forced || detectSpecPath(files);
  if (!specPath || !fs.existsSync(specPath)) {
    core.info("No OpenAPI/Swagger file found — skipping.");
    core.setOutput("finding-count", "0");
    return;
  }
  const headText = fs.readFileSync(specPath, "utf8");
  const baseText = token ? await fetchBaseFile(token, specPath) : null;
  let findings: Finding[] = [];
  if (!baseText) {
    core.info("Could not load base-branch spec (not a PR or file new) — nothing to diff.");
  } else {
    try {
      findings = diffSpecs(baseText, headText, specPath);
    } catch (e) {
      core.warning(`Spec parse failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const summary = formatFindings(findings);
  await core.summary.addRaw(summary, true).write();
  for (const f of findings) core.error(`${f.title} (${f.ruleId})`, { file: f.file });
  if (token) {
    try {
      await upsertPrComment(token, summary);
    } catch (e) {
      core.warning(`Could not post PR comment: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  core.setOutput("finding-count", String(findings.length));
  const shouldFail =
    failOn === "high"
      ? findings.some((f) => f.severity === "high")
      : failOn === "medium"
        ? findings.some((f) => f.severity === "high" || f.severity === "medium")
        : false;
  if (shouldFail) core.setFailed(`simple-swagger-check: ${findings.length} finding(s)`);
  else core.info(`Done. ${findings.length} finding(s) for ${specPath}.`);
}

run().catch((e) => core.setFailed(e instanceof Error ? e.message : String(e)));
