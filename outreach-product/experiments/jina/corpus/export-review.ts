import type { Database } from "bun:sqlite";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { openCorpusLedger } from "./ledger";

interface DisagreementRow {
  board: string;
  company: string;
  confidence: "high" | "low" | "medium";
  country: string;
  description: string;
  evidence: string;
  item_id: string;
  label: "english_teaching" | "non_teaching" | "subject_teaching" | "unclear";
  model: string;
  pass_id: string;
  prompt_version: string;
  rationale: string;
  reasoning_effort: string;
  source_hash: string;
  source_url: string;
  title: string;
}

export async function exportClassificationReview(input: {
  corpusVersion: string;
  databasePath: string;
  outputPath: string;
}) {
  const database = openCorpusLedger(input.databasePath);
  try {
    const cases = readDisagreements(database, input.corpusVersion);
    await mkdir(dirname(input.outputPath), { recursive: true });
    await writeFile(
      input.outputPath,
      `${JSON.stringify({ cases, corpusVersion: input.corpusVersion }, null, 2)}\n`,
      "utf8"
    );
    return {
      cases: cases.length,
      corpusVersion: input.corpusVersion,
      outputPath: input.outputPath,
    };
  } finally {
    database.close();
  }
}

function readDisagreements(database: Database, corpusVersion: string) {
  const rows = database
    .query(
      `WITH disagreements AS (
         SELECT item_id
           FROM corpus_labels
          WHERE corpus_version = ?
          GROUP BY item_id
         HAVING COUNT(*) = 2 AND COUNT(DISTINCT label) > 1
       )
       SELECT i.item_id,i.board,i.title,i.company,i.country,i.description,
              i.source_url,i.source_hash,l.pass_id,l.label,l.confidence,
              l.rationale,l.evidence,r.model,r.reasoning_effort,r.prompt_version
         FROM disagreements d
         JOIN corpus_items i
           ON i.corpus_version = ? AND i.item_id = d.item_id
         JOIN corpus_labels l
           ON l.corpus_version = i.corpus_version AND l.item_id = i.item_id
         JOIN labeling_runs r
           ON r.corpus_version = l.corpus_version AND r.pass_id = l.pass_id
        ORDER BY i.board,i.item_id,l.pass_id`
    )
    .all(corpusVersion, corpusVersion) as DisagreementRow[];
  const grouped = new Map<
    string,
    Omit<ReturnType<typeof toCase>, "labels"> & {
      labels: ReturnType<typeof toLabel>[];
    }
  >();
  for (const row of rows) {
    const existing = grouped.get(row.item_id);
    if (existing) {
      existing.labels.push(toLabel(row));
    } else {
      grouped.set(row.item_id, { ...toCase(row), labels: [toLabel(row)] });
    }
  }
  const cases = [...grouped.values()];
  if (cases.some((reviewCase) => reviewCase.labels.length !== 2)) {
    throw new Error(
      "Every classification disagreement must contain two blind labels"
    );
  }
  return cases;
}

function toCase(row: DisagreementRow) {
  return {
    board: row.board,
    company: row.company,
    country: row.country,
    description: row.description,
    itemId: row.item_id,
    sourceHash: row.source_hash,
    sourceUrl: row.source_url,
    title: row.title,
  };
}

function toLabel(row: DisagreementRow) {
  return {
    confidence: row.confidence,
    evidence: row.evidence,
    label: row.label,
    model: row.model,
    passId: row.pass_id,
    promptVersion: row.prompt_version,
    rationale: row.rationale,
    reasoningEffort: row.reasoning_effort,
  };
}
