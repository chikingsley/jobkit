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
import type { AgentTaskFailureCode } from "../../../src/features/agents/schema";
import { readTestLabCase } from "../../../src/test-lab/corpus";
import type { AgentRunnerContext } from "../../app-types";
import type { AppEnv } from "../../env";
import { agentRunnerHasCapability } from "../agent-runners";
import {
  type ClaimedAgentTaskRequest,
  type QueuedAgentTaskRequest,
  readClaimedAgentTaskRequest,
  readNextAgentTaskRequest,
} from "../agent-task-requests";
import {
  scoreDocumentBenchmark,
  scoreTestLabOutput,
} from "../test-lab/scoring";
import { prepareDocumentArtifact } from "./artifacts";
import {
  AgentTaskError,
  type AgentTaskRunRow,
  type PreparedAgentTask,
  type PreparedAgentTaskArtifact,
} from "./contracts";
import {
  claimRequestedAgentTaskWithDomainWrites,
  failRequestedAgentTaskWithDomainWrites,
} from "./requested-task-leases";
import {
  type AgentTaskCompletionFence,
  completeRequestedAgentTaskWithDomainWrites,
  sha256,
} from "./run-store";

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

class UnclaimableDocumentArtifactError extends Error {}

export async function claimTestLabTask(
  env: AppEnv,
  runner: AgentRunnerContext
): Promise<PreparedAgentTask | null> {
  if (!agentRunnerHasCapability(runner, "evaluation")) {
    return null;
  }
  const request =
    (await readNextAgentTaskRequest(env.DB, {
      taskType: TEST_LAB_DOCUMENT_OCR_TASK_TYPE,
      userId: runner.user.id,
    })) ??
    (await readNextAgentTaskRequest(env.DB, {
      taskType: TEST_LAB_TASK_TYPE,
      userId: runner.user.id,
    }));
  if (!request) {
    return null;
  }
  if (request.taskType === TEST_LAB_DOCUMENT_OCR_TASK_TYPE) {
    return claimDocumentOcrTask(env, runner, request);
  }
  const parsed = CorpusTestLabTaskInputSchema.safeParse(request.input);
  if (!parsed.success) {
    await failQueuedTestLabRequest(
      env.DB,
      runner,
      request,
      parsed.error.message,
      "invalid_input"
    );
    return null;
  }
  const input = parsed.data;
  const testCase = readTestLabCase(input.caseId);
  if (!testCase) {
    await failQueuedTestLabRequest(
      env.DB,
      runner,
      request,
      "Test Lab case no longer exists in this corpus version",
      "source_changed"
    );
    return null;
  }
  const model = testLabModel(testCase);
  const prompt = testLabPrompt(testCase, input.jinaResult ?? null);
  return claimRequestedAgentTaskWithDomainWrites(
    env.DB,
    runner,
    request,
    {
      model: model.model,
      outputSchema: testLabOutputJsonSchema(testCase),
      prompt,
      promptVersion: TEST_LAB_PROMPT_VERSION,
      reasoningEffort: model.reasoningEffort,
      sourceHash: await sha256(JSON.stringify(testCase.input)),
      taskType: TEST_LAB_TASK_TYPE,
      webSearch: model.webSearch,
    },
    (_context, fence) =>
      testLabClaimWrites(env.DB, runner.user.id, input.testLabRunId, fence)
  );
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
  await completeTestLabRun(
    env.DB,
    runner,
    request,
    run,
    runId,
    input.testLabRunId,
    "corpus",
    output,
    metrics,
    TEST_LAB_PROMPT_VERSION
  );
  return { requestId: request.id, testLabRunId: input.testLabRunId };
}

