import {
  TEST_LAB_DOCUMENT_OCR_PROMPT_VERSION,
  TEST_LAB_DOCUMENT_OCR_TASK_TYPE,
  TEST_LAB_TASK_TYPE,
  testLabModel,
} from "../../../src/agent-tasks/test-lab";
import {
  readTestLabCase,
  TEST_LAB_CASES,
  TEST_LAB_CORPUS_VERSION,
  type TestLabCase,
  type TestLabVariant,
} from "../../../src/test-lab/corpus";
import type { AppEnv } from "../../env";
import { buildAgentTaskRequestCreation } from "../agent-task-requests";
import {
  extractDocumentDeterministically,
  runMistralDocumentOcr,
} from "../document-text";
import { TestLabError } from "./errors";
import { executeJinaCase, type JinaExecutionResult } from "./jina";
import { scoreDocumentBenchmark, scoreTestLabOutput } from "./scoring";

interface TestLabRunRow {
  agent_task_request_id: string | null;
  capability: string;
  case_id: string;
  case_kind: string;
  completed_at: string | null;
  corpus_version: string;
  created_at: string;
  error_detail: string;
  expected_json: string;
  id: string;
  input_json: string;
  intermediate_json: string | null;
  metrics_json: string;
  model: string;
  output_json: string | null;
  prompt_version: string;
  provenance_json: string;
  provider: string;
  started_at: string | null;
  status: "cancelled" | "completed" | "failed" | "queued" | "running";
  updated_at: string;
  variant: string;
}

interface BenchmarkDocumentRow {
  content_type: string;
  etag: string;
  filename: string;
  id: string;
  object_key: string;
  r2_version: string;
  size_bytes: number;
}

type DocumentBenchmarkVariant =
  | "codex_vision"
  | "deterministic"
  | "mistral_ocr";

const DOCUMENT_BENCHMARK_VERSION = "document-ocr-2026-07-18-v1";

export function startTestLabRun(
  env: AppEnv,
  userId: string,
  caseId: string,
  variant: TestLabVariant
) {
  const testCase = requireTestCase(caseId);
  if (!testCase.supportedVariants.includes(variant)) {
    throw new TestLabError(
      `${variant} is not supported for ${testCase.capability}`,
      409
    );
  }
  if (variant === "jina") {
    return executeJinaRun(env, userId, testCase);
  }
  if (variant === "hybrid") {
    return executeHybridRun(env, userId, testCase);
  }
  return queueCodexRun(env.DB, userId, testCase, null, "codex");
}

export async function startDocumentBenchmarkRun(
  env: AppEnv,
  userId: string,
  input: {
    documentId: string;
    expectedText: string;
    variant: DocumentBenchmarkVariant;
  }
) {
  const document = await readBenchmarkDocument(
    env.DB,
    userId,
    input.documentId
  );
  if (input.variant === "codex_vision") {
    if (
      document.content_type !== "application/pdf" &&
      !document.content_type.startsWith("image/")
    ) {
      throw new TestLabError(
        "Codex vision accepts PDF and image documents in this benchmark",
        409
      );
    }
    return queueDocumentCodexRun(env.DB, userId, document, input.expectedText);
  }
  if (input.variant === "mistral_ocr" && !env.MISTRAL_API_KEY) {
    throw new TestLabError("Mistral OCR is not configured", 409);
  }
  return executeDocumentProviderRun(
    env,
    userId,
    document,
    input.expectedText,
    input.variant
  );
}

export async function replayTestLabRun(
  env: AppEnv,
  userId: string,
  runId: string
) {
  const run = await readTestLabRun(env.DB, userId, runId);
  if (!run) {
    throw new TestLabError("Test Lab run was not found", 404);
  }
  if (run.caseKind !== "corpus") {
    throw new TestLabError(
      "Document benchmark runs must be replayed from their source document",
      409
    );
  }
  if (!new Set(["codex", "jina", "hybrid"]).has(run.variant)) {
    throw new TestLabError(
      "This Test Lab variant cannot be replayed here",
      409
    );
  }
  return startTestLabRun(
    env,
    userId,
    run.caseId,
    run.variant as TestLabVariant
  );
}

