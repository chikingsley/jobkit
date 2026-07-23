import type { D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  type CountrySweepCanonicalChunk,
  type CountrySweepManifestSnapshot,
  canonicalCountrySweepChunkJson,
  createCountrySweepCanonicalChunks,
  INITIAL_COUNTRY_OUTPUT_ROLLING_SHA256,
  sha256Hex,
} from "../../../../../src/features/countries/materialization";
import type { CountrySweepTaskOutput } from "../../../../../src/features/countries/schema";
import type { CountryTaskLeaseContext } from "../../../../../worker/services/agent-tasks/country-sweep-leases";
import { materializeOneCountrySweepItem } from "../../../../../worker/services/country-materialization/materializer";
import { createAuthenticatedUser } from "../.././auth";
import {
  authenticatedRequest,
  organization,
  publicRequest,
  runnerRequest,
} from "./organization";

export interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

export interface ClaimedCountryTask {
  attemptNumber: number;
  leaseToken: string;
  runId: string;
  taskType: string;
}

export const testEnv = env as TestEnv;

export async function firstMaterializationItemId(outputId: string) {
  const itemId = await testEnv.DB.prepare(
    `SELECT id FROM country_sweep_materialization_items
      WHERE output_id=? ORDER BY sequence,id LIMIT 1`
  )
    .bind(outputId)
    .first<string>("id");
  if (!itemId) {
    throw new Error(
      `Output ${outputId} omitted its first materialization item`
    );
  }
  return itemId;
}

