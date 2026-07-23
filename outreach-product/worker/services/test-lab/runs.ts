import {
  TEST_LAB_CASES,
  TEST_LAB_CORPUS_VERSION,
  type TestLabVariant,
} from "../../../src/test-lab/corpus";
import type { AppEnv } from "../../env";
import { TestLabError } from "./errors";
import type { DocumentBenchmarkVariant, TestLabRunRow } from "./runs/model";
import {
  executeDocumentProviderRun,
  executeHybridRun,
  executeJinaRun,
  queueCodexRun,
  queueDocumentCodexRun,
} from "./runs/providers";
import {
  readBenchmarkDocument,
  requireTestCase,
  summarizeRuns,
  toTestLabRunView,
} from "./runs/storage";

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
