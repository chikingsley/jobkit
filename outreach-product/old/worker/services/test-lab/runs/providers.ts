import {
  TEST_LAB_DOCUMENT_OCR_TASK_TYPE,
  TEST_LAB_TASK_TYPE,
  testLabModel,
} from "../../../../src/agent-tasks/test-lab";
import {
  TEST_LAB_CORPUS_VERSION,
  type TestLabCase,
} from "../../../../src/test-lab/corpus";
import type { AppEnv } from "../../../env";
import { buildAgentTaskRequestCreation } from "../../agent-task-requests";
import {
  extractDocumentDeterministically,
  runMistralDocumentOcr,
} from "../../document-text";
import { TestLabError } from "../errors";
import { executeJinaCase, type JinaExecutionResult } from "../jina";
import { scoreDocumentBenchmark, scoreTestLabOutput } from "../scoring";
import type { BenchmarkDocumentRow } from "./model";
import {
  buildDocumentRunInsert,
  failTestLabRun,
  insertDocumentRun,
  readBenchmarkDocumentBytes,
  requireStoredRun,
} from "./storage";

export async function executeJinaRun(
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

export async function executeDocumentProviderRun(
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

export async function queueDocumentCodexRun(
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

export async function executeHybridRun(
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

export async function queueCodexRun(
  db: D1Database,
  userId: string,
  testCase: TestLabCase,
  intermediate: Record<string, unknown> | null,
  variant: "codex" | "hybrid"
) {
  const runId = crypto.randomUUID();
  const model = testLabModel(testCase);
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
  const model = testLabModel(testCase);
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
