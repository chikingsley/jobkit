import {
  COUNTRY_SWEEP_OUTPUT_JSON_SCHEMA,
  COUNTRY_SWEEP_PROMPT_VERSION,
  countrySweepModel,
  countrySweepPrompt,
  countrySweepTaskType,
} from "../../src/agent-tasks/country-sweep";
import {
  JOB_ANALYSIS_MODEL,
  JOB_MATCH_FACTS_OUTPUT_JSON_SCHEMA,
  JOB_MATCH_FACTS_PROMPT_VERSION,
  JOB_MATCH_FACTS_TASK_TYPE,
  JOB_POSITION_OUTPUT_JSON_SCHEMA,
  JOB_POSITION_PROMPT_VERSION,
  JOB_POSITION_TASK_TYPE,
  type JobAnalysisTaskSource,
  jobMatchFactsPrompt,
  jobPositionAnalysisPrompt,
} from "../../src/agent-tasks/job-analysis";
import { CountrySweepTaskOutputSchema } from "../../src/features/countries/schema";
import {
  JOB_POSITION_ANALYSIS_SCHEMA_VERSION,
  JobPositionAnalysisSchema,
} from "../../src/features/jobs/position-variants";
import { JobMatchFactsSchema } from "../../src/features/matching/schema";
import { JOB_MATCH_FACTS_SCHEMA_VERSION } from "../../src/features/matching/version";
import {
  jobFactSource,
  jobSourceHash,
  validateProviderJobMatchFacts,
} from "../ai/job-fact-extraction";
import type { AgentRunnerContext } from "../app-types";
import { agentRunnerHasCapability } from "./agent-runners";
import {
  claimCountrySweepTask,
  completeCountrySweepTask,
  failCountrySweepTask,
} from "./country-sweep-tasks";
import {
  readOwnedJobSource,
  recordJobMatchFacts,
  recordJobPositionAnalysis,
} from "./job-analysis-records";

const TASK_LEASE_MS = 30 * 60 * 1000;
const CLAIM_CANDIDATE_LIMIT = 12;

interface AgentTaskRunRow {
  model: string;
  source_hash: string;
  source_task_id: string;
  status: string;
  task_type: string;
}

interface JobAnalysisCandidate extends JobAnalysisTaskSource {
  id: string;
}

interface PreparedAgentTask {
  leaseExpiresAt: string;
  model: string;
  outputSchema: Record<string, unknown>;
  prompt: string;
  promptVersion: string;
  reasoningEffort: "high" | "low" | "medium" | "xhigh";
  runId: string;
  taskType: string;
  webSearch: "disabled" | "live";
}

type TaskFamily = "country_sweep" | "job_match_facts" | "job_position";

export class AgentTaskError extends Error {
  readonly status: 401 | 404 | 409;

  constructor(message: string, status: 401 | 404 | 409) {
    super(message);
    this.status = status;
  }
}

export async function claimAgentTask(
  db: D1Database,
  runner: AgentRunnerContext
) {
  await expireStaleAgentRuns(db, runner.user.id);
  const taskFamilies: Array<{
    claim: () => Promise<PreparedAgentTask | null>;
    family: TaskFamily;
  }> = [
    {
      claim: () => claimCountryTask(db, runner),
      family: "country_sweep",
    },
    {
      claim: () => claimJobPositionTask(db, runner),
      family: "job_position",
    },
    {
      claim: () => claimJobMatchFactsTask(db, runner),
      family: "job_match_facts",
    },
  ];
  const previousFamily = await lastTaskFamily(db, runner.id);
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
    // biome-ignore lint/performance/noAwaitInLoops: Claims must run serially so one poll cannot lease multiple tasks.
    const task = await adapter.claim();
    if (task) {
      return task;
    }
  }
  return null;
}

export async function completeAgentTask(
  db: D1Database,
  runner: AgentRunnerContext,
  runId: string,
  rawOutput: unknown
) {
  const run = await readOwnedRunningTask(db, runner, runId);
  let domainResult: unknown;
  if (run.task_type.startsWith("country_sweep.")) {
    const output = CountrySweepTaskOutputSchema.parse(rawOutput);
    domainResult = await completeCountrySweepTask(
      db,
      runner.user.id,
      run.source_task_id,
      runner.id,
      output
    );
    await completeRun(db, runner.id, runId, output);
  } else if (run.task_type === JOB_POSITION_TASK_TYPE) {
    const analysis = JobPositionAnalysisSchema.parse(rawOutput);
    domainResult = await recordJobPositionAnalysis(db, runner.user.id, {
      analysis,
      jobId: run.source_task_id,
      modelId: run.model,
      provider: "codex",
      sourceHash: run.source_hash,
    });
    await completeRun(db, runner.id, runId, analysis);
  } else if (run.task_type === JOB_MATCH_FACTS_TASK_TYPE) {
    const source = await readOwnedJobSource(
      db,
      runner.user.id,
      run.source_task_id
    );
    const parsed = JobMatchFactsSchema.parse(rawOutput);
    const facts = validateProviderJobMatchFacts(parsed, jobFactSource(source));
    domainResult = await recordJobMatchFacts(db, runner.user.id, {
      facts,
      jobId: run.source_task_id,
      modelId: run.model,
      provider: "codex",
      sourceHash: run.source_hash,
    });
    await completeRun(db, runner.id, runId, facts);
  } else {
    throw new AgentTaskError("Agent task type is not supported", 409);
  }
  return { domainResult, runId };
}