export async function markOtherAbandonedOutputsCleaned(outputId: string) {
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT OR IGNORE INTO country_sweep_output_cleanup
        (output_id,status,deleted_object_count,created_at,completed_at,updated_at)
       SELECT id,'completed',0,strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              strftime('%Y-%m-%dT%H:%M:%fZ','now')
         FROM country_sweep_outputs WHERE status='abandoned' AND id<>?`
    ).bind(outputId),
    testEnv.DB.prepare(
      `UPDATE country_sweep_output_cleanup
          SET status='completed',completed_at=COALESCE(
                completed_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')
              ),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE output_id<>? AND status='pending'`
    ).bind(outputId),
  ]);
}

export async function simulateExpiredMaterializationLease(
  outputId: string,
  itemId: string,
  attemptCount: number
) {
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `UPDATE country_sweep_outputs
          SET status='materializing',updated_at=strftime(
            '%Y-%m-%dT%H:%M:%fZ','now'
          )
        WHERE id=? AND status='accepted'`
    ).bind(outputId),
    testEnv.DB.prepare(
      `UPDATE country_sweep_materialization_items
          SET status='processing',attempt_count=?,lease_owner='crashed-worker',
              lease_token='crashed-lease',
              lease_expires_at='2000-01-01T00:00:00.000Z',
              updated_at='2000-01-01T00:00:00.000Z'
        WHERE id=? AND output_id=? AND status='queued'`
    ).bind(attemptCount, itemId, outputId),
  ]);
}

export async function uploadChunkRequest(
  token: string,
  task: ClaimedCountryTask,
  chunk: CountrySweepCanonicalChunk,
  ordinal: number
) {
  const bytes = new TextEncoder().encode(canonicalCountrySweepChunkJson(chunk));
  return runnerRequest(`/api/agent-tasks/${task.runId}/chunks`, token, {
    byteLength: bytes.byteLength,
    chunk,
    leaseToken: task.leaseToken,
    ordinal,
    recordCount: chunk.records.length,
    sha256: await sha256Hex(bytes),
  });
}

export async function setupClaim(email: string) {
  const auth = await createAuthenticatedUser(email);
  const sweepResponse = await authenticatedRequest(
    "/api/countries/TJ/sweeps",
    auth.cookie,
    "POST",
    {
      includeDirectories: false,
      includeKnownSources: false,
      includeMaps: false,
      includeSearch: true,
    }
  );
  const sweepPayload = (await sweepResponse.json()) as {
    sweep: { id: string };
  };
  const runner = await createResearchRunner(auth.cookie, email);
  const task = await claimTask(runner.token);
  return {
    runner,
    sweepId: sweepPayload.sweep.id,
    task,
    userId: auth.userId,
  };
}

export async function createResearchRunner(cookie: string, runnerName: string) {
  const pairingResponse = await authenticatedRequest(
    "/api/agent-runner-pairings",
    cookie,
    "POST",
    { capabilities: ["research"] }
  );
  const pairing = (await pairingResponse.json()) as {
    pairing: { code: string };
  };
  const response = await publicRequest("/api/agent-runner-pairings/exchange", {
    code: pairing.pairing.code,
    codexVersion: "codex-cli materialization-test",
    runnerName,
  });
  const payload = (await response.json()) as {
    runner: { runnerId: string; token: string };
  };
  return { id: payload.runner.runnerId, token: payload.runner.token };
}

export async function claimTask(token: string) {
  const response = await runnerRequest("/api/agent-tasks/claim", token, {
    runnerVersion: "codex-cli materialization-test",
  });
  const payload = (await response.json()) as {
    task: ClaimedCountryTask | null;
  };
  if (!payload.task) {
    throw new Error("Country task was not claimed");
  }
  return payload.task;
}

export async function uploadOutput(
  token: string,
  task: ClaimedCountryTask,
  output: CountrySweepTaskOutput
) {
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
    const bytes = new TextEncoder().encode(
      canonicalCountrySweepChunkJson(chunk)
    );
    // biome-ignore lint/performance/noAwaitInLoops: Upload ordinals and manifest hashes are strictly sequential.
    const response = await runnerRequest(
      `/api/agent-tasks/${task.runId}/chunks`,
      token,
      {
        byteLength: bytes.byteLength,
        chunk,
        leaseToken: task.leaseToken,
        ordinal,
        recordCount: chunk.records.length,
        sha256: await sha256Hex(bytes),
      }
    );
    if (!response.ok) {
      throw new Error(`Country chunk upload failed: ${await response.text()}`);
    }
    const payload = (await response.json()) as {
      result: { manifest: CountrySweepManifestSnapshot };
    };
    ({ manifest } = payload.result);
  }
  return manifest;
}

export async function completeManifest(
  token: string,
  task: ClaimedCountryTask,
  output: CountrySweepTaskOutput,
  manifest: CountrySweepManifestSnapshot
) {
  return readCompletion(
    await runnerRequest(`/api/agent-tasks/${task.runId}/complete`, token, {
      leaseToken: task.leaseToken,
      output: {
        coverageSummary: output.coverageSummary,
        manifest,
        notes: output.notes,
      },
    }),
    task.runId
  );
}

export async function completeRawOutput(
  token: string,
  task: ClaimedCountryTask,
  output: CountrySweepTaskOutput
) {
  return readCompletion(
    await runnerRequest(`/api/agent-tasks/${task.runId}/complete`, token, {
      leaseToken: task.leaseToken,
      output,
    }),
    task.runId
  );
}

export async function readCompletion(response: Response, runId: string) {
  if (!response.ok) {
    return { outputId: "", response };
  }
  const payload = (await response.clone().json()) as {
    result: { domainResult: { outputId: string } };
  };
  const {
    result: {
      domainResult: { outputId },
    },
  } = payload;
  if (!outputId) {
    throw new Error(`Completion ${runId} omitted its output ID`);
  }
  return { outputId, response };
}

export async function drainOutput(outputId: string) {
  for (let step = 0; step < 20; step += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: Each invocation owns one bounded materialization item.
    await materializeOneCountrySweepItem(
      testEnv,
      outputId,
      `drain:${step.toString()}`
    );
    const status = await testEnv.DB.prepare(
      "SELECT status FROM country_sweep_outputs WHERE id=?"
    )
      .bind(outputId)
      .first<string>("status");
    if (status === "materialized") {
      return;
    }
  }
  throw new Error("Country materialization drain exceeded its item bound");
}

export function expireTaskPair(task: ClaimedCountryTask) {
  return testEnv.DB.batch([
    testEnv.DB.prepare(
      `UPDATE country_sweep_tasks
          SET lease_expires_at='2000-01-01T00:00:00.000Z'
        WHERE lease_token=?`
    ).bind(task.leaseToken),
    testEnv.DB.prepare(
      `UPDATE agent_task_runs
          SET lease_expires_at='2000-01-01T00:00:00.000Z'
        WHERE id=?`
    ).bind(task.runId),
  ]);
}

export async function countryLeaseContext(runId: string) {
  const row = await testEnv.DB.prepare(
    `SELECT task.attempt_count attemptNumber,task.lease_token leaseToken,
            output.id outputId,run.id runId,run.runner_id runnerId,
            run.source_hash sourceHash,task.sweep_id sweepId,task.id taskId,
            run.task_type taskType,run.user_id userId
       FROM agent_task_runs run
       JOIN country_sweep_tasks task ON task.id=run.source_task_id
       JOIN country_sweep_outputs output ON output.agent_run_id=run.id
      WHERE run.id=?`
  )
    .bind(runId)
    .first<CountryTaskLeaseContext>();
  if (!row) {
    throw new Error(`Country run ${runId} omitted its output lease`);
  }
  return row;
}

export function domainOrganizationCount(sweepId: string) {
  return testEnv.DB.prepare(
    "SELECT COUNT(*) count FROM organizations WHERE source_sweep_id=?"
  )
    .bind(sweepId)
    .first<number>("count");
}

export function emptyOutput(): CountrySweepTaskOutput {
  return {
    coverageSummary: {
      citiesChecked: [],
      gaps: [],
      needsAnotherPass: false,
      nextScopes: [],
      queriesChecked: [],
      resultCount: 0,
      sourcesChecked: [],
    },
    notes: [],
    organizations: [],
  };
}

export function oneOrganizationOutput(): CountrySweepTaskOutput {
  return {
    ...emptyOutput(),
    coverageSummary: {
      ...emptyOutput().coverageSummary,
      resultCount: 1,
    },
    organizations: [
      {
        ...organization(0),
        contactPoints: [
          {
            evidenceUrl: "https://example-school.tj/contact",
            kind: "email",
            label: "Hiring",
            status: "active",
            value: "jobs@example-school.tj",
          },
        ],
        name: "Example School",
      },
    ],
  };
}
