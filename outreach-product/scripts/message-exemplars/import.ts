// Import outcome-labeled outreach exemplars from the recovered sent-mail
// corpus (job-search/job-data/outreach-sent/corpus.md) into message_exemplars.
//
// Usage: bun scripts/message-exemplars/import.ts [--remote]
//
// Idempotent: rows use deterministic ids and are fully replaced per run.

import { spawnSync } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: { remote: { default: false, type: "boolean" } },
});

const CORPUS_PATH = resolve(
  import.meta.dir,
  "../../../job-search/job-data/outreach-sent/corpus.md"
);

const OUTCOME_GRADES: Record<string, number> = {
  interview: 2,
  none: 0,
  offer: 3,
  rejected: 0,
  reply: 1,
};
const EXAMPLE_SUBJECT_LINE_PATTERN = /^Subject e\.g\.:\s*(.+)$/mu;
const EXAMPLE_SUBJECT_PREFIX_PATTERN = /^Subject e\.g\.:.*\n+/u;

interface Exemplar {
  body: string;
  country: string;
  id: string;
  outcome: string;
  outcomeGrade: number;
  sentAt: string;
  subject: string;
  templateVariant: string;
}

interface LogEntry {
  country: string;
  date: string;
  outcome: string;
  replied: boolean;
  subject: string;
  template: string;
}

function gradeOf(outcome: string, replied: boolean): number {
  const grade = OUTCOME_GRADES[outcome.toLowerCase()];
  if (grade !== undefined && grade > 0) {
    return grade;
  }
  return replied ? 1 : 0;
}

const corpus = readFileSync(CORPUS_PATH, "utf8");
const lines = corpus.split("\n");

// Pass 1: template variant bodies ("### Variant A — ..." followed by a fence).
const variantBodies = new Map<string, { body: string; subject: string }>();
// Pass 2: chronological log entries ("### 2019-06-19 · to x (Country)").
const entries: LogEntry[] = [];

const variantHeader = /^### Variant ([A-Z]) —/u;
const logHeader = /^### (\d{4}-\d{2}-\d{2}) · to \S+ \(([^)]*)\)/u;

for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i] ?? "";
  const variantMatch = variantHeader.exec(line);
  if (variantMatch?.[1]) {
    const fence = collectFence(i);
    if (fence) {
      variantBodies.set(variantMatch[1], fence);
    }
    continue;
  }
  const logMatch = logHeader.exec(line);
  if (logMatch?.[1]) {
    const meta = `${lines[i + 1] ?? ""}\n${lines[i + 2] ?? ""}`;
    entries.push({
      country: logMatch[2] ?? "",
      date: logMatch[1],
      outcome: /\*\*Outcome:\*\*\s*([A-Za-z]+)/u.exec(meta)?.[1] ?? "none",
      replied: /\*\*Replied:\*\*\s*yes/u.test(meta),
      subject: /\*\*Subject:\*\*\s*(.+?)\s*$/mu.exec(meta)?.[1] ?? "",
      template: /\*\*Template:\*\*\s*([A-Z])/u.exec(meta)?.[1] ?? "",
    });
  }
}

function collectFence(
  startLine: number
): { body: string; subject: string } | null {
  for (let i = startLine; i < Math.min(startLine + 12, lines.length); i += 1) {
    if (lines[i]?.startsWith("```")) {
      const bodyLines: string[] = [];
      for (let j = i + 1; j < lines.length; j += 1) {
        const bodyLine = lines[j] ?? "";
        if (bodyLine.startsWith("```")) {
          const text = bodyLines.join("\n").trim();
          const subject =
            EXAMPLE_SUBJECT_LINE_PATTERN.exec(text)?.[1]?.trim() ?? "";
          const body = text.replace(EXAMPLE_SUBJECT_PREFIX_PATTERN, "").trim();
          return body ? { body, subject } : null;
        }
        bodyLines.push(bodyLine);
      }
      return null;
    }
  }
  return null;
}

// One exemplar per template variant, graded by the best outcome any of its
// sends achieved, dated/located by that best thread.
const exemplars: Exemplar[] = [];
for (const [variant, fence] of variantBodies) {
  const variantEntries = entries.filter((entry) => entry.template === variant);
  const [best] = [...variantEntries].sort(
    (a, b) => gradeOf(b.outcome, b.replied) - gradeOf(a.outcome, a.replied)
  );
  exemplars.push({
    body: fence.body,
    country: best?.country ?? "",
    id: `corpus:variant-${variant.toLowerCase()}`,
    outcome: (best?.outcome ?? "none").toLowerCase(),
    outcomeGrade: best ? gradeOf(best.outcome, best.replied) : 0,
    sentAt: best?.date ?? "",
    subject: fence.subject,
    templateVariant: variant,
  });
}

console.log(
  `Parsed ${entries.length} log entries, ${variantBodies.size} variant bodies -> ${exemplars.length} exemplars`
);
for (const exemplar of exemplars) {
  console.log(
    `  ${exemplar.id}: grade ${exemplar.outcomeGrade} (${exemplar.outcome}), ${exemplar.country}, ${exemplar.body.split(/\s+/u).length} words`
  );
}

const quoteSql = (value: string) => value.replaceAll("'", "''");
const statements = [
  "DELETE FROM message_exemplars WHERE source='corpus';",
  ...exemplars.map(
    (exemplar) =>
      `INSERT INTO message_exemplars
        (id,user_id,source,subject,body,country,template_variant,outcome,outcome_grade,sent_at,created_at)
       SELECT '${quoteSql(exemplar.id)}',u.id,'corpus','${quoteSql(exemplar.subject)}','${quoteSql(exemplar.body)}','${quoteSql(exemplar.country)}','${quoteSql(exemplar.templateVariant)}','${quoteSql(exemplar.outcome)}',${exemplar.outcomeGrade},'${quoteSql(exemplar.sentAt)}',datetime('now')
       FROM users u LIMIT 1;`
  ),
];

const sqlPath = join(tmpdir(), `exemplars-${Date.now()}.sql`);
writeFileSync(sqlPath, statements.join("\n"));
const result = spawnSync(
  "bunx",
  [
    "wrangler",
    "d1",
    "execute",
    "jobkit-outreach",
    ...(args.remote ? ["--remote"] : ["--local"]),
    "--yes",
    "--file",
    sqlPath,
  ],
  { cwd: resolve(import.meta.dir, "../.."), stdio: "inherit" }
);
unlinkSync(sqlPath);
process.exit(result.status ?? 1);
