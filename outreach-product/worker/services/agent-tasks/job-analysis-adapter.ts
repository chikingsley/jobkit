import {
  JOB_CONTENT_OUTPUT_JSON_SCHEMA,
  JOB_CONTENT_PROMPT_VERSION,
  JOB_CONTENT_TASK_TYPE,
  JOB_MATCH_FACTS_OUTPUT_JSON_SCHEMA,
  JOB_MATCH_FACTS_PROMPT_VERSION,
  JOB_MATCH_FACTS_TASK_TYPE,
  JOB_POSITION_OUTPUT_JSON_SCHEMA,
  JOB_POSITION_PROMPT_VERSION,
  JOB_POSITION_TASK_TYPE,
  type JobAnalysisTaskSource,
  type JobAnalysisTaskType,
  jobAnalysisModel,
  jobContentAnalysisPrompt,
  jobMatchFactsPrompt,
  jobPositionAnalysisPrompt,
} from "../../../src/agent-tasks/job-analysis";
import {
  JOB_CONTENT_ANALYSIS_SCHEMA_VERSION,
  JobContentAnalysisSchema,
} from "../../../src/features/jobs/content-analysis";
import {
  JOB_POSITION_ANALYSIS_SCHEMA_VERSION,
  JobPositionAnalysisSchema,
} from "../../../src/features/jobs/position-variants";
import { JobMatchFactsSchema } from "../../../src/features/matching/schema";
import { JOB_MATCH_FACTS_SCHEMA_VERSION } from "../../../src/features/matching/version";
import {
  canonicalizeJobContentEvidence,
  unsupportedContentEvidence,
} from "../../ai/job-content-extraction";
import {
  jobFactSource,
  jobSourceHash,
  unsupportedEvidence,
  validateProviderJobMatchFacts,
} from "../../ai/job-fact-extraction";
import {
  canonicalizeJobPositionEvidence,
  unsupportedPositionEvidence,
} from "../../ai/job-position-extraction";
import type { AgentRunnerContext } from "../../app-types";
import type { AppEnv } from "../../env";
import { agentRunnerHasCapability } from "../agent-runners";
import { refreshCampaignMatchesForJob } from "../campaign-matching";
import {
  JobAnalysisRecordError,
  jobContentAnalysisStatement,
  jobMatchFactsStatements,
  jobPositionAnalysisStatements,
  readJobListingSource,
} from "../job-analysis-records";
import { AGENT_TASK_LEASE_MS, type AgentTaskRunRow } from "./contracts";
import {
  completeAgentTaskRunWithDomainWrites,
  createAgentTaskRun,
  isConstraintError,
} from "./run-store";

// Polling returns at most one task. Two candidates keep each autonomous
// analysis-family race bounded; request-backed claim races stop broker traversal,
// and lease reaping runs through scheduled maintenance instead of this route.
const CLAIM_CANDIDATE_LIMIT = 2;
// A malformed model response may be retried, while a consistently invalid
// response must eventually leave a visible terminal failure. This bounds task
// execution attempts only; it does not limit inventory breadth or analysis.
const JOB_ANALYSIS_MAX_ATTEMPTS_PER_VERSION = 3;
const JOB_ANALYSIS_RETRY_GUIDANCE = `

A prior attempt for this exact source and task contract failed deterministic validation. Correct the response instead of repeating it. In particular, copy every evidence value directly from the listing with identical case, punctuation, and spacing. Never paraphrase, repair, or combine source fragments in an evidence field.`;

interface JobAnalysisCandidate extends JobAnalysisTaskSource {
  analysis_schema_version: number | null;
  analysis_source_hash: string | null;
  id: string;
}

