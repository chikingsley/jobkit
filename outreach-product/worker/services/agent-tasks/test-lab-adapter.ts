import { z } from "zod";
import {
  documentOcrOutputJsonSchema,
  documentOcrPrompt,
  parseDocumentOcrOutput,
  parseTestLabOutput,
  TEST_LAB_DOCUMENT_OCR_PROMPT_VERSION,
  TEST_LAB_DOCUMENT_OCR_TASK_TYPE,
  TEST_LAB_PROMPT_VERSION,
  TEST_LAB_TASK_TYPE,
  testLabModel,
  testLabOutputJsonSchema,
  testLabPrompt,
} from "../../../src/agent-tasks/test-lab";
import { readTestLabCase } from "../../../src/test-lab/corpus";
import type { AgentRunnerContext } from "../../app-types";
import type { AppEnv } from "../../env";
import { agentRunnerHasCapability } from "../agent-runners";
import {
  type ClaimedAgentTaskRequest,
  claimAgentTaskRequest,
  readClaimedAgentTaskRequest,
} from "../agent-task-requests";
import {
  scoreDocumentBenchmark,
  scoreTestLabOutput,
} from "../test-lab/scoring";
import { attachDocumentArtifact } from "./artifacts";
import {
  AGENT_TASK_LEASE_MS,
  AgentTaskError,
  type AgentTaskRunRow,
  type PreparedAgentTask,
} from "./contracts";
import { createAgentTaskRun, sha256 } from "./run-store";

const CorpusTestLabTaskInputSchema = z
  .object({
    caseId: z.string().min(1),
    jinaResult: z.record(z.string(), z.unknown()).optional(),
    testLabRunId: z.string().min(1),
  })
  .strict();

const DocumentTestLabTaskInputSchema = z
  .object({
    documentEtag: z.string().min(1),
    documentId: z.string().min(1),
    documentVersion: z.string().min(1),
    testLabRunId: z.string().min(1),
  })
  .strict();