export async function listTestLab(env: AppEnv, userId: string) {
  const [runs, preferences] = await Promise.all([
    env.DB.prepare(
      `SELECT * FROM test_lab_runs
        WHERE user_id=? ORDER BY created_at DESC`
    )
      .bind(userId)
      .all<TestLabRunRow>(),
    env.DB.prepare(
      `SELECT id,left_run_id,right_run_id,preference,notes,created_at
         FROM test_lab_preferences
        WHERE user_id=? ORDER BY created_at DESC`
    )
      .bind(userId)
      .all<Record<string, unknown>>(),
  ]);
  return {
    cases: TEST_LAB_CASES,
    corpusVersion: TEST_LAB_CORPUS_VERSION,
    integrations: {
      codex: true,
      jina: Boolean(env.JINA_API_KEY),
      mistralOcr: Boolean(env.MISTRAL_API_KEY),
    },
    preferences: preferences.results.map((row) => ({
      createdAt: String(row.created_at),
      id: String(row.id),
      leftRunId: String(row.left_run_id),
      notes: String(row.notes),
      preference: String(row.preference),
      rightRunId: String(row.right_run_id),
    })),
    runs: runs.results.map(toTestLabRunView),
    summary: summarizeRuns(runs.results),
  };
}

export async function readTestLabRun(
  db: D1Database,
  userId: string,
  runId: string
) {
  const row = await db
    .prepare("SELECT * FROM test_lab_runs WHERE id=? AND user_id=?")
    .bind(runId, userId)
    .first<TestLabRunRow>();
  return row ? toTestLabRunView(row) : null;
}

export async function saveTestLabPreference(
  db: D1Database,
  userId: string,
  input: {
    leftRunId: string;
    notes: string;
    preference: "both_bad" | "left" | "right" | "tie";
    rightRunId: string;
  }
) {
  if (input.leftRunId === input.rightRunId) {
    throw new TestLabError("Choose two different Test Lab runs", 400);
  }
  const rows = await db
    .prepare(
      `SELECT id,case_id,status FROM test_lab_runs
        WHERE user_id=? AND id IN (?,?)`
    )
    .bind(userId, input.leftRunId, input.rightRunId)
    .all<{ case_id: string; id: string; status: string }>();
  if (rows.results.length !== 2) {
    throw new TestLabError("One or both Test Lab runs were not found", 404);
  }
  if (rows.results.some((row) => row.status !== "completed")) {
    throw new TestLabError("Only completed Test Lab runs can be compared", 409);
  }
  if (new Set(rows.results.map((row) => row.case_id)).size !== 1) {
    throw new TestLabError(
      "Human preference requires two runs of the same case",
      409
    );
  }
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO test_lab_preferences
        (id,user_id,left_run_id,right_run_id,preference,notes,created_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(user_id,left_run_id,right_run_id) DO UPDATE SET
         preference=excluded.preference,notes=excluded.notes,
         created_at=excluded.created_at`
    )
    .bind(
      id,
      userId,
      input.leftRunId,
      input.rightRunId,
      input.preference,
      input.notes,
      createdAt
    )
    .run();
  return { createdAt, id, ...input };
}

export async function resetTestLab(db: D1Database, userId: string) {
  const active = await db
    .prepare(
      `SELECT COUNT(*) count FROM test_lab_runs
        WHERE user_id=? AND status IN ('queued','running')`
    )
    .bind(userId)
    .first<{ count: number }>();
  if ((active?.count ?? 0) > 0) {
    throw new TestLabError(
      "Cancel or finish active Test Lab runs before resetting the lab",
      409
    );
  }
  await db.batch([
    db
      .prepare(
        `DELETE FROM agent_task_requests
        WHERE user_id=? AND subject_type='test_lab_run'
          AND status IN ('completed','failed','cancelled')`
      )
      .bind(userId),
    db.prepare("DELETE FROM test_lab_runs WHERE user_id=?").bind(userId),
  ]);
  return { resetAt: new Date().toISOString() };
}

async function executeJinaRun(
  env: AppEnv,
  userId: string,
  testCase: TestLabCase
) {
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  await insertRunningJinaRun(
    env.DB,
    userId,
    runId,
    testCase,
    "jina",
    startedAt
  );
  const started = performance.now();
  try {
    const result = await executeJinaCase(env, testCase);
    const metrics = {
      ...scoreTestLabOutput(testCase, result.output),
      latencyMs: Math.round(performance.now() - started),
      usage: result.usage,
    };
    const completedAt = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE test_lab_runs
          SET status='completed',model=?,output_json=?,metrics_json=?,
              provenance_json=?,completed_at=?,updated_at=?
        WHERE id=? AND user_id=? AND status='running'`
    )
      .bind(
        result.model,
        JSON.stringify(result.output),
        JSON.stringify(metrics),
        JSON.stringify(result.provenance),
        completedAt,
        completedAt,
        runId,
        userId
      )
      .run();
    return requireStoredRun(env.DB, userId, runId);
  } catch (error) {
    await failTestLabRun(env.DB, userId, runId, error);
    throw error;
  }
}

