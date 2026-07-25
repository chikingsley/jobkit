// Fails when the repository and modules.jsonc disagree: a directory with no
// manifest entry, or an entry naming a path that no longer exists. Without this
// the manifest silently becomes fiction.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../..");
const MANIFEST_PATH = join(REPOSITORY_ROOT, "modules.jsonc");
const LINE_COMMENT_PATTERN = /^\s*\/\//u;

// Generated, vendored, or tool-owned directories are not modules.
const UNTRACKED_DIRECTORIES = new Set([
  ".claude",
  ".git",
  ".jobkit",
  ".opencode",
  ".secrets",
  ".tanstack",
  ".wrangler",
  "dist",
  "node_modules",
  "test-results",
]);

interface ModuleEntry {
  name: string;
  path: string;
  stage: string;
  status: string;
}

function readManifest(): ModuleEntry[] {
  const source = readFileSync(MANIFEST_PATH, "utf8")
    .split("\n")
    .filter((line) => !LINE_COMMENT_PATTERN.test(line))
    .join("\n");
  const parsed = JSON.parse(source) as { modules: ModuleEntry[] };
  return parsed.modules;
}

function repositoryDirectories(): string[] {
  return readdirSync(REPOSITORY_ROOT)
    .filter((entry) => !UNTRACKED_DIRECTORIES.has(entry))
    .filter((entry) => statSync(join(REPOSITORY_ROOT, entry)).isDirectory());
}

// Pipeline stages are the modules that matter most, so they are declared
// individually rather than being covered by a single src/ entry.
function pipelineStages(): string[] {
  const pipelineRoot = join(REPOSITORY_ROOT, "src/pipeline");
  try {
    return readdirSync(pipelineRoot)
      .filter((entry) => statSync(join(pipelineRoot, entry)).isDirectory())
      .map((entry) => `src/pipeline/${entry}`);
  } catch {
    return [];
  }
}

const modules = readManifest();
const declared = new Set(modules.map((module) => module.path));
const problems: string[] = [];

for (const directory of repositoryDirectories()) {
  if (!declared.has(directory)) {
    problems.push(
      `${directory}/ has no entry in modules.jsonc. Add one describing what it owns, or move it to old/.`
    );
  }
}

for (const stage of pipelineStages()) {
  if (!declared.has(stage)) {
    problems.push(
      `${stage}/ has no entry in modules.jsonc. Every pipeline stage is declared individually.`
    );
  }
}

for (const module of modules) {
  try {
    statSync(join(REPOSITORY_ROOT, module.path));
  } catch {
    problems.push(
      `modules.jsonc lists "${module.path}" but that path does not exist.`
    );
  }
  if (!(module.name && module.stage && module.status)) {
    problems.push(
      `modules.jsonc entry "${module.path}" is missing name, stage, or status.`
    );
  }
}

if (problems.length > 0) {
  for (const problem of problems) {
    process.stderr.write(`${problem}\n`);
  }
  process.exit(1);
}

process.stdout.write(
  `All ${modules.length} modules are declared and present.\n`
);