export async function claimTestLabTask(
  env: AppEnv,
  runner: AgentRunnerContext
): Promise<PreparedAgentTask | null> {
  if (!agentRunnerHasCapability(runner, "evaluation")) {
    return null;
  }
  const leaseExpiresAt = new Date(
    Date.now() + AGENT_TASK_LEASE_MS
  ).toISOString();
  const request =
    (await claimAgentTaskRequest(env.DB, {
      leaseExpiresAt,
      runnerId: runner.id,
      taskType: TEST_LAB_DOCUMENT_OCR_TASK_TYPE,
      userId: runner.user.id,
    })) ??
    (await claimAgentTaskRequest(env.DB, {
      leaseExpiresAt,
      runnerId: runner.id,
      taskType: TEST_LAB_TASK_TYPE,
      userId: runner.user.id,
    }));
  if (!request) {
    return null;
  }
  if (request.taskType === TEST_LAB_DOCUMENT_OCR_TASK_TYPE) {
    return claimDocumentOcrTask(env, runner, request, leaseExpiresAt);
  }
  try {
    const input = CorpusTestLabTaskInputSchema.parse(request.input);
    const testCase = readTestLabCase(input.caseId);
    if (!testCase) {
      throw new Error("Test Lab case no longer exists in this corpus version");
    }
    const model = testLabModel(testCase, Boolean(input.jinaResult));
    const prompt = testLabPrompt(testCase, input.jinaResult ?? null);
    const task = await createAgentTaskRun(env.DB, runner, {
      leaseExpiresAt,
      model: model.model,
      outputSchema: testLabOutputJsonSchema(testCase),
      prompt,
      promptVersion: TEST_LAB_PROMPT_VERSION,
      reasoningEffort: model.reasoningEffort,
      sourceHash: await sha256(JSON.stringify(testCase.input)),
      sourceTaskId: request.id,
      taskType: TEST_LAB_TASK_TYPE,
      webSearch: model.webSearch,
    });
    const timestamp = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE test_lab_runs
          SET status='running',started_at=?,updated_at=?
        WHERE id=? AND user_id=? AND status='queued'`
    )
      .bind(timestamp, timestamp, input.testLabRunId, runner.user.id)
      .run();
    return task;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failTestLabRequest(
      env.DB,
      runner,
      request.id,
      request.subjectId,
      message
    );
    return null;
  }
}

export async function completeTestLabTask(
  env: AppEnv,
  runner: AgentRunnerContext,
  run: AgentTaskRunRow,
  runId: string,
  rawOutput: unknown
) {
  const request = await requireClaimedRequest(
    env.DB,
    runner,
    run.source_task_id
  );
  if (run.task_type === TEST_LAB_DOCUMENT_OCR_TASK_TYPE) {
    return completeDocumentOcrTask(env, runner, request, run, runId, rawOutput);
  }
  const input = CorpusTestLabTaskInputSchema.parse(request.input);
  const testCase = readTestLabCase(input.caseId);
  if (!testCase) {
    throw new AgentTaskError("Test Lab case no longer exists", 409);
  }
  if ((await sha256(JSON.stringify(testCase.input))) !== run.source_hash) {
    throw new AgentTaskError("Test Lab case input changed during the run", 409);
  }
  const output = parseTestLabOutput(testCase, rawOutput);
  const existingMetrics = await readExistingMetrics(
    env.DB,
    runner.user.id,
    input.testLabRunId
  );
  const startedAt = existingMetrics.startedAt
    ? Date.parse(existingMetrics.startedAt)
    : Date.now();
  const metrics = {
    ...existingMetrics.metrics,
    ...scoreTestLabOutput(testCase, output),
    codexLatencyMs: Math.max(0, Date.now() - startedAt),
  };
  const timestamp = new Date().toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE test_lab_runs
          SET status='completed',output_json=?,metrics_json=?,model=?,
              prompt_version=?,error_detail='',completed_at=?,updated_at=?
        WHERE id=? AND user_id=? AND status='running'`
    ).bind(
      JSON.stringify(output),
      JSON.stringify(metrics),
      run.model,
      TEST_LAB_PROMPT_VERSION,
      timestamp,
      timestamp,
      input.testLabRunId,
      runner.user.id
    ),
    env.DB.prepare(
      `UPDATE agent_task_requests
          SET status='completed',result_json=?,error_detail='',completed_at=?,
              updated_at=?
        WHERE id=? AND user_id=? AND runner_id=? AND status='claimed'`
    ).bind(
      JSON.stringify(output),
      timestamp,
      timestamp,
      request.id,
      runner.user.id,
      runner.id
    ),
    env.DB.prepare(
      `UPDATE agent_task_runs
          SET status='completed',result_json=?,completed_at=?,updated_at=?
        WHERE id=? AND user_id=? AND runner_id=? AND status='running'`
    ).bind(
      JSON.stringify(output),
      timestamp,
      timestamp,
      runId,
      runner.user.id,
      runner.id
    ),
  ]);
  assertAtomic(results, "Test Lab task could not be completed");
  return { requestId: request.id, testLabRunId: input.testLabRunId };
}