async function executeDocumentProviderRun(
  env: AppEnv,
  userId: string,
  document: BenchmarkDocumentRow,
  expectedText: string,
  variant: "deterministic" | "mistral_ocr"
) {
  const runId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  await insertDocumentRun(
    env.DB,
    userId,
    runId,
    document,
    expectedText,
    variant,
    variant === "deterministic" ? "deterministic" : "mistral",
    "running",
    null,
    timestamp
  );
  const started = performance.now();
  try {
    const bytes = await readBenchmarkDocumentBytes(env.DOCUMENTS, document);
    const result =
      variant === "deterministic"
        ? await extractDocumentDeterministically({
            bytes,
            contentType: document.content_type,
            filename: document.filename,
          })
        : await runMistralDocumentOcr(env, {
            bytes,
            contentType: document.content_type,
            filename: document.filename,
          });
    const output = result ?? {
      detail: "no-readable-text",
      pages: [],
      provider: "deterministic" as const,
      text: "",
    };
    const completedAt = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE test_lab_runs
          SET status='completed',model=?,output_json=?,metrics_json=?,
              provenance_json=?,completed_at=?,updated_at=?
        WHERE id=? AND user_id=? AND status='running'`
    )
      .bind(
        output.detail,
        JSON.stringify(output),
        JSON.stringify({
          ...scoreDocumentBenchmark(expectedText, output.text),
          latencyMs: Math.round(performance.now() - started),
          pages: output.pages.length,
        }),
        JSON.stringify({
          documentEtag: document.etag,
          documentVersion: document.r2_version,
          extractor: output.detail,
        }),
        completedAt,
        completedAt,
        runId,
        userId
      )
      .run();
  } catch (error) {
    await failTestLabRun(env.DB, userId, runId, error);
  }
  return requireStoredRun(env.DB, userId, runId);
}

async function queueDocumentCodexRun(
  db: D1Database,
  userId: string,
  document: BenchmarkDocumentRow,
  expectedText: string
) {
  const runId = crypto.randomUUID();
  const creation = buildAgentTaskRequestCreation(db, {
    payload: {
      documentEtag: document.etag,
      documentId: document.id,
      documentVersion: document.r2_version,
      testLabRunId: runId,
    },
    subjectId: runId,
    subjectType: "test_lab_run",
    taskType: TEST_LAB_DOCUMENT_OCR_TASK_TYPE,
    userId,
  });
  const timestamp = new Date().toISOString();
  await db.batch([
    creation.statement,
    buildDocumentRunInsert(
      db,
      userId,
      runId,
      document,
      expectedText,
      "codex_vision",
      "codex",
      "queued",
      creation.request.id,
      timestamp
    ),
  ]);
  return requireStoredRun(db, userId, runId);
}

async function executeHybridRun(
  env: AppEnv,
  userId: string,
  testCase: TestLabCase
) {
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  await insertRunningJinaRun(
    env.DB,
    userId,
    runId,
    testCase,
    "hybrid",
    startedAt
  );
  const started = performance.now();
  try {
    const jina = await executeJinaCase(env, testCase);
    const jinaLatencyMs = Math.round(performance.now() - started);
    return queueExistingHybridRun(
      env.DB,
      userId,
      runId,
      testCase,
      jina,
      jinaLatencyMs
    );
  } catch (error) {
    await failTestLabRun(env.DB, userId, runId, error);
    throw error;
  }
}

async function queueCodexRun(
  db: D1Database,
  userId: string,
  testCase: TestLabCase,
  intermediate: Record<string, unknown> | null,
  variant: "codex" | "hybrid"
) {
  const runId = crypto.randomUUID();
  const model = testLabModel(testCase, variant === "hybrid");
  const creation = buildAgentTaskRequestCreation(db, {
    payload: {
      caseId: testCase.id,
      testLabRunId: runId,
      ...(intermediate ? { jinaResult: intermediate } : {}),
    },
    subjectId: runId,
    subjectType: "test_lab_run",
    taskType: TEST_LAB_TASK_TYPE,
    userId,
  });
  const timestamp = new Date().toISOString();
  const statements = [
    creation.statement,
    db
      .prepare(
        `INSERT INTO test_lab_runs
          (id,user_id,corpus_version,case_id,case_kind,capability,variant,
           provider,model,prompt_version,status,input_json,expected_json,
           intermediate_json,metrics_json,provenance_json,
           agent_task_request_id,created_at,updated_at)
         VALUES (?,?,?,?,'corpus',?,?,?,?,?,'queued',?,?,?,?,?,?,?,?)`
      )
      .bind(
        runId,
        userId,
        TEST_LAB_CORPUS_VERSION,
        testCase.id,
        testCase.capability,
        variant,
        variant === "hybrid" ? "jina+codex" : "codex",
        model.model,
        TEST_LAB_TASK_TYPE,
        JSON.stringify(testCase.input),
        JSON.stringify(testCase.expected),
        intermediate ? JSON.stringify(intermediate) : null,
        JSON.stringify({}),
        JSON.stringify({ source: testCase.source }),
        creation.request.id,
        timestamp,
        timestamp
      ),
  ];
  await db.batch(statements);
  return requireStoredRun(db, userId, runId);
}

async function queueExistingHybridRun(
  db: D1Database,
  userId: string,
  runId: string,
  testCase: TestLabCase,
  jina: JinaExecutionResult,
  jinaLatencyMs: number
) {
  const creation = buildAgentTaskRequestCreation(db, {
    payload: {
      caseId: testCase.id,
      jinaResult: jina.output,
      testLabRunId: runId,
    },
    subjectId: runId,
    subjectType: "test_lab_run",
    taskType: TEST_LAB_TASK_TYPE,
    userId,
  });
  const timestamp = new Date().toISOString();
  const model = testLabModel(testCase, true);
  const results = await db.batch([
    creation.statement,
    db
      .prepare(
        `UPDATE test_lab_runs
            SET status='queued',model=?,prompt_version=?,intermediate_json=?,
                metrics_json=?,provenance_json=?,agent_task_request_id=?,
                started_at=NULL,updated_at=?
          WHERE id=? AND user_id=? AND status='running'`
      )
      .bind(
        model.model,
        TEST_LAB_TASK_TYPE,
        JSON.stringify(jina.output),
        JSON.stringify({ jinaLatencyMs, jinaUsage: jina.usage }),
        JSON.stringify({ jina: jina.provenance, source: testCase.source }),
        creation.request.id,
        timestamp,
        runId,
        userId
      ),
  ]);
  if (results.some((result) => (result.meta.changes ?? 0) !== 1)) {
    throw new TestLabError("Hybrid Test Lab run changed concurrently", 409);
  }
  return requireStoredRun(db, userId, runId);
}

function insertRunningJinaRun(
  db: D1Database,
  userId: string,
  runId: string,
  testCase: TestLabCase,
  variant: "hybrid" | "jina",
  timestamp: string
) {
  return db
    .prepare(
      `INSERT INTO test_lab_runs
        (id,user_id,corpus_version,case_id,case_kind,capability,variant,
         provider,status,input_json,expected_json,metrics_json,provenance_json,
         started_at,created_at,updated_at)
       VALUES (?,?,?,?,'corpus',?,?,?,'running',?,?,?,?,?,?,?)`
    )
    .bind(
      runId,
      userId,
      TEST_LAB_CORPUS_VERSION,
      testCase.id,
      testCase.capability,
      variant,
      variant === "hybrid" ? "jina+codex" : "jina",
      JSON.stringify(testCase.input),
      JSON.stringify(testCase.expected),
      JSON.stringify({}),
      JSON.stringify({ source: testCase.source }),
      timestamp,
      timestamp,
      timestamp
    )
    .run();
}

async function failTestLabRun(
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

async function readBenchmarkDocument(
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

async function readBenchmarkDocumentBytes(
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

function insertDocumentRun(
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

function buildDocumentRunInsert(
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

async function requireStoredRun(db: D1Database, userId: string, runId: string) {
  const run = await readTestLabRun(db, userId, runId);
  if (!run) {
    throw new Error("Test Lab run could not be read back");
  }
  return run;
}

function requireTestCase(caseId: string) {
  const testCase = readTestLabCase(caseId);
  if (!testCase) {
    throw new TestLabError("Test Lab case was not found", 404);
  }
  return testCase;
}

function toTestLabRunView(row: TestLabRunRow) {
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

function summarizeRuns(rows: TestLabRunRow[]) {
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
