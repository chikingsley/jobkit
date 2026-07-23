import { resolve } from "node:path";
import { file, Glob } from "bun";

const MAX_LINES = 500;
const projectRoot = resolve(import.meta.dir, "../..");
const generatedFiles = new Set([
  "src/routeTree.gen.ts",
  "worker-configuration.d.ts",
]);
const excludedDirectories = new Set([
  ".git",
  ".opencode",
  ".wrangler",
  "coverage",
  "dist",
  "node_modules",
]);

function physicalLineCount(source: string) {
  const newlineCount = source.match(/\n/gu)?.length ?? 0;
  return newlineCount + (source.endsWith("\n") ? 0 : 1);
}

function isExcluded(path: string) {
  return path.split("/").some((segment) => excludedDirectories.has(segment));
}

const violations: { lines: number; path: string }[] = [];
const sourceFiles = new Glob("**/*.{ts,tsx}");

for await (const path of sourceFiles.scan({
  cwd: projectRoot,
  onlyFiles: true,
})) {
  if (generatedFiles.has(path) || isExcluded(path)) {
    continue;
  }
  const lines = physicalLineCount(
    await file(resolve(projectRoot, path)).text()
  );
  if (lines > MAX_LINES) {
    violations.push({ lines, path });
  }
}

if (violations.length > 0) {
  violations.sort((left, right) => right.lines - left.lines);
  console.error(`Files exceed the ${MAX_LINES}-line limit:`);
  for (const violation of violations) {
    console.error(`${violation.lines}\t${violation.path}`);
  }
  process.exitCode = 1;
} else {
  console.log(`All TypeScript files stay within ${MAX_LINES} physical lines.`);
}
