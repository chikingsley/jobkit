import type { D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type { InventoryJob } from "../../../../../src/features/inventory/schema";
import { createAuthenticatedUser } from "../.././auth";

export interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

export const testEnv = env as TestEnv;

export async function pairRunner(email: string, capabilities: string[]) {
  const { cookie } = await createAuthenticatedUser(email);
  const pairing = await sessionRequest(
    "/api/agent-runner-pairings",
    cookie,
    "POST",
    { capabilities }
  );
  const pairingPayload = (await pairing.json()) as {
    pairing: { code: string };
  };
  const exchange = await publicPost("/api/agent-runner-pairings/exchange", {
    code: pairingPayload.pairing.code,
    codexVersion: "codex-cli inventory-test",
    runnerName: "Inventory test runner",
  });
  if (!exchange.ok) {
    throw new Error(`Test runner could not pair (${exchange.status})`);
  }
  return ((await exchange.json()) as { runner: { token: string } }).runner;
}

export async function createInventorySource(
  sourceId: string,
  policy: "append_only" | "complete_snapshot"
) {
  const timestamp = new Date().toISOString();
  await testEnv.DB.prepare(
    `INSERT INTO inventory_sources
      (id,name,completeness_policy,status,created_at,updated_at)
     VALUES (?,?,'${policy}','active',?,?)`
  )
    .bind(sourceId, sourceId, timestamp, timestamp)
    .run();
}

export async function startRun(
  token: string,
  sourceId: string,
  snapshotKey: string,
  active: number,
  closed: number
) {
  const response = await agentPost("/api/inventory/runs", token, {
    snapshotKey,
    sourceActiveCount: active,
    sourceClosedCount: closed,
    sourceId,
    sourceName: sourceId,
    sourceTotalCount: active + closed,
  });
  if (response.status !== 202) {
    throw new Error(`Inventory test run could not start (${response.status})`);
  }
  return ((await response.json()) as { run: { id: string } }).run.id;
}

export async function completeRun(
  token: string,
  runId: string,
  expectedBatchCount: number
) {
  const response = await agentPost(
    `/api/inventory/runs/${runId}/complete`,
    token,
    { expectedBatchCount }
  );
  const payload = (await response.json()) as { run?: { status?: string } };
  if (response.status !== 200 || payload.run?.status !== "completed") {
    throw new Error(
      `Inventory test run could not complete (${response.status})`
    );
  }
}

export async function jobUpdatedAt(jobId: string) {
  const row = await testEnv.DB.prepare(
    "SELECT updated_at FROM job_listings WHERE id=?"
  )
    .bind(jobId)
    .first<{ updated_at: string }>();
  return row?.updated_at;
}

export function inventoryJob(
  id: string,
  overrides: Partial<InventoryJob> = {}
): InventoryJob {
  return {
    applyEmail: "",
    applyUrl: "https://example.test/jobs/default",
    board: "example-board",
    company: "Example School",
    compensation: {
      amountMaximum: 3000,
      amountMinimum: 2500,
      confidence: "exact",
      currency: "USD",
      display: "$2,500-$3,000 / month",
      period: "month",
      qualifier: "range",
    },
    contactName: "Hiring Manager",
    country: "Georgia",
    description:
      "A complete source listing used by the inventory integration test.",
    employerId: "",
    id,
    lastSeenAt: "2026-07-18T12:00:00.000Z",
    location: "Tbilisi",
    marketSegments: ["school"],
    salary: "$2,500-$3,000 / month",
    sourceDates: {
      expires: { date: null, provenance: "unknown", raw: "" },
      posted: { date: null, provenance: "unknown", raw: "" },
    },
    sourceReference: id,
    sourceUrl: "https://example.test/source",
    title: "English teacher",
    ...overrides,
  };
}

export async function publishSingleJobRun(
  token: string,
  sourceId: string,
  snapshotKey: string,
  job: InventoryJob
) {
  const runId = await startRun(token, sourceId, snapshotKey, 1, 0);
  const response = await agentPost(
    `/api/inventory/runs/${runId}/batches`,
    token,
    {
      batchKey: `${snapshotKey}-batch-0`,
      jobs: [job],
      ordinal: 0,
    }
  );
  const payload = (await response.json()) as {
    run?: {
      unchangedCount: number;
      upsertedCount: number;
    };
  };
  if (response.status !== 200 || !payload.run) {
    throw new Error(
      `Inventory test batch could not ingest (${response.status})`
    );
  }
  await completeRun(token, runId, 1);
  return payload.run;
}

export function listingMaterialState(jobId: string) {
  return testEnv.DB.prepare(
    `SELECT material_hash,material_hash_version,material_version,
            material_changed_at,source_content_hash,source_last_seen_at,
            source_posted_date,source_posted_date_raw,
            source_expiry_date_raw,updated_at
       FROM job_listings WHERE id=?`
  )
    .bind(jobId)
    .first<{
      material_changed_at: string;
      material_hash: string;
      material_hash_version: number;
      material_version: number;
      source_content_hash: string;
      source_expiry_date_raw: string;
      source_last_seen_at: string;
      source_posted_date: string | null;
      source_posted_date_raw: string;
      updated_at: string;
    }>();
}

export async function versionRows(jobId: string) {
  const versions = await testEnv.DB.prepare(
    `SELECT material_version,material_hash,material_hash_version,material_json
       FROM job_listing_versions
      WHERE listing_id=? ORDER BY material_version`
  )
    .bind(jobId)
    .all<{
      material_hash: string;
      material_hash_version: number;
      material_json: string | null;
      material_version: number;
    }>();
  return versions.results;
}

export function sessionRequest(
  path: string,
  cookie: string,
  method = "GET",
  body?: Record<string, unknown>
) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      cookie,
    },
    method,
  });
}

export function publicPost(path: string, body: Record<string, unknown>) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

export function agentPost(
  path: string,
  token: string,
  body: Record<string, unknown>
) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
}
