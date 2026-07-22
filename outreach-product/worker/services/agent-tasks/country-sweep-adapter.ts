import type { AgentTaskFailureCode } from "../../../src/features/agents/schema";
import {
  CountrySweepChunkUploadSchema,
  type CountrySweepManifestSnapshot,
  CountrySweepOutputFinalizeSchema,
  canonicalCountrySweepChunkJson,
  createCountrySweepCanonicalChunks,
  INITIAL_COUNTRY_OUTPUT_ROLLING_SHA256,
  sha256Hex,
} from "../../../src/features/countries/materialization";
import { CountrySweepTaskOutputSchema } from "../../../src/features/countries/schema";
import type { AgentRunnerContext } from "../../app-types";
import type { AppEnv } from "../../env";
import { agentRunnerHasCapability } from "../agent-runners";
import {
  acceptCountrySweepOutput,
  uploadCountrySweepOutputChunk,
} from "../country-materialization/output";
import type { AgentTaskRunRow, PreparedAgentTask } from "./contracts";
import {
  claimCountrySweepAgentTask,
  failCountrySweepAgentTask,
  readCountryTaskLeaseContext,
} from "./country-sweep-leases";

export function claimCountryTask(
  db: D1Database,
  runner: AgentRunnerContext
): Promise<PreparedAgentTask | null> {
  if (!agentRunnerHasCapability(runner, "research")) {
    return Promise.resolve(null);
  }
  return claimCountrySweepAgentTask(db, runner);
}

export async function completeCountryTask(
  env: AppEnv,
  runner: AgentRunnerContext,
  run: AgentTaskRunRow,
  runId: string,
  rawOutput: unknown
) {
  const lease = await readCountryTaskLeaseContext(env.DB, runner, run, runId);
  const finalized = CountrySweepOutputFinalizeSchema.safeParse(rawOutput);
  if (finalized.success) {
    return acceptCountrySweepOutput(env, lease, finalized.data);
  }
  const output = CountrySweepTaskOutputSchema.parse(rawOutput);
  let manifest: CountrySweepManifestSnapshot = {
    chunkCount: 0,
    contactCount: 0,
    organizationCount: 0,
    rollingSha256: INITIAL_COUNTRY_OUTPUT_ROLLING_SHA256,
    scopeCount: 0,
    totalBytes: 0,
  };
  const chunks = createCountrySweepCanonicalChunks(output);
  for (let ordinal = 0; ordinal < chunks.length; ordinal += 1) {
    const chunk = chunks[ordinal];
    if (!chunk) {
      continue;
    }
    const canonicalJson = canonicalCountrySweepChunkJson(chunk);
    const bytes = new TextEncoder().encode(canonicalJson);
    // biome-ignore lint/performance/noAwaitInLoops: Chunk ordinals and the rolling manifest hash are strictly sequential.
    const uploaded = await uploadCountrySweepOutputChunk(env, lease, {
      byteLength: bytes.byteLength,
      chunk,
      ordinal,
      recordCount: chunk.records.length,
      sha256: await sha256Hex(bytes),
    });
    ({ manifest } = uploaded);
  }
  return acceptCountrySweepOutput(env, lease, {
    coverageSummary: output.coverageSummary,
    manifest,
    notes: output.notes,
  });
}

export async function uploadCountryTaskChunk(
  env: AppEnv,
  runner: AgentRunnerContext,
  run: AgentTaskRunRow,
  runId: string,
  rawInput: unknown
) {
  const input = CountrySweepChunkUploadSchema.omit({ leaseToken: true }).parse(
    rawInput
  );
  return uploadCountrySweepOutputChunk(
    env,
    await readCountryTaskLeaseContext(env.DB, runner, run, runId),
    input
  );
}

export async function failCountryTask(
  db: D1Database,
  runner: AgentRunnerContext,
  run: AgentTaskRunRow,
  runId: string,
  error: string,
  errorCode: AgentTaskFailureCode
) {
  return failCountrySweepAgentTask(
    db,
    await readCountryTaskLeaseContext(db, runner, run, runId),
    error,
    errorCode
  );
}
