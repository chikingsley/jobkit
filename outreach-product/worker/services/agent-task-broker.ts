import {
  APPLICATION_MESSAGE_TASK_TYPE,
  ApplicationMessageRequestInputSchema,
} from "../../src/agent-tasks/application-message";
import {
  JOB_CONTENT_TASK_TYPE,
  JOB_MATCH_FACTS_TASK_TYPE,
  JOB_POSITION_TASK_TYPE,
} from "../../src/agent-tasks/job-analysis";
import { PROFILE_IMPORT_TASK_TYPE } from "../../src/agent-tasks/profile-import";
import {
  TEST_LAB_DOCUMENT_OCR_TASK_TYPE,
  TEST_LAB_TASK_TYPE,
} from "../../src/agent-tasks/test-lab";
import type { AgentTaskFailureCode } from "../../src/features/agents/schema";
import type { AgentRunnerContext } from "../app-types";
import type { AppEnv } from "../env";
import {
  buildApplicationMessageFailureWrites,
  claimApplicationMessageTask,
  completeApplicationMessageTask,
  failApplicationMessageTask,
} from "./agent-tasks/application-message-adapter";
import {
  AgentTaskClaimLostError,
  AgentTaskError,
  type AgentTaskFamily,
  type PreparedAgentTask,
} from "./agent-tasks/contracts";
import {
  claimCountryTask,
  completeCountryTask,
  failCountryTask,
  uploadCountryTaskChunk,
} from "./agent-tasks/country-sweep-adapter";
import {
  expireCountrySweepAgentTasks,
  heartbeatCountrySweepAgentTask,
  readCountryTaskLeaseContext,
} from "./agent-tasks/country-sweep-leases";
import {
  claimJobContentTask,
  claimJobMatchFactsTask,
  claimJobPositionTask,
  completeJobContentTask,
  completeJobMatchFactsTask,
  completeJobPositionTask,
} from "./agent-tasks/job-analysis-adapter";
import {
  buildProfileImportFailureWrites,
  claimProfileImportTask,
  completeProfileImportTask,
  failProfileImportTask,
} from "./agent-tasks/profile-import-adapter";
import {
  type ActiveRequestedPairRow,
  expireRequestedAgentTasks,
  heartbeatRequestedAgentTask,
} from "./agent-tasks/requested-task-leases";
import {
  type AgentTaskCompletionFence,
  failAgentTaskRun,
  readLastAgentTaskType,
  readOwnedRunningAgentTask,
} from "./agent-tasks/run-store";
import {
  buildTestLabFailureWrites,
  claimTestLabTask,
  completeTestLabTask,
  failTestLabTask,
} from "./agent-tasks/test-lab-adapter";

export async function claimAgentTask(env: AppEnv, runner: AgentRunnerContext) {
  const taskFamilies: Array<{
    claim: () => Promise<PreparedAgentTask | null>;
    family: AgentTaskFamily;
  }> = [
    {
      claim: () => claimProfileImportTask(env, runner),
      family: "profile_import",
    },
    {
      claim: () => claimApplicationMessageTask(env, runner),
      family: "application_message",
    },
    {
      claim: () => claimTestLabTask(env, runner),
      family: "test_lab",
    },
    {
      claim: () => claimCountryTask(env.DB, runner),
      family: "country_sweep",
    },
    {
      claim: () => claimJobPositionTask(env.DB, runner),
      family: "job_position",
    },
    {
      claim: () => claimJobMatchFactsTask(env.DB, runner),
      family: "job_match_facts",
    },
    {
      claim: () => claimJobContentTask(env.DB, runner),
      family: "job_content",
    },
  ];
  const previousTaskType = await readLastAgentTaskType(env.DB, runner.id);
  const previousFamily = taskFamilyForType(previousTaskType);
  const previousIndex = taskFamilies.findIndex(
    ({ family }) => family === previousFamily
  );
  const startIndex =
    previousIndex < 0 ? 0 : (previousIndex + 1) % taskFamilies.length;

  for (let offset = 0; offset < taskFamilies.length; offset += 1) {
    const adapter = taskFamilies[(startIndex + offset) % taskFamilies.length];
    if (!adapter) {
      continue;
    }
    let task: PreparedAgentTask | null;
    try {
      // biome-ignore lint/performance/noAwaitInLoops: One poll must lease at most one task across ordered families.
      task = await adapter.claim();
    } catch (error) {
      if (error instanceof AgentTaskClaimLostError) {
        return null;
      }
      throw error;
    }
    if (task) {
      return task;
    }
  }
  return null;
}

export async function reapAgentTasks(
  env: AppEnv,
  userId: string | null = null
) {
  const requested = await expireRequestedAgentTasks(
    env.DB,
    userId,
    (pair, retry, fence, errorDetail) =>
      requestedFailureWrites(env.DB, pair, retry, fence, errorDetail)
  );
  const country = await expireCountrySweepAgentTasks(env.DB, userId);
  await expireAutonomousRuns(env.DB, userId);
  return {
    processed: requested.processed + country.processed,
    selected: requested.selected + country.selected,
  };
}

