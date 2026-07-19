import { APPLICATION_MESSAGE_TASK_TYPE } from "../../src/agent-tasks/application-message";
import {
  JOB_MATCH_FACTS_TASK_TYPE,
  JOB_POSITION_TASK_TYPE,
} from "../../src/agent-tasks/job-analysis";
import { PROFILE_IMPORT_TASK_TYPE } from "../../src/agent-tasks/profile-import";
import {
  TEST_LAB_DOCUMENT_OCR_TASK_TYPE,
  TEST_LAB_TASK_TYPE,
} from "../../src/agent-tasks/test-lab";
import type { AgentRunnerContext } from "../app-types";
import type { AppEnv } from "../env";
import {
  claimApplicationMessageTask,
  completeApplicationMessageTask,
  failApplicationMessageTask,
} from "./agent-tasks/application-message-adapter";
import {
  AgentTaskError,
  type AgentTaskFamily,
  type PreparedAgentTask,
} from "./agent-tasks/contracts";
import {
  claimCountryTask,
  completeCountryTask,
  failCountryTask,
} from "./agent-tasks/country-sweep-adapter";
import {
  claimJobMatchFactsTask,
  claimJobPositionTask,
  completeJobMatchFactsTask,
  completeJobPositionTask,
} from "./agent-tasks/job-analysis-adapter";
import {
  claimProfileImportTask,
  completeProfileImportTask,
  failProfileImportTask,
} from "./agent-tasks/profile-import-adapter";
import {
  expireStaleAgentTaskRuns,
  failAgentTaskRun,
  readLastAgentTaskType,
  readOwnedRunningAgentTask,
} from "./agent-tasks/run-store";
import {
  claimTestLabTask,
  completeTestLabTask,
  failTestLabTask,
} from "./agent-tasks/test-lab-adapter";

export async function claimAgentTask(env: AppEnv, runner: AgentRunnerContext) {
  await expireStaleAgentTaskRuns(env.DB, runner.user.id);
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
    // biome-ignore lint/performance/noAwaitInLoops: One poll must lease at most one task across ordered families.
    const task = await adapter.claim();
    if (task) {
      return task;
    }
  }
  return null;
}

export async function completeAgentTask(
  env: AppEnv,
  runner: AgentRunnerContext,
  runId: string,
  rawOutput: unknown
) {
  const run = await readOwnedRunningAgentTask(env.DB, runner, runId);
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
      env.DB,
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

export async function failAgentTask(
  env: AppEnv,
  runner: AgentRunnerContext,
  runId: string,
  error: string
) {
  const run = await readOwnedRunningAgentTask(env.DB, runner, runId);
  let domainResult: unknown = null;
  if (run.task_type === PROFILE_IMPORT_TASK_TYPE) {
    await failProfileImportTask(env, runner, run.source_task_id, runId, error);
    return { domainResult, runId };
  }
  if (run.task_type === APPLICATION_MESSAGE_TASK_TYPE) {
    await failApplicationMessageTask(
      env,
      runner,
      run.source_task_id,
      runId,
      error
    );
    return { domainResult, runId };
  }
  if (run.task_type.startsWith("country_sweep.")) {
    domainResult = await failCountryTask(env.DB, runner, run, error);
  } else if (
    run.task_type === TEST_LAB_TASK_TYPE ||
    run.task_type === TEST_LAB_DOCUMENT_OCR_TASK_TYPE
  ) {
    await failTestLabTask(env, runner, run.source_task_id, runId, error);
    return { domainResult, runId };
  } else if (
    run.task_type !== JOB_POSITION_TASK_TYPE &&
    run.task_type !== JOB_MATCH_FACTS_TASK_TYPE
  ) {
    throw new AgentTaskError("Agent task type is not supported", 409);
  }
  await failAgentTaskRun(env.DB, runner.id, runId, error);
  return { domainResult, runId };
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
