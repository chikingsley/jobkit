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
} from "../../../src/agent-tasks/job-analysis";
import {
  JOB_POSITION_ANALYSIS_SCHEMA_VERSION,
  JobPositionAnalysisSchema,
} from "../../../src/features/jobs/position-variants";
import { JobMatchFactsSchema } from "../../../src/features/matching/schema";
import { JOB_MATCH_FACTS_SCHEMA_VERSION } from "../../../src/features/matching/version";
import {
  jobFactSource,
  jobSourceHash,
  validateProviderJobMatchFacts,
} from "../../ai/job-fact-extraction";
import { canonicalizeJobPositionEvidence } from "../../ai/job-position-extraction";
import type { AgentRunnerContext } from "../../app-types";
import type { AppEnv } from "../../env";
import { agentRunnerHasCapability } from "../agent-runners";
import { refreshCampaignMatchesForJob } from "../campaign-matching";
import {
  readOwnedJobSource,
  recordJobMatchFacts,
  recordJobPositionAnalysis,
} from "../job-analysis-records";
import { AGENT_TASK_LEASE_MS, type AgentTaskRunRow } from "./contracts";
import {
  completeAgentTaskRun,
  createAgentTaskRun,
  isConstraintError,
} from "./run-store";

const CLAIM_CANDIDATE_LIMIT = 12;
// A malformed model response may be retried, while a consistently invalid
// response must eventually leave a visible terminal failure. This bounds task
// execution attempts only; it does not limit inventory breadth or analysis.
const JOB_ANALYSIS_MAX_ATTEMPTS_PER_VERSION = 3;
const JOB_ANALYSIS_RETRY_GUIDANCE = `

A prior attempt for this exact source and task contract failed deterministic validation. Correct the response instead of repeating it. In particular, copy every evidence value directly from the listing with identical case, punctuation, and spacing. Never paraphrase, repair, or combine source fragments in an evidence field.`;

interface JobAnalysisCandidate extends JobAnalysisTaskSource {
  id: string;
}

export async function claimJobPositionTask(
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

export async function claimJobMatchFactsTask(
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

export async function completeJobPositionTask(
  env: AppEnv,
  runner: AgentRunnerContext,
  run: AgentTaskRunRow,
  runId: string,
  rawOutput: unknown
) {
  const { DB: db } = env;
  const source = await readOwnedJobSource(
    db,
    runner.user.id,
    run.source_task_id
  );
  const analysis = canonicalizeJobPositionEvidence(
    JobPositionAnalysisSchema.parse(rawOutput),
    jobFactSource(source)
  );
  const domainResult = await recordJobPositionAnalysis(db, runner.user.id, {
    analysis,
    jobId: run.source_task_id,
    modelId: run.model,
    provider: "codex",
    sourceHash: run.source_hash,
  });
  await refreshCampaignMatchesForJob(env, runner.user.id, run.source_task_id);
  await completeAgentTaskRun(db, runner.id, runId, analysis);
  return domainResult;
}

export async function completeJobMatchFactsTask(
  env: AppEnv,
  runner: AgentRunnerContext,
  run: AgentTaskRunRow,
  runId: string,
  rawOutput: unknown
) {
  const { DB: db } = env;
  const source = await readOwnedJobSource(
    db,
    runner.user.id,
    run.source_task_id
  );
  const parsed = JobMatchFactsSchema.parse(rawOutput);
  const facts = validateProviderJobMatchFacts(parsed, jobFactSource(source));
  const domainResult = await recordJobMatchFacts(db, runner.user.id, {
    facts,
    jobId: run.source_task_id,
    modelId: run.model,
    provider: "codex",
    sourceHash: run.source_hash,
  });
  await refreshCampaignMatchesForJob(env, runner.user.id, run.source_task_id);
  await completeAgentTaskRun(db, runner.id, runId, facts);
  return domainResult;
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
  const history = await db
    .prepare(
      `SELECT status,error_detail FROM agent_task_runs
        WHERE user_id=? AND task_type=? AND source_task_id=?
          AND prompt_version=? AND source_hash=?
        ORDER BY started_at DESC LIMIT ?`
    )
    .bind(
      runner.user.id,
      task.taskType,
      candidate.id,
      task.promptVersion,
      sourceHash,
      JOB_ANALYSIS_MAX_ATTEMPTS_PER_VERSION
    )
    .all<{ error_detail: string; status: string }>();
  const previous = history.results.at(0);
  if (previous?.status === "completed" || previous?.status === "running") {
    return null;
  }
  if (history.results.length >= JOB_ANALYSIS_MAX_ATTEMPTS_PER_VERSION) {
    return null;
  }
  try {
    return await createAgentTaskRun(db, runner, {
      leaseExpiresAt: new Date(Date.now() + AGENT_TASK_LEASE_MS).toISOString(),
      model: JOB_ANALYSIS_MODEL.model,
      outputSchema: task.outputSchema,
      prompt: previous
        ? `${task.prompt}${JOB_ANALYSIS_RETRY_GUIDANCE}`
        : task.prompt,
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
