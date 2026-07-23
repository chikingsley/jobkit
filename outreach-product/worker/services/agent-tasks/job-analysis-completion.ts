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
import { refreshCampaignMatchesForJob } from "../campaign-matching";
import {
  JobAnalysisRecordError,
  jobContentAnalysisStatement,
  jobMatchFactsStatements,
  jobPositionAnalysisStatements,
  readJobListingSource,
} from "../job-analysis-records";
import type { AgentTaskRunRow } from "./contracts";
import { completeAgentTaskRunWithDomainWrites } from "./run-store";

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
