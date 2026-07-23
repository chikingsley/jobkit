import { TEST_LAB_DOCUMENT_OCR_PROMPT_VERSION } from "../../../../src/agent-tasks/test-lab";
import { readTestLabCase } from "../../../../src/test-lab/corpus";
import { TestLabError } from "../errors";
import { readTestLabRun } from "../runs";
import {
  type BenchmarkDocumentRow,
  DOCUMENT_BENCHMARK_VERSION,
  type DocumentBenchmarkVariant,
  type TestLabRunRow,
} from "./model";

export async function failTestLabRun(
  db: D1Database,
  userId: string,
  runId: string,
  error: unknown
) {
  const timestamp = new Date().toISOString();
  await db
    .prepare(
      `UPDATE test_lab_runs
          SET status='failed',error_detail=?,completed_at=?,updated_at=?
        WHERE id=? AND user_id=? AND status IN ('queued','running')`
    )
    .bind(
      (error instanceof Error ? error.message : String(error)).slice(0, 4000),
      timestamp,
      timestamp,
      runId,
      userId
    )
    .run();
}

export async function readBenchmarkDocument(
  db: D1Database,
  userId: string,
  documentId: string
) {
  const document = await db
    .prepare(
      `SELECT id,filename,object_key,content_type,size_bytes,r2_version,etag
         FROM user_documents
        WHERE id=? AND user_id=? AND archived_at IS NULL`
    )
    .bind(documentId, userId)
    .first<BenchmarkDocumentRow>();
  if (!document) {
    throw new TestLabError("Document benchmark source was not found", 404);
  }
  return document;
}

export async function readBenchmarkDocumentBytes(
  bucket: R2Bucket,
  document: BenchmarkDocumentRow
) {
  const object = await bucket.get(document.object_key);
  if (!object) {
    throw new TestLabError("Document benchmark data was not found", 404);
  }
  if (object.version !== document.r2_version || object.etag !== document.etag) {
    throw new TestLabError("Document benchmark version changed", 409);
  }
  return object.arrayBuffer();
}

export function insertDocumentRun(
  db: D1Database,
  userId: string,
  runId: string,
  document: BenchmarkDocumentRow,
  expectedText: string,
  variant: DocumentBenchmarkVariant,
  provider: string,
  status: "queued" | "running",
  requestId: string | null,
  timestamp: string
) {
  return buildDocumentRunInsert(
    db,
    userId,
    runId,
    document,
    expectedText,
    variant,
    provider,
    status,
    requestId,
    timestamp
  ).run();
}

export function buildDocumentRunInsert(
  db: D1Database,
  userId: string,
  runId: string,
  document: BenchmarkDocumentRow,
  expectedText: string,
  variant: DocumentBenchmarkVariant,
  provider: string,
  status: "queued" | "running",
  requestId: string | null,
  timestamp: string
) {
  return db
    .prepare(
      `INSERT INTO test_lab_runs
        (id,user_id,corpus_version,case_id,case_kind,capability,variant,
         provider,model,prompt_version,status,input_json,expected_json,
         metrics_json,provenance_json,agent_task_request_id,started_at,
         created_at,updated_at)
       VALUES (?,?,?,?,'document','document_ocr',?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      runId,
      userId,
      DOCUMENT_BENCHMARK_VERSION,
      `document:${document.id}`,
      variant,
      provider,
      variant === "codex_vision" ? "gpt-5.6-terra" : "",
      variant === "codex_vision" ? TEST_LAB_DOCUMENT_OCR_PROMPT_VERSION : "",
      status,
      JSON.stringify({
        contentType: document.content_type,
        documentId: document.id,
        filename: document.filename,
        sizeBytes: document.size_bytes,
      }),
      JSON.stringify({ text: expectedText }),
      JSON.stringify({}),
      JSON.stringify({
        documentEtag: document.etag,
        documentVersion: document.r2_version,
      }),
      requestId,
      status === "running" ? timestamp : null,
      timestamp,
      timestamp
    );
}

export async function requireStoredRun(
  db: D1Database,
  userId: string,
  runId: string
) {
  const run = await readTestLabRun(db, userId, runId);
  if (!run) {
    throw new Error("Test Lab run could not be read back");
  }
  return run;
}

export function requireTestCase(caseId: string) {
  const testCase = readTestLabCase(caseId);
  if (!testCase) {
    throw new TestLabError("Test Lab case was not found", 404);
  }
  return testCase;
}

export function toTestLabRunView(row: TestLabRunRow) {
  return {
    agentTaskRequestId: row.agent_task_request_id,
    capability: row.capability,
    caseId: row.case_id,
    caseKind: row.case_kind,
    completedAt: row.completed_at,
    corpusVersion: row.corpus_version,
    createdAt: row.created_at,
    error: row.error_detail,
    expected: JSON.parse(row.expected_json) as unknown,
    id: row.id,
    input: JSON.parse(row.input_json) as unknown,
    intermediate: row.intermediate_json
      ? (JSON.parse(row.intermediate_json) as unknown)
      : null,
    metrics: JSON.parse(row.metrics_json) as unknown,
    model: row.model,
    output: row.output_json ? (JSON.parse(row.output_json) as unknown) : null,
    promptVersion: row.prompt_version,
    provenance: JSON.parse(row.provenance_json) as unknown,
    provider: row.provider,
    startedAt: row.started_at,
    status: row.status,
    updatedAt: row.updated_at,
    variant: row.variant,
  };
}

export function summarizeRuns(rows: TestLabRunRow[]) {
  const completed = rows.filter((row) => row.status === "completed");
  const scored = completed.flatMap((row) => {
    const metrics = JSON.parse(row.metrics_json) as Record<string, unknown>;
    return typeof metrics.score === "number" ? [metrics.score] : [];
  });
  return {
    active: rows.filter(
      (row) => row.status === "queued" || row.status === "running"
    ).length,
    completed: completed.length,
    failed: rows.filter((row) => row.status === "failed").length,
    meanScore:
      scored.length > 0
        ? scored.reduce((total, score) => total + score, 0) / scored.length
        : null,
    total: rows.length,
  };
}
