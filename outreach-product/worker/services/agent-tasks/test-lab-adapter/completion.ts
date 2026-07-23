import { z } from "zod";
import {
  parseDocumentOcrOutput,
  TEST_LAB_DOCUMENT_OCR_PROMPT_VERSION,
} from "../../../../src/agent-tasks/test-lab";
import type { AgentTaskFailureCode } from "../../../../src/features/agents/schema";
import type { AgentRunnerContext } from "../../../app-types";
import type { AppEnv } from "../../../env";
import type { ClaimedAgentTaskRequest } from "../../agent-task-requests";
import { scoreDocumentBenchmark } from "../../test-lab/scoring";
import { AgentTaskError, type AgentTaskRunRow } from "../contracts";
import { failRequestedAgentTaskWithDomainWrites } from "../requested-task-leases";
import {
  completeRequestedAgentTaskWithDomainWrites,
  sha256,
} from "../run-store";
import { DocumentTestLabTaskInputSchema } from "./model";
import {
  buildTestLabFailureWrites,
  readDocumentRunContext,
  requireClaimedRequest,
} from "./support";

export async function completeDocumentOcrTask(
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

export async function completeTestLabRun(
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
