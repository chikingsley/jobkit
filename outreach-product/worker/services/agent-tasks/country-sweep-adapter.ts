import {
  COUNTRY_SWEEP_OUTPUT_JSON_SCHEMA,
  COUNTRY_SWEEP_PROMPT_VERSION,
  countrySweepModel,
  countrySweepPrompt,
  countrySweepTaskType,
} from "../../../src/agent-tasks/country-sweep";
import { CountrySweepTaskOutputSchema } from "../../../src/features/countries/schema";
import type { AgentRunnerContext } from "../../app-types";
import { agentRunnerHasCapability } from "../agent-runners";
import {
  claimCountrySweepTask,
  completeCountrySweepTask,
  failCountrySweepTask,
} from "../country-sweep-tasks";
import type { AgentTaskRunRow, PreparedAgentTask } from "./contracts";
import { completeAgentTaskRun, createAgentTaskRun, sha256 } from "./run-store";

export async function claimCountryTask(
  db: D1Database,
  runner: AgentRunnerContext
): Promise<PreparedAgentTask | null> {
  if (!agentRunnerHasCapability(runner, "research")) {
    return null;
  }
  const task = await claimCountrySweepTask(db, runner.user.id, runner.id);
  if (!task) {
    return null;
  }
  const { model, reasoningEffort } = countrySweepModel(task.phase);
  const prompt = countrySweepPrompt({
    countryCode: task.countryCode,
    countryName: task.countryName,
    input: task.input,
    phase: task.phase,
    scopeKey: task.scopeKey,
  });
  return createAgentTaskRun(db, runner, {
    leaseExpiresAt: task.leaseExpiresAt,
    model,
    outputSchema: COUNTRY_SWEEP_OUTPUT_JSON_SCHEMA,
    prompt,
    promptVersion: COUNTRY_SWEEP_PROMPT_VERSION,
    reasoningEffort,
    sourceHash: await sha256(JSON.stringify(task.input)),
    sourceTaskId: task.id,
    taskType: countrySweepTaskType(task.phase),
    webSearch: "live",
  });
}

export async function completeCountryTask(
  db: D1Database,
  runner: AgentRunnerContext,
  run: AgentTaskRunRow,
  runId: string,
  rawOutput: unknown
) {
  const output = CountrySweepTaskOutputSchema.parse(rawOutput);
  const domainResult = await completeCountrySweepTask(
    db,
    runner.user.id,
    run.source_task_id,
    runner.id,
    output
  );
  await completeAgentTaskRun(db, runner.id, runId, output);
  return domainResult;
}

export function failCountryTask(
  db: D1Database,
  runner: AgentRunnerContext,
  run: AgentTaskRunRow,
  error: string
) {
  return failCountrySweepTask(
    db,
    runner.user.id,
    run.source_task_id,
    runner.id,
    error
  );
}