export async function failAgentTask(
  db: D1Database,
  runner: AgentRunnerContext,
  runId: string,
  error: string
) {
  const run = await readOwnedRunningTask(db, runner, runId);
  let domainResult: unknown = null;
  if (run.task_type.startsWith("country_sweep.")) {
    domainResult = await failCountrySweepTask(
      db,
      runner.user.id,
      run.source_task_id,
      runner.id,
      error
    );
  } else if (
    run.task_type !== JOB_POSITION_TASK_TYPE &&
    run.task_type !== JOB_MATCH_FACTS_TASK_TYPE
  ) {
    throw new AgentTaskError("Agent task type is not supported", 409);
  }
  await failRun(db, runner.id, runId, error);
  return { domainResult, runId };
}

async function claimCountryTask(
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
  return createRun(db, runner, {
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

async function claimJobPositionTask(
  db: D1Database,
  runner: AgentRunnerContext
) {
  if (!agentRunnerHasCapability(runner, "extraction")) {
    return null;
  }
  const candidates = await db
    .prepare(
      `SELECT j.id,j.title,j.salary,j.description
         FROM user_jobs uj
         JOIN jobs j ON j.id=uj.job_id
         LEFT JOIN job_position_analyses pa ON pa.job_id=j.id
        WHERE uj.user_id=?
          AND j.board<>'jobkit-e2e'
          AND (pa.job_id IS NULL OR pa.schema_version<>? OR pa.updated_at<j.updated_at)
        ORDER BY uj.priority DESC,uj.updated_at DESC
        LIMIT ?`
    )
    .bind(
      runner.user.id,
      JOB_POSITION_ANALYSIS_SCHEMA_VERSION,
      CLAIM_CANDIDATE_LIMIT
    )
    .all<JobAnalysisCandidate>();
  for (const candidate of candidates.results) {
    // biome-ignore lint/performance/noAwaitInLoops: Each source hash gates a single atomic task claim.
    const claimed = await claimJobCandidate(db, runner, candidate, {
      outputSchema: JOB_POSITION_OUTPUT_JSON_SCHEMA,
      prompt: jobPositionAnalysisPrompt(candidate),
      promptVersion: JOB_POSITION_PROMPT_VERSION,
      taskType: JOB_POSITION_TASK_TYPE,
    });
    if (claimed) {
      return claimed;
    }
  }
  return null;
}

async function claimJobMatchFactsTask(
  db: D1Database,
  runner: AgentRunnerContext
) {
  if (!agentRunnerHasCapability(runner, "extraction")) {
    return null;
  }
  const candidates = await db
    .prepare(
      `SELECT j.id,j.title,j.salary,j.description
         FROM user_jobs uj
         JOIN jobs j ON j.id=uj.job_id
         LEFT JOIN job_match_facts mf ON mf.job_id=j.id
        WHERE uj.user_id=?
          AND j.board<>'jobkit-e2e'
          AND (mf.job_id IS NULL OR mf.schema_version<>? OR mf.updated_at<j.updated_at)
        ORDER BY uj.priority DESC,uj.updated_at DESC
        LIMIT ?`
    )
    .bind(runner.user.id, JOB_MATCH_FACTS_SCHEMA_VERSION, CLAIM_CANDIDATE_LIMIT)
    .all<JobAnalysisCandidate>();
  for (const candidate of candidates.results) {
    // biome-ignore lint/performance/noAwaitInLoops: Each source hash gates a single atomic task claim.
    const claimed = await claimJobCandidate(db, runner, candidate, {
      outputSchema: JOB_MATCH_FACTS_OUTPUT_JSON_SCHEMA,
      prompt: jobMatchFactsPrompt(candidate),
      promptVersion: JOB_MATCH_FACTS_PROMPT_VERSION,
      taskType: JOB_MATCH_FACTS_TASK_TYPE,
    });
    if (claimed) {
      return claimed;
    }
  }
  return null;
}

async function claimJobCandidate(
  db: D1Database,
  runner: AgentRunnerContext,
  candidate: JobAnalysisCandidate,
  task: {
    outputSchema: Record<string, unknown>;
    prompt: string;
    promptVersion: string;
    taskType: string;
  }
) {
  const sourceHash = await jobSourceHash(candidate);
  const previous = await db
    .prepare(
      `SELECT status,error_detail FROM agent_task_runs
        WHERE user_id=? AND task_type=? AND source_task_id=?
          AND prompt_version=? AND source_hash=?
        ORDER BY started_at DESC LIMIT 1`
    )
    .bind(
      runner.user.id,
      task.taskType,
      candidate.id,
      task.promptVersion,
      sourceHash
    )
    .first<{ error_detail: string; status: string }>();
  if (
    previous &&
    previous.status !== "running" &&
    previous.error_detail !== "Runner lease expired"
  ) {
    return null;
  }
  try {
    return await createRun(db, runner, {
      leaseExpiresAt: new Date(Date.now() + TASK_LEASE_MS).toISOString(),
      model: JOB_ANALYSIS_MODEL.model,
      outputSchema: task.outputSchema,
      prompt: task.prompt,
      promptVersion: task.promptVersion,
      reasoningEffort: JOB_ANALYSIS_MODEL.reasoningEffort,
      sourceHash,
      sourceTaskId: candidate.id,
      taskType: task.taskType,
      webSearch: "disabled",
    });
  } catch (error) {
    if (isConstraintError(error)) {
      return null;
    }
    throw error;
  }
}

async function createRun(
  db: D1Database,
  runner: AgentRunnerContext,
  task: Omit<PreparedAgentTask, "runId"> & {
    sourceHash: string;
    sourceTaskId: string;
  }
) {
  const runId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO agent_task_runs
        (id,user_id,runner_id,task_type,source_task_id,prompt_version,model,
         reasoning_effort,source_hash,prompt_hash,status,started_at,
         lease_expires_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,'running',?,?,?)`
    )
    .bind(
      runId,
      runner.user.id,
      runner.id,
      task.taskType,
      task.sourceTaskId,
      task.promptVersion,
      task.model,
      task.reasoningEffort,
      task.sourceHash,
      await sha256(task.prompt),
      timestamp,
      task.leaseExpiresAt,
      timestamp
    )
    .run();
  return {
    leaseExpiresAt: task.leaseExpiresAt,
    model: task.model,
    outputSchema: task.outputSchema,
    prompt: task.prompt,
    promptVersion: task.promptVersion,
    reasoningEffort: task.reasoningEffort,
    runId,
    taskType: task.taskType,
    webSearch: task.webSearch,
  };
}

async function completeRun(
  db: D1Database,
  runnerId: string,
  runId: string,
  output: unknown
) {
  const timestamp = new Date().toISOString();
  await db
    .prepare(
      `UPDATE agent_task_runs
          SET status='completed',result_json=?,completed_at=?,updated_at=?
        WHERE id=? AND runner_id=? AND status='running'`
    )
    .bind(JSON.stringify(output), timestamp, timestamp, runId, runnerId)
    .run();
}

async function failRun(
  db: D1Database,
  runnerId: string,
  runId: string,
  error: string
) {
  const timestamp = new Date().toISOString();
  await db
    .prepare(
      `UPDATE agent_task_runs
          SET status='failed',error_detail=?,completed_at=?,updated_at=?
        WHERE id=? AND runner_id=? AND status='running'`
    )
    .bind(error, timestamp, timestamp, runId, runnerId)
    .run();
}

async function expireStaleAgentRuns(db: D1Database, userId: string) {
  const timestamp = new Date().toISOString();
  await db
    .prepare(
      `UPDATE agent_task_runs
          SET status='failed',error_detail='Runner lease expired',
              completed_at=?,updated_at=?
        WHERE user_id=? AND status='running' AND lease_expires_at<?`
    )
    .bind(timestamp, timestamp, userId, timestamp)
    .run();
}

async function lastTaskFamily(db: D1Database, runnerId: string) {
  const latest = await db
    .prepare(
      `SELECT task_type FROM agent_task_runs
        WHERE runner_id=? ORDER BY started_at DESC LIMIT 1`
    )
    .bind(runnerId)
    .first<{ task_type: string }>();
  const taskType = latest?.task_type ?? "";
  if (taskType.startsWith("country_sweep.")) {
    return "country_sweep";
  }
  if (taskType === JOB_POSITION_TASK_TYPE) {
    return "job_position";
  }
  if (taskType === JOB_MATCH_FACTS_TASK_TYPE) {
    return "job_match_facts";
  }
  return null;
}

async function readOwnedRunningTask(
  db: D1Database,
  runner: AgentRunnerContext,
  runId: string
) {
  const run = await db
    .prepare(
      `SELECT task_type,source_task_id,source_hash,model,status
         FROM agent_task_runs
        WHERE id=? AND user_id=? AND runner_id=?`
    )
    .bind(runId, runner.user.id, runner.id)
    .first<AgentTaskRunRow>();
  if (!run) {
    throw new AgentTaskError("Agent task run was not found", 404);
  }
  if (run.status !== "running") {
    throw new AgentTaskError(`Agent task is already ${run.status}`, 409);
  }
  return run;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function isConstraintError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.toLocaleLowerCase("en").includes("constraint")
  );
}