export async function completeAgentTask(
  env: AppEnv,
  runner: AgentRunnerContext,
  runId: string,
  rawOutput: unknown,
  leaseToken: string
) {
  const run = await readOwnedRunningAgentTask(env.DB, runner, runId);
  assertLeaseToken(run.lease_token, leaseToken);
  let domainResult: unknown;
  if (run.task_type === PROFILE_IMPORT_TASK_TYPE) {
    domainResult = await completeProfileImportTask(
      env,
      runner,
      run,
      runId,
      rawOutput
    );
  } else if (run.task_type === APPLICATION_MESSAGE_TASK_TYPE) {
    domainResult = await completeApplicationMessageTask(
      env,
      runner,
      run,
      runId,
      rawOutput
    );
  } else if (run.task_type.startsWith("country_sweep.")) {
    domainResult = await completeCountryTask(
      env,
      runner,
      run,
      runId,
      rawOutput
    );
  } else if (run.task_type === JOB_POSITION_TASK_TYPE) {
    domainResult = await completeJobPositionTask(
      env,
      runner,
      run,
      runId,
      rawOutput
    );
  } else if (run.task_type === JOB_MATCH_FACTS_TASK_TYPE) {
    domainResult = await completeJobMatchFactsTask(
      env,
      runner,
      run,
      runId,
      rawOutput
    );
  } else if (run.task_type === JOB_CONTENT_TASK_TYPE) {
    domainResult = await completeJobContentTask(
      env,
      runner,
      run,
      runId,
      rawOutput
    );
  } else if (
    run.task_type === TEST_LAB_TASK_TYPE ||
    run.task_type === TEST_LAB_DOCUMENT_OCR_TASK_TYPE
  ) {
    domainResult = await completeTestLabTask(
      env,
      runner,
      run,
      runId,
      rawOutput
    );
  } else {
    throw new AgentTaskError("Agent task type is not supported", 409);
  }
  return { domainResult, runId };
}

export async function uploadAgentTaskCountryChunk(
  env: AppEnv,
  runner: AgentRunnerContext,
  runId: string,
  rawInput: unknown,
  leaseToken: string
) {
  const run = await readOwnedRunningAgentTask(env.DB, runner, runId);
  assertLeaseToken(run.lease_token, leaseToken);
  if (!run.task_type.startsWith("country_sweep.")) {
    throw new AgentTaskError("Agent task does not accept country chunks", 409);
  }
  return uploadCountryTaskChunk(env, runner, run, runId, rawInput);
}

export async function failAgentTask(
  env: AppEnv,
  runner: AgentRunnerContext,
  runId: string,
  error: string,
  errorCode: AgentTaskFailureCode,
  leaseToken: string
) {
  const run = await readOwnedRunningAgentTask(env.DB, runner, runId);
  assertLeaseToken(run.lease_token, leaseToken);
  let domainResult: unknown = null;
  if (run.task_type === PROFILE_IMPORT_TASK_TYPE) {
    await failProfileImportTask(
      env,
      runner,
      run.source_task_id,
      runId,
      error,
      errorCode
    );
    return { domainResult, runId };
  }
  if (run.task_type === APPLICATION_MESSAGE_TASK_TYPE) {
    await failApplicationMessageTask(
      env,
      runner,
      run.source_task_id,
      runId,
      error,
      errorCode
    );
    return { domainResult, runId };
  }
  if (run.task_type.startsWith("country_sweep.")) {
    domainResult = await failCountryTask(
      env.DB,
      runner,
      run,
      runId,
      error,
      errorCode
    );
    return { domainResult, runId };
  }
  if (
    run.task_type === TEST_LAB_TASK_TYPE ||
    run.task_type === TEST_LAB_DOCUMENT_OCR_TASK_TYPE
  ) {
    await failTestLabTask(
      env,
      runner,
      run.source_task_id,
      runId,
      error,
      errorCode
    );
    return { domainResult, runId };
  }
  if (
    run.task_type !== JOB_POSITION_TASK_TYPE &&
    run.task_type !== JOB_MATCH_FACTS_TASK_TYPE &&
    run.task_type !== JOB_CONTENT_TASK_TYPE
  ) {
    throw new AgentTaskError("Agent task type is not supported", 409);
  }
  await failAgentTaskRun(env.DB, runner.id, runId, error);
  return { domainResult, runId };
}

