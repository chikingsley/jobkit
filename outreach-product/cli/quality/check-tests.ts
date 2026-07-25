import { readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { Glob } from "bun";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../..");
const MANIFEST_PATH = join(REPOSITORY_ROOT, "tests/manifest.jsonc");
const LINE_COMMENT_PATTERN = /^\s*\/\//u;
const CATEGORIES = new Set(["contract", "regression", "seam"]);

interface SuiteEntry {
  category: string;
  path: string;
  protects: string;
  stage: string;
}

function readManifest(): SuiteEntry[] {
  const source = readFileSync(MANIFEST_PATH, "utf8")
    .split("\n")
    .filter((line) => !LINE_COMMENT_PATTERN.test(line))
    .join("\n");
  return (JSON.parse(source) as { suites: SuiteEntry[] }).suites;
}

function testFiles(): string[] {
  const found: string[] = [];
  for (const pattern of ["**/*.test.ts", "**/*.test.tsx"]) {
    for (const match of new Glob(pattern).scanSync(
      join(REPOSITORY_ROOT, "tests")
    )) {
      found.push(
        relative(REPOSITORY_ROOT, join(REPOSITORY_ROOT, "tests", match))
      );
    }
  }
  return found;
}

const suites = readManifest();
const declared = new Map(suites.map((suite) => [suite.path, suite]));
const problems: string[] = [];

for (const file of testFiles()) {
  if (!declared.has(file)) {
    problems.push(
      `${file} has no entry in tests/manifest.jsonc. Declare what it protects, or move it to old/.`
    );
  }
}

for (const suite of suites) {
  try {
    statSync(join(REPOSITORY_ROOT, suite.path));
  } catch {
    problems.push(
      `tests/manifest.jsonc lists "${suite.path}" but that file does not exist.`
    );
  }
  if (!CATEGORIES.has(suite.category)) {
    problems.push(
      `"${suite.path}" has category "${suite.category}"; expected one of ${[...CATEGORIES].join(", ")}.`
    );
  }
  if (!(suite.stage && suite.protects && suite.protects.length > 20)) {
    problems.push(
      `"${suite.path}" needs a stage and a substantive "protects" description.`
    );
  }
}

if (problems.length > 0) {
  for (const problem of problems) {
    process.stderr.write(`${problem}\n`);
  }
  process.exit(1);
}

const byCategory = new Map<string, number>();
for (const suite of suites) {
  byCategory.set(suite.category, (byCategory.get(suite.category) ?? 0) + 1);
}
const summary = [...byCategory.entries()]
  .sort()
  .map(([category, count]) => `${count} ${category}`)
  .join(", ");
process.stdout.write(
  `All ${suites.length} test suites are declared and present (${summary}).\n`
);
