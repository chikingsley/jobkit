import {
  documentOcrOutputJsonSchema,
  documentOcrPrompt,
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
  type QueuedAgentTaskRequest,
  readNextAgentTaskRequest,
} from "../agent-task-requests";
import { scoreTestLabOutput } from "../test-lab/scoring";
import { prepareDocumentArtifact } from "./artifacts";
import {
  AgentTaskError,
  type AgentTaskRunRow,
  type PreparedAgentTask,
  type PreparedAgentTaskArtifact,
} from "./contracts";
import { claimRequestedAgentTaskWithDomainWrites } from "./requested-task-leases";
import { sha256 } from "./run-store";
import {
  completeDocumentOcrTask,
  completeTestLabRun,
} from "./test-lab-adapter/completion";
import {
  CorpusTestLabTaskInputSchema,
  DocumentTestLabTaskInputSchema,
  UnclaimableDocumentArtifactError,
} from "./test-lab-adapter/model";
import {
  failQueuedTestLabRequest,
  readExistingMetrics,
  requireClaimedRequest,
  testLabClaimWrites,
} from "./test-lab-adapter/support";

// biome-ignore lint/performance/noBarrelFile: This behavior-owning module preserves its stable public API after internal decomposition.
export { failTestLabTask } from "./test-lab-adapter/completion";
export { buildTestLabFailureWrites } from "./test-lab-adapter/support";

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