export async function heartbeatAgentTask(
  env: AppEnv,
  runner: AgentRunnerContext,
  runId: string,
  leaseToken: string
) {
  const run = await readOwnedRunningAgentTask(env.DB, runner, runId);
  assertLeaseToken(run.lease_token, leaseToken);
  const request = await env.DB.prepare(
    `SELECT id,attempt_count,lease_token,task_type
       FROM agent_task_requests
      WHERE id=? AND user_id=? AND runner_id=? AND status='claimed'`
  )
    .bind(run.source_task_id, runner.user.id, runner.id)
    .first<{
      attempt_count: number;
      id: string;
      lease_token: string;
      task_type: string;
    }>();
  if (request) {
    return heartbeatRequestedAgentTask(env.DB, {
      attemptNumber: request.attempt_count,
      leaseToken: request.lease_token,
      requestId: request.id,
      runId,
      runnerId: runner.id,
      taskType: request.task_type,
      userId: runner.user.id,
    });
  }
  if (run.task_type.startsWith("country_sweep.")) {
    return heartbeatCountrySweepAgentTask(
      env.DB,
      await readCountryTaskLeaseContext(env.DB, runner, run, runId)
    );
  }
  const result = await env.DB.prepare(
    `UPDATE agent_task_runs
        SET lease_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+30 minutes'),
            updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id=? AND user_id=? AND runner_id=? AND status='running'
        AND attempt_number=? AND lease_token=?
        AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
        AND EXISTS (
          SELECT 1 FROM agent_runners heartbeat_runner
           WHERE heartbeat_runner.id=agent_task_runs.runner_id
             AND heartbeat_runner.user_id=agent_task_runs.user_id
             AND heartbeat_runner.revoked_at IS NULL
        )
    RETURNING lease_expires_at`
  )
    .bind(runId, runner.user.id, runner.id, run.attempt_number, run.lease_token)
    .first<{ lease_expires_at: string }>();
  if (!result) {
    throw new AgentTaskError("Agent task lease changed before heartbeat", 409);
  }
  return { leaseExpiresAt: result.lease_expires_at };
}

function requestedFailureWrites(
  db: D1Database,
  pair: ActiveRequestedPairRow,
  retry: boolean,
  fence: AgentTaskCompletionFence,
  errorDetail: string
) {
  if (pair.task_type === PROFILE_IMPORT_TASK_TYPE) {
    return buildProfileImportFailureWrites(
      db,
      pair.user_id,
      pair.subject_id,
      errorDetail,
      retry,
      fence
    );
  }
  if (pair.task_type === APPLICATION_MESSAGE_TASK_TYPE) {
    const input = ApplicationMessageRequestInputSchema.parse(
      JSON.parse(pair.input_json) as unknown
    );
    return buildApplicationMessageFailureWrites(
      db,
      pair.user_id,
      input,
      errorDetail,
      retry,
      fence
    );
  }
  if (
    pair.task_type === TEST_LAB_TASK_TYPE ||
    pair.task_type === TEST_LAB_DOCUMENT_OCR_TASK_TYPE
  ) {
    return buildTestLabFailureWrites(
      db,
      pair.user_id,
      pair.id,
      pair.subject_id,
      errorDetail,
      retry,
      fence
    );
  }
  throw new AgentTaskError("Agent task type is not supported", 409);
}

async function expireAutonomousRuns(db: D1Database, userId: string | null) {
  await db
    .prepare(
      `UPDATE agent_task_runs
        SET status='failed',
            error_code=CASE WHEN EXISTS (
              SELECT 1 FROM agent_runners revoked_runner
               WHERE revoked_runner.id=agent_task_runs.runner_id
                 AND revoked_runner.user_id=agent_task_runs.user_id
                 AND revoked_runner.revoked_at IS NOT NULL
            ) THEN 'runner_revoked' ELSE 'lease_expired' END,
            error_detail=CASE WHEN EXISTS (
              SELECT 1 FROM agent_runners revoked_runner
               WHERE revoked_runner.id=agent_task_runs.runner_id
                 AND revoked_runner.user_id=agent_task_runs.user_id
                 AND revoked_runner.revoked_at IS NOT NULL
            ) THEN 'Runner revoked' ELSE 'Runner lease expired' END,
            completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
            updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE (? IS NULL OR user_id=?) AND status='running'
        AND task_type NOT LIKE 'country_sweep.%'
        AND (
          lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          OR EXISTS (
            SELECT 1 FROM agent_runners autonomous_runner
             WHERE autonomous_runner.id=agent_task_runs.runner_id
               AND autonomous_runner.user_id=agent_task_runs.user_id
               AND autonomous_runner.revoked_at IS NOT NULL
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM agent_task_requests request
           WHERE request.id=agent_task_runs.source_task_id
             AND request.user_id=agent_task_runs.user_id
        )`
    )
    .bind(userId, userId)
    .run();
}

function assertLeaseToken(expected: string, supplied: string) {
  if (supplied !== expected) {
    throw new AgentTaskError("Agent task lease token does not match", 409);
  }
}

function taskFamilyForType(taskType: string | null): AgentTaskFamily | null {
  if (taskType === APPLICATION_MESSAGE_TASK_TYPE) {
    return "application_message";
  }
  if (taskType?.startsWith("country_sweep.")) {
    return "country_sweep";
  }
  if (taskType === JOB_POSITION_TASK_TYPE) {
    return "job_position";
  }
  if (taskType === JOB_MATCH_FACTS_TASK_TYPE) {
    return "job_match_facts";
  }
  if (taskType === JOB_CONTENT_TASK_TYPE) {
    return "job_content";
  }
  if (taskType === PROFILE_IMPORT_TASK_TYPE) {
    return "profile_import";
  }
  if (
    taskType === TEST_LAB_TASK_TYPE ||
    taskType === TEST_LAB_DOCUMENT_OCR_TASK_TYPE
  ) {
    return "test_lab";
  }
  return null;
}
