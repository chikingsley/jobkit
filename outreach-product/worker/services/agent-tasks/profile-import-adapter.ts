import { z } from "zod";
import {
  PROFILE_IMPORT_MODEL,
  PROFILE_IMPORT_OUTPUT_JSON_SCHEMA,
  PROFILE_IMPORT_PROMPT_VERSION,
  PROFILE_IMPORT_TASK_TYPE,
  profileImportPrompt,
} from "../../../src/agent-tasks/profile-import";
import {
  PROFILE_IMPORT_PROPOSAL_SCHEMA_VERSION,
  ProfileImportProposalSchema,
} from "../../../src/features/onboarding/schema";
import { normalizeProfileImportProposal } from "../../ai/profile-extraction";
import type { AgentRunnerContext } from "../../app-types";
import type { AppEnv } from "../../env";
import { failProfileImport } from "../../repositories/onboarding";
import { agentRunnerHasCapability } from "../agent-runners";
import {
  claimAgentTaskRequest,
  failAgentTaskRequest,
  readClaimedAgentTaskRequest,
} from "../agent-task-requests";
import {
  AGENT_TASK_LEASE_MS,
  AgentTaskError,
  type AgentTaskRunRow,
  type PreparedAgentTask,
} from "./contracts";
import { createAgentTaskRun, sha256 } from "./run-store";

const ProfileImportTaskInputSchema = z
  .object({ sourceTextKey: z.string().min(1) })
  .strict();

export async function claimProfileImportTask(
  env: AppEnv,
  runner: AgentRunnerContext
): Promise<PreparedAgentTask | null> {
  if (!agentRunnerHasCapability(runner, "extraction")) {
    return null;
  }
  const leaseExpiresAt = new Date(
    Date.now() + AGENT_TASK_LEASE_MS
  ).toISOString();
  const request = await claimAgentTaskRequest(env.DB, {
    leaseExpiresAt,
    runnerId: runner.id,
    taskType: PROFILE_IMPORT_TASK_TYPE,
    userId: runner.user.id,
  });
  if (!request) {
    return null;
  }
  try {
    const { sourceTextKey } = ProfileImportTaskInputSchema.parse(request.input);
    const sourceText = await readR2Text(env.DOCUMENTS, sourceTextKey);
    return await createAgentTaskRun(env.DB, runner, {
      leaseExpiresAt,
      model: PROFILE_IMPORT_MODEL.model,
      outputSchema: PROFILE_IMPORT_OUTPUT_JSON_SCHEMA,
      prompt: profileImportPrompt(sourceText),
      promptVersion: PROFILE_IMPORT_PROMPT_VERSION,
      reasoningEffort: PROFILE_IMPORT_MODEL.reasoningEffort,
      sourceHash: await sha256(sourceText),
      sourceTaskId: request.id,
      taskType: PROFILE_IMPORT_TASK_TYPE,
      webSearch: "disabled",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failProfileImport(env.DB, {
      errorMessage: message,
      importId: request.subjectId,
      updatedAt: new Date().toISOString(),
      userId: runner.user.id,
    });
    await failAgentTaskRequest(env.DB, {
      error: message,
      requestId: request.id,
      runnerId: runner.id,
      userId: runner.user.id,
    });
    return null;
  }
}

export async function completeProfileImportTask(
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
  const { sourceTextKey } = ProfileImportTaskInputSchema.parse(request.input);
  const sourceText = await readR2Text(env.DOCUMENTS, sourceTextKey);
  if ((await sha256(sourceText)) !== run.source_hash) {
    throw new AgentTaskError("Profile import source changed", 409);
  }
  const proposal = normalizeProfileImportProposal(
    ProfileImportProposalSchema.parse(rawOutput),
    sourceText
  );
  const timestamp = new Date().toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE profile_imports
          SET status='ready',source_text_key=?,proposal_json=?,
              proposal_schema_version=?,
              model_provider='codex',model_id=?,error_message=NULL,updated_at=?
        WHERE id=? AND user_id=? AND status='processing'`
    ).bind(
      sourceTextKey,
      JSON.stringify(proposal),
      PROFILE_IMPORT_PROPOSAL_SCHEMA_VERSION,
      run.model,
      timestamp,
      request.subjectId,
      runner.user.id
    ),
    env.DB.prepare(
      `UPDATE agent_task_requests
          SET status='completed',result_json=?,error_detail='',completed_at=?,
              updated_at=?
        WHERE id=? AND user_id=? AND runner_id=? AND status='claimed'`
    ).bind(
      JSON.stringify(proposal),
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
      JSON.stringify(proposal),
      timestamp,
      timestamp,
      runId,
      runner.user.id,
      runner.id
    ),
  ]);
  assertAtomicChanges(results, "Profile import task could not be completed");
  return { importId: request.subjectId, requestId: request.id };
}

export async function failProfileImportTask(
  env: AppEnv,
  runner: AgentRunnerContext,
  requestId: string,
  runId: string,
  error: string
) {
  const request = await requireClaimedRequest(env.DB, runner, requestId);
  const timestamp = new Date().toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE profile_imports
          SET status='failed',error_message=?,updated_at=?
        WHERE id=? AND user_id=? AND status='processing'`
    ).bind(error.slice(0, 500), timestamp, request.subjectId, runner.user.id),
    env.DB.prepare(
      `UPDATE agent_task_requests
          SET status='failed',error_detail=?,completed_at=?,updated_at=?
        WHERE id=? AND user_id=? AND runner_id=? AND status='claimed'`
    ).bind(
      error.slice(0, 4000),
      timestamp,
      timestamp,
      request.id,
      runner.user.id,
      runner.id
    ),
    env.DB.prepare(
      `UPDATE agent_task_runs
          SET status='failed',error_detail=?,completed_at=?,updated_at=?
        WHERE id=? AND user_id=? AND runner_id=? AND status='running'`
    ).bind(error, timestamp, timestamp, runId, runner.user.id, runner.id),
  ]);
  assertAtomicChanges(results, "Profile import task could not be failed");
}

function assertAtomicChanges(results: D1Result[], message: string) {
  if (results.some((result) => (result.meta.changes ?? 0) !== 1)) {
    throw new AgentTaskError(message, 409);
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
    throw new AgentTaskError("Agent task request was not found", 404);
  }
  return request;
}

async function readR2Text(bucket: R2Bucket, objectKey: string) {
  const object = await bucket.get(objectKey);
  if (!object) {
    throw new Error("Agent task source document was not found");
  }
  const text = (await object.text()).trim();
  if (text.length < 80 || text.length > 60_000) {
    throw new Error("Agent task source text was outside the accepted size");
  }
  return text;
}
