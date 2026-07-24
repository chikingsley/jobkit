import {
  inventoryJobMaterialHash,
  serializeInventoryJobMaterial,
} from "../../../../../src/features/inventory/content";
import type { InventoryJob } from "../../../../../src/features/inventory/schema";
import { jobSourceHash } from "../../../../../worker/ai/job-fact-extraction";
import { PublicProjectionCandidateSchema } from "../../../../../worker/services/public-projection/candidates/model";
import {
  fixtureHash,
  jobFixture,
} from "../../public-projection-final-graph/support/fixtures";
import {
  testEnv,
  timestamp,
} from "../../public-projection-final-graph/support/model";
import { seedResolvedRun } from "../../public-projection-final-graph/support/seed-runs";
import { directAnalysis } from "../../public-projection-prerequisites/support/analyses";
import { seedAnalyses } from "../../public-projection-prerequisites/support/seeding";

export const POSTED_JOB: Partial<InventoryJob> = {
  sourceDates: {
    expires: {
      date: "2026-09-30",
      provenance: "board-published",
      raw: "2026-09-30",
    },
    posted: {
      date: "2026-07-20",
      provenance: "board-published",
      raw: "2026-07-20 09:30",
    },
  },
};

export async function seedProviderPointRun(
  runId: string,
  job: Partial<InventoryJob>
) {
  const fixture = await seedProviderPointPositions(runId, job);
  const [position] = fixture.positions;
  if (!position) {
    throw new Error("The provider point fixture has no source position");
  }
  const seeded = jobFixture(position.listingId, `${runId}-reference`, job);
  await seedAnalyses(
    {
      job: seeded,
      materialHash: await inventoryJobMaterialHash(seeded),
      materialJson: serializeInventoryJobMaterial(seeded),
      sourceHash: await jobSourceHash(seeded),
    },
    directAnalysis()
  );
  await testEnv.DB.prepare(
    `INSERT INTO application_routes (
      id,job_id,kind,destination,source_evidence,last_verified_at,status,
      created_at,updated_at
    ) VALUES (?,?,'external_url',?,?,?,'active',?,?)`
  )
    .bind(
      `route:${runId}`,
      position.listingId,
      seeded.applyUrl,
      seeded.sourceUrl,
      timestamp,
      timestamp,
      timestamp
    )
    .run();
  return fixture;
}

async function seedProviderPointPositions(
  runId: string,
  job: Partial<InventoryJob>
) {
  const canonicalSignalHash = await fixtureHash(`signal:${runId}`);
  return await seedResolvedRun({
    advanceable: true,
    positions: [
      {
        canonicalSignalHash,
        coordinateKind: "provider_point",
        job,
        sourcePositionId: `${runId}-source`,
        sourceReference: `${runId}-reference`,
      },
    ],
    runId,
  });
}

export async function approveTeflPublication() {
  const allowedFields = [
    "compensation",
    "date_posted",
    "description",
    "employment_types",
    "locations",
    "organization_name",
    "source_name",
    "source_url",
    "title",
    "valid_through",
  ];
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT OR IGNORE INTO source_publication_policy_versions (
        source_key,version,predecessor_version,approval_state,
        publication_scope,publication_enabled,allowed_fields_json,
        attribution_mode,max_verbatim_chars,source_origin_url,terms_url,
        terms_checked_at,robots_url,robots_checked_at,evidence_json,
        decision_note,policy_hash,idempotency_key,created_at
      ) VALUES ('tefl',2,1,'approved','licensed_full_text',1,?,
        'source_link',10000,'https://example.test/','',NULL,'',NULL,?,
        'Integration publication approval',?,'integration-policy-v2',?)`
    ).bind(
      JSON.stringify(allowedFields),
      JSON.stringify({ basis: "integration fixture" }),
      "d".repeat(64),
      timestamp
    ),
    testEnv.DB.prepare(
      `UPDATE source_publication_policy_heads
          SET current_version=2,updated_at=?
        WHERE source_key='tefl' AND current_version=1`
    ).bind(timestamp),
  ]);
}

export async function readCandidate(runId: string) {
  const row = await testEnv.DB.prepare(
    `SELECT candidate_json FROM public_projection_candidate_results
      WHERE run_id=? AND state='prepared' LIMIT 1`
  )
    .bind(runId)
    .first<{ candidate_json: string }>();
  if (!row) {
    throw new Error("The eligibility fixture produced no prepared candidate");
  }
  return PublicProjectionCandidateSchema.parse(JSON.parse(row.candidate_json));
}