async function claimDocumentOcrTask(
  env: AppEnv,
  runner: AgentRunnerContext,
  request: ClaimedAgentTaskRequest,
  leaseExpiresAt: string
): Promise<PreparedAgentTask | null> {
  let agentRunId: string | undefined;
  try {
    const input = DocumentTestLabTaskInputSchema.parse(request.input);
    const document = await env.DB.prepare(
      `SELECT filename,content_type,r2_version,etag
         FROM user_documents
        WHERE id=? AND user_id=? AND archived_at IS NULL`
    )
      .bind(input.documentId, runner.user.id)
      .first<{
        content_type: string;
        etag: string;
        filename: string;
        r2_version: string;
      }>();
    if (!document) {
      throw new Error("Document OCR source was not found");
    }
    if (
      document.etag !== input.documentEtag ||
      document.r2_version !== input.documentVersion
    ) {
      throw new Error("Document OCR source changed while it was queued");
    }
    const prompt = documentOcrPrompt({
      contentType: document.content_type,
      filename: document.filename,
    });
    const task = await createAgentTaskRun(env.DB, runner, {
      leaseExpiresAt,
      model: "gpt-5.6-terra",
      outputSchema: documentOcrOutputJsonSchema(),
      prompt,
      promptVersion: TEST_LAB_DOCUMENT_OCR_PROMPT_VERSION,
      reasoningEffort: "high",
      sourceHash: await sha256(
        `${input.documentId}:${input.documentVersion}:${input.documentEtag}`
      ),
      sourceTaskId: request.id,
      taskType: TEST_LAB_DOCUMENT_OCR_TASK_TYPE,
      webSearch: "disabled",
    });
    agentRunId = task.runId;
    const artifact = await attachDocumentArtifact(
      env,
      runner,
      task.runId,
      input.documentId,
      { etag: input.documentEtag, version: input.documentVersion }
    );
    const timestamp = new Date().toISOString();
    const updated = await env.DB.prepare(
      `UPDATE test_lab_runs
          SET status='running',started_at=?,updated_at=?
        WHERE id=? AND user_id=? AND status='queued'`
    )
      .bind(timestamp, timestamp, input.testLabRunId, runner.user.id)
      .run();
    if ((updated.meta.changes ?? 0) !== 1) {
      throw new Error("Document OCR benchmark changed while it was claimed");
    }
    return { ...task, artifacts: [artifact] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failTestLabRequest(
      env.DB,
      runner,
      request.id,
      request.subjectId,
      message,
      agentRunId
    );
    return null;
  }
}

async function completeDocumentOcrTask(
  env: AppEnv,
  runner: AgentRunnerContext,
  request: ClaimedAgentTaskRequest,
  run: AgentTaskRunRow,
  runId: string,
  rawOutput: unknown
) {
  const input = DocumentTestLabTaskInputSchema.parse(request.input);
  const sourceHash = await sha256(
    `${input.documentId}:${input.documentVersion}:${input.documentEtag}`
  );
  if (sourceHash !== run.source_hash) {
    throw new AgentTaskError("Document OCR source changed during the run", 409);
  }
  const output = parseDocumentOcrOutput(rawOutput);
  const context = await readDocumentRunContext(
    env.DB,
    runner.user.id,
    input.testLabRunId
  );
  const expected = z.object({ text: z.string() }).parse(context.expected);
  const startedAt = context.startedAt
    ? Date.parse(context.startedAt)
    : Date.now();
  const metrics = {
    ...context.metrics,
    ...scoreDocumentBenchmark(expected.text, output.text),
    codexLatencyMs: Math.max(0, Date.now() - startedAt),
    pages: output.pages.length,
  };
  const timestamp = new Date().toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE test_lab_runs
          SET status='completed',output_json=?,metrics_json=?,model=?,
              prompt_version=?,error_detail='',completed_at=?,updated_at=?
        WHERE id=? AND user_id=? AND status='running'`
    ).bind(
      JSON.stringify(output),
      JSON.stringify(metrics),
      run.model,
      TEST_LAB_DOCUMENT_OCR_PROMPT_VERSION,
      timestamp,
      timestamp,
      input.testLabRunId,
      runner.user.id
    ),
    env.DB.prepare(
      `UPDATE agent_task_requests
          SET status='completed',result_json=?,error_detail='',completed_at=?,
              updated_at=?
        WHERE id=? AND user_id=? AND runner_id=? AND status='claimed'`
    ).bind(
      JSON.stringify(output),
      timestamp,
      timestamp,
      request.id,
      runner.user.id,
      runner.id
    ),
    env.DB.prepare(
      `UPDATE agent_task_runs
          SET status='completed',result_json=?,completed_at=?,updated_at=?
        WHERE id=? AND user_id=? AND runner_id=? AND status='running'`
    ).bind(
      JSON.stringify(output),
      timestamp,
      timestamp,
      runId,
      runner.user.id,
      runner.id
    ),
  ]);
  assertAtomic(results, "Document OCR task could not be completed");
  return { requestId: request.id, testLabRunId: input.testLabRunId };
}

export async function failTestLabTask(
  env: AppEnv,
  runner: AgentRunnerContext,
  requestId: string,
  runId: string,
  error: string
) {
  const request = await requireClaimedRequest(env.DB, runner, requestId);
  await failTestLabRequest(
    env.DB,
    runner,
    request.id,
    request.subjectId,
    error,
    runId
  );
}

async function failTestLabRequest(
  db: D1Database,
  runner: AgentRunnerContext,
  requestId: string,
  testLabRunId: string,
  error: string,
  agentRunId?: string
) {
  const timestamp = new Date().toISOString();
  const statements = [
    db
      .prepare(
        `UPDATE test_lab_runs
          SET status='failed',error_detail=?,completed_at=?,updated_at=?
        WHERE id=? AND user_id=? AND status IN ('queued','running')`
      )
      .bind(
        error.slice(0, 4000),
        timestamp,
        timestamp,
        testLabRunId,
        runner.user.id
      ),
    db
      .prepare(
        `UPDATE agent_task_requests
          SET status='failed',error_detail=?,completed_at=?,updated_at=?
        WHERE id=? AND user_id=? AND runner_id=? AND status='claimed'`
      )
      .bind(
        error.slice(0, 4000),
        timestamp,
        timestamp,
        requestId,
        runner.user.id,
        runner.id
      ),
  ];
  if (agentRunId) {
    statements.push(
      db
        .prepare(
          `UPDATE agent_task_runs
            SET status='failed',error_detail=?,completed_at=?,updated_at=?
          WHERE id=? AND user_id=? AND runner_id=? AND status='running'`
        )
        .bind(
          error.slice(0, 4000),
          timestamp,
          timestamp,
          agentRunId,
          runner.user.id,
          runner.id
        )
    );
  }
  const results = await db.batch(statements);
  assertAtomic(results, "Test Lab task could not be failed");
}

async function requireClaimedRequest(
  db: D1Database,
  runner: AgentRunnerContext,
  requestId: string
) {
  const request = await readClaimedAgentTaskRequest(db, {
    requestId,
    runnerId: runner.id,
    userId: runner.user.id,
  });
  if (!request) {
    throw new AgentTaskError("Test Lab task request was not found", 404);
  }
  return request;
}

async function readExistingMetrics(
  db: D1Database,
  userId: string,
  testLabRunId: string
) {
  const row = await db
    .prepare(
      "SELECT metrics_json,started_at FROM test_lab_runs WHERE id=? AND user_id=?"
    )
    .bind(testLabRunId, userId)
    .first<{ metrics_json: string; started_at: string | null }>();
  if (!row) {
    throw new AgentTaskError("Test Lab run was not found", 404);
  }
  return {
    metrics: JSON.parse(row.metrics_json) as Record<string, unknown>,
    startedAt: row.started_at,
  };
}

async function readDocumentRunContext(
  db: D1Database,
  userId: string,
  testLabRunId: string
) {
  const row = await db
    .prepare(
      `SELECT expected_json,metrics_json,started_at
         FROM test_lab_runs WHERE id=? AND user_id=? AND case_kind='document'`
    )
    .bind(testLabRunId, userId)
    .first<{
      expected_json: string;
      metrics_json: string;
      started_at: string | null;
    }>();
  if (!row) {
    throw new AgentTaskError("Document benchmark run was not found", 404);
  }
  return {
    expected: JSON.parse(row.expected_json) as unknown,
    metrics: JSON.parse(row.metrics_json) as Record<string, unknown>,
    startedAt: row.started_at,
  };
}

function assertAtomic(results: D1Result[], message: string) {
  if (results.some((result) => (result.meta.changes ?? 0) !== 1)) {
    throw new AgentTaskError(message, 409);
  }
}
