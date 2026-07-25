import { z } from "zod";
import {
  PROFILE_IMPORT_MODEL,
  PROFILE_IMPORT_OUTPUT_JSON_SCHEMA,
  PROFILE_IMPORT_PROMPT_VERSION,
  PROFILE_IMPORT_TASK_TYPE,
  profileImportPrompt,
} from "../../../src/agent-tasks/profile-import";
import type { AgentTaskFailureCode } from "../../../src/features/agents/schema";
import {
  PROFILE_IMPORT_PROPOSAL_SCHEMA_VERSION,
  ProfileImportProposalSchema,
} from "../../../src/features/onboarding/schema";
import { normalizeProfileImportProposal } from "../../ai/profile-extraction";
import type { AgentRunnerContext } from "../../app-types";
import type { AppEnv } from "../../env";
import { agentRunnerHasCapability } from "../agent-runners";
import {
  readClaimedAgentTaskRequest,
  readNextAgentTaskRequest,
} from "../agent-task-requests";
import {
  AgentTaskError,
  type AgentTaskRunRow,
  type PreparedAgentTask,
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

const ProfileImportTaskInputSchema = z
  .object({ sourceTextKey: z.string().min(1) })
  .strict();

class UnclaimableProfileImportSourceError extends Error {}

export async function claimProfileImportTask(
  env: AppEnv,
  runner: AgentRunnerContext
): Promise<PreparedAgentTask | null> {
  if (!agentRunnerHasCapability(runner, "extraction")) {
    return null;
  }
  const request = await readNextAgentTaskRequest(env.DB, {
    taskType: PROFILE_IMPORT_TASK_TYPE,
    userId: runner.user.id,
  });
  if (!request) {
    return null;
  }
  const parsed = ProfileImportTaskInputSchema.safeParse(request.input);
  if (!parsed.success) {
    await failUnclaimableProfileImport(
      env.DB,
      runner,
      request.id,
      request.subjectId,
      parsed.error.message
    );
    return null;
  }
  const { sourceTextKey } = parsed.data;
  let sourceText: string;
  try {
    sourceText = await readR2Text(env.DOCUMENTS, sourceTextKey);
  } catch (error) {
    if (!(error instanceof UnclaimableProfileImportSourceError)) {
      throw error;
    }
    await failUnclaimableProfileImport(
      env.DB,
      runner,
      request.id,
      request.subjectId,
      error.message
    );
    return null;
  }
  return claimRequestedAgentTaskWithDomainWrites(
    env.DB,
    runner,
    request,
    {
      model: PROFILE_IMPORT_MODEL.model,
      outputSchema: PROFILE_IMPORT_OUTPUT_JSON_SCHEMA,
      prompt: profileImportPrompt(sourceText),
      promptVersion: PROFILE_IMPORT_PROMPT_VERSION,
      reasoningEffort: PROFILE_IMPORT_MODEL.reasoningEffort,
      sourceHash: await sha256(sourceText),
      taskType: PROFILE_IMPORT_TASK_TYPE,
      webSearch: "disabled",
    },
    (_context, fence) => [
      {
        expectedChanges: 1,
        statement: env.DB.prepare(
          `UPDATE profile_imports
            SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=? AND user_id=? AND status='processing'
            AND ${fence.clause}`
        ).bind(request.subjectId, runner.user.id, ...fence.values),
      },
    ]
  );
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
  await completeRequestedAgentTaskWithDomainWrites(
    env.DB,
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
            SELECT 1 FROM profile_imports completion_import
             WHERE completion_import.id=?
               AND completion_import.user_id=?
               AND completion_import.status='processing'
          )`,
        values: [request.subjectId, runner.user.id],
      },
      result: proposal,
      writes: [
        {
          expectedChanges: 1,
          statement: env.DB.prepare(
            `UPDATE profile_imports
                  SET status='ready',source_text_key=?,proposal_json=?,
                      proposal_schema_version=?,model_provider='codex',model_id=?,
                      error_message=NULL,
                      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
                WHERE id=? AND user_id=? AND status='processing'
                  AND ${fence.clause}`
          ).bind(
            sourceTextKey,
            JSON.stringify(proposal),
            PROFILE_IMPORT_PROPOSAL_SCHEMA_VERSION,
            run.model,
            request.subjectId,
            runner.user.id,
            ...fence.values
          ),
        },
      ],
    })
  );
  return { importId: request.subjectId, requestId: request.id };
}

export async function failProfileImportTask(
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
      buildProfileImportFailureWrites(
        env.DB,
        runner.user.id,
        request.subjectId,
        error,
        retry,
        fence
      )
  );
}

export function buildProfileImportFailureWrites(
  db: D1Database,
  userId: string,
  importId: string,
  error: string,
  retry: boolean,
  fence: AgentTaskCompletionFence
) {
  return [
    {
      expectedChanges: 1,
      statement: db
        .prepare(
          `UPDATE profile_imports
            SET status=?,error_message=?,
                updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=? AND user_id=? AND status='processing'
            AND ${fence.clause}`
        )
        .bind(
          retry ? "processing" : "failed",
          retry ? null : error.slice(0, 500),
          importId,
          userId,
          ...fence.values
        ),
    },
  ];
}

async function failUnclaimableProfileImport(
  db: D1Database,
  runner: AgentRunnerContext,
  requestId: string,
  importId: string,
  error: string
) {
  const statements = [
    db
      .prepare(
        `UPDATE profile_imports SET status='failed',error_message=?,
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND user_id=? AND status='processing'
          AND EXISTS (
            SELECT 1 FROM agent_task_requests request
             WHERE request.id=? AND request.user_id=? AND request.status='queued'
          )`
      )
      .bind(
        error.slice(0, 500),
        importId,
        runner.user.id,
        requestId,
        runner.user.id
      ),
    db.prepare(
      `INSERT INTO transaction_assertions(must_equal_one)
       SELECT 0 WHERE changes()<>1`
    ),
    db
      .prepare(
        `UPDATE agent_task_requests
          SET status='failed',last_error_code='invalid_input',error_detail=?,
              completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND user_id=? AND status='queued'`
      )
      .bind(error.slice(0, 4000), requestId, runner.user.id),
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
    throw new AgentTaskError("Agent task request was not found", 404);
  }
  return request;
}

async function readR2Text(bucket: R2Bucket, objectKey: string) {
  const object = await bucket.get(objectKey);
  if (!object) {
    throw new UnclaimableProfileImportSourceError(
      "Agent task source document was not found"
    );
  }
  const text = (await object.text()).trim();
  if (text.length < 80 || text.length > 60_000) {
    throw new UnclaimableProfileImportSourceError(
      "Agent task source text was outside the accepted size"
    );
  }
  return text;
}