async function claimDocumentOcrTask(
  env: AppEnv,
  runner: AgentRunnerContext,
  request: QueuedAgentTaskRequest
): Promise<PreparedAgentTask | null> {
  const parsed = DocumentTestLabTaskInputSchema.safeParse(request.input);
  if (!parsed.success) {
    await failQueuedTestLabRequest(
      env.DB,
      runner,
      request,
      parsed.error.message,
      "invalid_input"
    );
    return null;
  }
  const input = parsed.data;
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
    await failQueuedTestLabRequest(
      env.DB,
      runner,
      request,
      "Document OCR source was not found",
      "source_changed"
    );
    return null;
  }
  if (
    document.etag !== input.documentEtag ||
    document.r2_version !== input.documentVersion
  ) {
    await failQueuedTestLabRequest(
      env.DB,
      runner,
      request,
      "Document OCR source changed while it was queued",
      "source_changed"
    );
    return null;
  }
  const prompt = documentOcrPrompt({
    contentType: document.content_type,
    filename: document.filename,
  });
  const artifacts: PreparedAgentTaskArtifact[] = [];
  try {
    return await claimRequestedAgentTaskWithDomainWrites(
      env.DB,
      runner,
      request,
      {
        artifacts,
        model: "gpt-5.6-terra",
        outputSchema: documentOcrOutputJsonSchema(),
        prompt,
        promptVersion: TEST_LAB_DOCUMENT_OCR_PROMPT_VERSION,
        reasoningEffort: "high",
        sourceHash: await sha256(
          `${input.documentId}:${input.documentVersion}:${input.documentEtag}`
        ),
        taskType: TEST_LAB_DOCUMENT_OCR_TASK_TYPE,
        webSearch: "disabled",
      },
      async (context, fence) => {
        try {
          const artifact = await prepareDocumentArtifact(
            env,
            runner.user.id,
            context.runId,
            input.documentId,
            { etag: input.documentEtag, version: input.documentVersion }
          );
          artifacts.push(artifact.artifact);
          return [
            artifact.write,
            ...testLabClaimWrites(
              env.DB,
              runner.user.id,
              input.testLabRunId,
              fence
            ),
          ];
        } catch (error) {
          if (
            error instanceof AgentTaskError &&
            (error.status === 404 || error.status === 409)
          ) {
            throw new UnclaimableDocumentArtifactError(error.message, {
              cause: error,
            });
          }
          throw error;
        }
      }
    );
  } catch (error) {
    if (!(error instanceof UnclaimableDocumentArtifactError)) {
      throw error;
    }
    await failQueuedTestLabRequest(
      env.DB,
      runner,
      request,
      error.message,
      "source_changed"
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
  await completeTestLabRun(
    env.DB,
    runner,
    request,
    run,
    runId,
    input.testLabRunId,
    "document",
    output,
    metrics,
    TEST_LAB_DOCUMENT_OCR_PROMPT_VERSION
  );
  return { requestId: request.id, testLabRunId: input.testLabRunId };
}

async function completeTestLabRun(
  db: D1Database,
  runner: AgentRunnerContext,
  request: ClaimedAgentTaskRequest,
  run: AgentTaskRunRow,
  runId: string,
  testLabRunId: string,
  caseKind: "corpus" | "document",
  output: unknown,
  metrics: Record<string, unknown>,
  promptVersion: string
) {
  await completeRequestedAgentTaskWithDomainWrites(
    db,
    {
      attemptNumber: run.attempt_number,
      leaseToken: run.lease_token,
      requestId: request.id,
      runId,
      runnerId: runner.id,
      taskType: run.task_type,
      userId: runner.user.id,
    },
    (fence) => ({
      condition: {
        clause: `EXISTS (
            SELECT 1 FROM test_lab_runs completion_test
             WHERE completion_test.id=?
               AND completion_test.user_id=?
               AND completion_test.agent_task_request_id=?
               AND completion_test.case_kind=?
               AND completion_test.status='running'
          )`,
        values: [testLabRunId, runner.user.id, request.id, caseKind],
      },
      result: output,
      writes: [
        {
          expectedChanges: 1,
          statement: db
            .prepare(
              `UPDATE test_lab_runs
                  SET status='completed',output_json=?,metrics_json=?,model=?,
                      prompt_version=?,error_detail='',
                      completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
                WHERE id=? AND user_id=? AND agent_task_request_id=?
                  AND case_kind=? AND status='running'
                  AND ${fence.clause}`
            )
            .bind(
              JSON.stringify(output),
              JSON.stringify(metrics),
              run.model,
              promptVersion,
              testLabRunId,
              runner.user.id,
              request.id,
              caseKind,
              ...fence.values
            ),
        },
      ],
    })
  );
}

export async function failTestLabTask(
  env: AppEnv,
  runner: AgentRunnerContext,
  requestId: string,
  runId: string,
  error: string,
  errorCode: AgentTaskFailureCode
) {
  const request = await requireClaimedRequest(env.DB, runner, requestId);
  await failRequestedAgentTaskWithDomainWrites(
    env.DB,
    {
      attemptNumber: request.attemptCount,
      errorCode,
      errorDetail: error,
      leaseToken: request.leaseToken,
      mode: "runner",
      requestId: request.id,
      runId,
      runnerId: runner.id,
      taskType: request.taskType,
      userId: runner.user.id,
    },
    (retry, fence) =>
      buildTestLabFailureWrites(
        env.DB,
        runner.user.id,
        request.id,
        request.subjectId,
        error,
        retry,
        fence
      )
  );
}

export function buildTestLabFailureWrites(
  db: D1Database,
  userId: string,
  requestId: string,
  testLabRunId: string,
  error: string,
  retry: boolean,
  fence: AgentTaskCompletionFence
) {
  return [
    {
      expectedChanges: 1,
      statement: db
        .prepare(
          `UPDATE test_lab_runs
            SET status=?,error_detail=?,
                started_at=CASE WHEN ?=1 THEN NULL ELSE started_at END,
                completed_at=CASE WHEN ?=1 THEN NULL ELSE
                  strftime('%Y-%m-%dT%H:%M:%fZ','now') END,
                updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=? AND user_id=? AND status='running'
            AND agent_task_request_id=? AND ${fence.clause}`
        )
        .bind(
          retry ? "queued" : "failed",
          retry ? "" : error.slice(0, 4000),
          retry ? 1 : 0,
          retry ? 1 : 0,
          testLabRunId,
          userId,
          requestId,
          ...fence.values
        ),
    },
  ];
}

function testLabClaimWrites(
  db: D1Database,
  userId: string,
  testLabRunId: string,
  fence: AgentTaskCompletionFence
) {
  return [
    {
      expectedChanges: 1,
      statement: db
        .prepare(
          `UPDATE test_lab_runs
            SET status='running',
                started_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=? AND user_id=? AND status='queued'
            AND ${fence.clause}`
        )
        .bind(testLabRunId, userId, ...fence.values),
    },
  ];
}

async function failQueuedTestLabRequest(
  db: D1Database,
  runner: AgentRunnerContext,
  request: QueuedAgentTaskRequest,
  error: string,
  errorCode: "invalid_input" | "source_changed"
) {
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE test_lab_runs
            SET status='failed',error_detail=?,
                completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=? AND user_id=? AND status='queued'
            AND EXISTS (
              SELECT 1 FROM agent_task_requests failure_request
               WHERE failure_request.id=? AND failure_request.user_id=?
                 AND failure_request.status='queued'
            )`
      )
      .bind(
        error.slice(0, 4000),
        request.subjectId,
        runner.user.id,
        request.id,
        runner.user.id
      ),
    db.prepare(
      `INSERT INTO transaction_assertions(must_equal_one)
       SELECT 0 WHERE changes()<>1`
    ),
    db
      .prepare(
        `UPDATE agent_task_requests
          SET status='failed',last_error_code=?,error_detail=?,
              completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND user_id=? AND status='queued'`
      )
      .bind(errorCode, error.slice(0, 4000), request.id, runner.user.id),
    db.prepare(
      `INSERT INTO transaction_assertions(must_equal_one)
       SELECT 0 WHERE changes()<>1`
    ),
  ];
  try {
    await db.batch(statements);
  } catch (failure) {
    if (
      !(
        failure instanceof Error &&
        failure.message.toLowerCase().includes("constraint")
      )
    ) {
      throw failure;
    }
  }
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