export async function claimJobPositionTask(
  db: D1Database,
  runner: AgentRunnerContext
) {
  if (
    runner.user.role !== "operator" ||
    !agentRunnerHasCapability(runner, "extraction")
  ) {
    return null;
  }
  const candidates = await db
    .prepare(
      `WITH projection_waiters AS (
         SELECT DISTINCT projection.listing_id
           FROM public_projection_listing_items projection
           JOIN public_projection_runs run ON run.id=projection.run_id
          WHERE run.status='running'
            AND projection.status='waiting_analysis'
            AND COALESCE(json_extract(
              projection.checkpoint_json,'$.analyses.position.status'
            ),'')<>'current'
            AND NOT EXISTS (
              SELECT 1 FROM agent_task_runs task
               WHERE task.task_type=? AND task.prompt_version=?
                 AND task.source_task_id=projection.listing_id
                 AND task.source_hash=json_extract(
                   projection.checkpoint_json,
                   '$.analyses.position.expectedSourceHash'
                 )
                 AND task.status IN ('running','completed')
            )
            AND (
              SELECT COUNT(*) FROM agent_task_runs task
               WHERE task.task_type=? AND task.prompt_version=?
                 AND task.source_task_id=projection.listing_id
                 AND task.source_hash=json_extract(
                   projection.checkpoint_json,
                   '$.analyses.position.expectedSourceHash'
                 )
                 AND task.status='failed'
            )<?
       )
       SELECT j.id,j.title,j.company,j.salary,j.description,
              pa.schema_version analysis_schema_version,
              pa.source_hash analysis_source_hash
         FROM job_listings j
         LEFT JOIN user_listing_states state
           ON state.job_id=j.id AND state.user_id=?
         LEFT JOIN job_position_analyses pa ON pa.job_id=j.id
         LEFT JOIN projection_waiters waiter ON waiter.listing_id=j.id
        WHERE j.inventory_status='active'
          AND j.board<>'jobkit-e2e'
          AND (
            pa.job_id IS NULL OR pa.schema_version<>? OR pa.updated_at<j.updated_at
            OR waiter.listing_id IS NOT NULL
          )
        ORDER BY CASE WHEN waiter.listing_id IS NULL THEN 1 ELSE 0 END,
          CASE WHEN state.id IS NULL THEN 1 ELSE 0 END,
          state.priority DESC,j.updated_at DESC
        LIMIT ?`
    )
    .bind(
      JOB_POSITION_TASK_TYPE,
      JOB_POSITION_PROMPT_VERSION,
      JOB_POSITION_TASK_TYPE,
      JOB_POSITION_PROMPT_VERSION,
      JOB_ANALYSIS_MAX_ATTEMPTS_PER_VERSION,
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
      schemaVersion: JOB_POSITION_ANALYSIS_SCHEMA_VERSION,
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
  if (
    runner.user.role !== "operator" ||
    !agentRunnerHasCapability(runner, "extraction")
  ) {
    return null;
  }
  const candidates = await db
    .prepare(
      `WITH projection_waiters AS (
         SELECT DISTINCT projection.listing_id
           FROM public_projection_listing_items projection
           JOIN public_projection_runs run ON run.id=projection.run_id
          WHERE run.status='running'
            AND projection.status='waiting_analysis'
            AND COALESCE(json_extract(
              projection.checkpoint_json,'$.analyses.matchFacts.status'
            ),'')<>'current'
            AND NOT EXISTS (
              SELECT 1 FROM agent_task_runs task
               WHERE task.task_type=? AND task.prompt_version=?
                 AND task.source_task_id=projection.listing_id
                 AND task.source_hash=json_extract(
                   projection.checkpoint_json,
                   '$.analyses.matchFacts.expectedSourceHash'
                 )
                 AND task.status IN ('running','completed')
            )
            AND (
              SELECT COUNT(*) FROM agent_task_runs task
               WHERE task.task_type=? AND task.prompt_version=?
                 AND task.source_task_id=projection.listing_id
                 AND task.source_hash=json_extract(
                   projection.checkpoint_json,
                   '$.analyses.matchFacts.expectedSourceHash'
                 )
                 AND task.status='failed'
            )<?
       )
       SELECT j.id,j.title,j.company,j.salary,j.description,
              mf.schema_version analysis_schema_version,
              mf.source_hash analysis_source_hash
         FROM job_listings j
         LEFT JOIN user_listing_states state
           ON state.job_id=j.id AND state.user_id=?
         LEFT JOIN job_match_facts mf ON mf.job_id=j.id
         LEFT JOIN projection_waiters waiter ON waiter.listing_id=j.id
        WHERE j.inventory_status='active'
          AND j.board<>'jobkit-e2e'
          AND (
            mf.job_id IS NULL OR mf.schema_version<>? OR mf.updated_at<j.updated_at
            OR waiter.listing_id IS NOT NULL
          )
        ORDER BY CASE WHEN waiter.listing_id IS NULL THEN 1 ELSE 0 END,
          CASE WHEN state.id IS NULL THEN 1 ELSE 0 END,
          state.priority DESC,j.updated_at DESC
        LIMIT ?`
    )
    .bind(
      JOB_MATCH_FACTS_TASK_TYPE,
      JOB_MATCH_FACTS_PROMPT_VERSION,
      JOB_MATCH_FACTS_TASK_TYPE,
      JOB_MATCH_FACTS_PROMPT_VERSION,
      JOB_ANALYSIS_MAX_ATTEMPTS_PER_VERSION,
      runner.user.id,
      JOB_MATCH_FACTS_SCHEMA_VERSION,
      CLAIM_CANDIDATE_LIMIT
    )
    .all<JobAnalysisCandidate>();
  for (const candidate of candidates.results) {
    // biome-ignore lint/performance/noAwaitInLoops: Each source hash gates a single atomic task claim.
    const claimed = await claimJobCandidate(db, runner, candidate, {
      outputSchema: JOB_MATCH_FACTS_OUTPUT_JSON_SCHEMA,
      prompt: jobMatchFactsPrompt(candidate),
      promptVersion: JOB_MATCH_FACTS_PROMPT_VERSION,
      schemaVersion: JOB_MATCH_FACTS_SCHEMA_VERSION,
      taskType: JOB_MATCH_FACTS_TASK_TYPE,
    });
    if (claimed) {
      return claimed;
    }
  }
  return null;
}

export async function claimJobContentTask(
  db: D1Database,
  runner: AgentRunnerContext
) {
  if (
    runner.user.role !== "operator" ||
    !agentRunnerHasCapability(runner, "extraction")
  ) {
    return null;
  }
  const candidates = await db
    .prepare(
      `WITH projection_waiters AS (
         SELECT DISTINCT projection.listing_id
           FROM public_projection_listing_items projection
           JOIN public_projection_runs run ON run.id=projection.run_id
          WHERE run.status='running'
            AND projection.status='waiting_analysis'
            AND COALESCE(json_extract(
              projection.checkpoint_json,'$.analyses.content.status'
            ),'')<>'current'
            AND NOT EXISTS (
              SELECT 1 FROM agent_task_runs task
               WHERE task.task_type=? AND task.prompt_version=?
                 AND task.source_task_id=projection.listing_id
                 AND task.source_hash=json_extract(
                   projection.checkpoint_json,
                   '$.analyses.content.expectedSourceHash'
                 )
                 AND task.status IN ('running','completed')
            )
            AND (
              SELECT COUNT(*) FROM agent_task_runs task
               WHERE task.task_type=? AND task.prompt_version=?
                 AND task.source_task_id=projection.listing_id
                 AND task.source_hash=json_extract(
                   projection.checkpoint_json,
                   '$.analyses.content.expectedSourceHash'
                 )
                 AND task.status='failed'
            )<?
       )
       SELECT j.id,j.title,j.company,j.salary,j.description,
              content.schema_version analysis_schema_version,
              content.source_hash analysis_source_hash
         FROM job_listings j
         LEFT JOIN user_listing_states state
           ON state.job_id=j.id AND state.user_id=?
         LEFT JOIN job_content_analyses content ON content.job_id=j.id
         LEFT JOIN projection_waiters waiter ON waiter.listing_id=j.id
        WHERE j.inventory_status='active'
          AND j.board<>'jobkit-e2e'
          AND (
            content.job_id IS NULL
            OR content.schema_version<>?
            OR content.updated_at<j.updated_at
            OR waiter.listing_id IS NOT NULL
          )
        ORDER BY CASE WHEN waiter.listing_id IS NULL THEN 1 ELSE 0 END,
          CASE WHEN state.id IS NULL THEN 1 ELSE 0 END,
          state.priority DESC,j.updated_at DESC
        LIMIT ?`
    )
    .bind(
      JOB_CONTENT_TASK_TYPE,
      JOB_CONTENT_PROMPT_VERSION,
      JOB_CONTENT_TASK_TYPE,
      JOB_CONTENT_PROMPT_VERSION,
      JOB_ANALYSIS_MAX_ATTEMPTS_PER_VERSION,
      runner.user.id,
      JOB_CONTENT_ANALYSIS_SCHEMA_VERSION,
      CLAIM_CANDIDATE_LIMIT
    )
    .all<JobAnalysisCandidate>();
  for (const candidate of candidates.results) {
    // biome-ignore lint/performance/noAwaitInLoops: Each source hash gates a single atomic task claim.
    const claimed = await claimJobCandidate(db, runner, candidate, {
      outputSchema: JOB_CONTENT_OUTPUT_JSON_SCHEMA,
      prompt: jobContentAnalysisPrompt(candidate),
      promptVersion: JOB_CONTENT_PROMPT_VERSION,
      schemaVersion: JOB_CONTENT_ANALYSIS_SCHEMA_VERSION,
      taskType: JOB_CONTENT_TASK_TYPE,
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
  const source = await readJobListingSource(db, run.source_task_id);
  const analysis = canonicalizeJobPositionEvidence(
    JobPositionAnalysisSchema.parse(rawOutput),
    jobFactSource(source)
  );
  await assertCurrentJobSource(source, run.source_hash);
  assertSupportedEvidence(
    unsupportedPositionEvidence(analysis, jobFactSource(source))
  );
  await completeAgentTaskRunWithDomainWrites(
    db,
    runner.id,
    runId,
    analysis,
    (fence) =>
      jobPositionAnalysisStatements(
        db,
        {
          analysis,
          jobId: run.source_task_id,
          modelId: run.model,
          provider: "codex",
          sourceHash: run.source_hash,
        },
        fence
      )
  );
  await refreshCampaignMatchesForJob(env, run.source_task_id);
  return {
    jobId: run.source_task_id,
    positionCount: analysis.positions.length,
    schemaVersion: JOB_POSITION_ANALYSIS_SCHEMA_VERSION,
  };
}

export async function completeJobMatchFactsTask(
  env: AppEnv,
  runner: AgentRunnerContext,
  run: AgentTaskRunRow,
  runId: string,
  rawOutput: unknown
) {
  const { DB: db } = env;
  const source = await readJobListingSource(db, run.source_task_id);
  const parsed = JobMatchFactsSchema.parse(rawOutput);
  const facts = validateProviderJobMatchFacts(parsed, jobFactSource(source));
  await assertCurrentJobSource(source, run.source_hash);
  assertSupportedEvidence(unsupportedEvidence(facts, jobFactSource(source)));
  await completeAgentTaskRunWithDomainWrites(
    db,
    runner.id,
    runId,
    facts,
    (fence) =>
      jobMatchFactsStatements(
        db,
        {
          facts,
          jobId: run.source_task_id,
          modelId: run.model,
          provider: "codex",
          sourceHash: run.source_hash,
        },
        fence
      )
  );
  await refreshCampaignMatchesForJob(env, run.source_task_id);
  return {
    jobId: run.source_task_id,
    schemaVersion: JOB_MATCH_FACTS_SCHEMA_VERSION,
  };
}

export async function completeJobContentTask(
  env: AppEnv,
  runner: AgentRunnerContext,
  run: AgentTaskRunRow,
  runId: string,
  rawOutput: unknown
) {
  const { DB: db } = env;
  const source = await readJobListingSource(db, run.source_task_id);
  const content = canonicalizeJobContentEvidence(
    JobContentAnalysisSchema.parse(rawOutput),
    jobFactSource(source)
  );
  await assertCurrentJobSource(source, run.source_hash);
  assertSupportedEvidence(
    unsupportedContentEvidence(content, jobFactSource(source))
  );
  await completeAgentTaskRunWithDomainWrites(
    db,
    runner.id,
    runId,
    content,
    (fence) => [
      jobContentAnalysisStatement(
        db,
        {
          content,
          jobId: run.source_task_id,
          modelId: run.model,
          provider: "codex",
          sourceHash: run.source_hash,
        },
        fence
      ),
    ]
  );
  return {
    jobId: run.source_task_id,
    schemaVersion: JOB_CONTENT_ANALYSIS_SCHEMA_VERSION,
  };
}

async function assertCurrentJobSource(
  source: Parameters<typeof jobSourceHash>[0],
  sourceHash: string
) {
  if ((await jobSourceHash(source)) !== sourceHash) {
    throw new JobAnalysisRecordError(
      "Source hash does not match the stored listing; analyze the current text",
      409
    );
  }
}

function assertSupportedEvidence(rejectedEvidence: string[]) {
  if (rejectedEvidence.length === 0) {
    return;
  }
  throw new JobAnalysisRecordError(
    `${rejectedEvidence.length} evidence ${rejectedEvidence.length === 1 ? "quote is" : "quotes are"} not present in the stored listing`,
    422,
    rejectedEvidence.slice(0, 10)
  );
}

async function claimJobCandidate(
  db: D1Database,
  runner: AgentRunnerContext,
  candidate: JobAnalysisCandidate,
  task: {
    outputSchema: Record<string, unknown>;
    prompt: string;
    promptVersion: string;
    schemaVersion: number;
    taskType: JobAnalysisTaskType;
  }
) {
  const sourceHash = await jobSourceHash(candidate);
  const analysisIsCurrent =
    candidate.analysis_schema_version === task.schemaVersion &&
    candidate.analysis_source_hash === sourceHash;
  if (analysisIsCurrent) {
    return null;
  }
  const history = await db
    .prepare(
      `SELECT status,error_detail FROM agent_task_runs
        WHERE task_type=? AND source_task_id=?
          AND prompt_version=? AND source_hash=?
        ORDER BY started_at DESC LIMIT ?`
    )
    .bind(
      task.taskType,
      candidate.id,
      task.promptVersion,
      sourceHash,
      JOB_ANALYSIS_MAX_ATTEMPTS_PER_VERSION
    )
    .all<{ error_detail: string; status: string }>();
  const previous = history.results.at(0);
  if (previous?.status === "running" || previous?.status === "completed") {
    return null;
  }
  if (history.results.length >= JOB_ANALYSIS_MAX_ATTEMPTS_PER_VERSION) {
    return null;
  }
  const model = jobAnalysisModel(task.taskType);
  try {
    return await createAgentTaskRun(db, runner, {
      leaseExpiresAt: new Date(Date.now() + AGENT_TASK_LEASE_MS).toISOString(),
      model: model.model,
      outputSchema: task.outputSchema,
      prompt: previous
        ? `${task.prompt}${JOB_ANALYSIS_RETRY_GUIDANCE}`
        : task.prompt,
      promptVersion: task.promptVersion,
      reasoningEffort: model.reasoningEffort,
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
