import {
  inventoryJobMaterialHash,
  serializeInventoryJobMaterial,
} from "../../../../../src/features/inventory/content";
import type { InventoryJob } from "../../../../../src/features/inventory/schema";
import {
  JOB_POSITION_ANALYSIS_SCHEMA_VERSION,
  type JobPositionAnalysis,
} from "../../../../../src/features/jobs/position-variants";
import { jobSourceHash } from "../../../../../worker/ai/job-fact-extraction";
import { contentAnalysis, matchFacts } from "./analyses";
import { type SeededListing, testEnv, timestamp } from "./model";

export async function seedListing(
  id: string,
  overrides: Partial<InventoryJob> = {}
): Promise<SeededListing> {
  const job: InventoryJob = {
    applyEmail: "jobs@example.test",
    applyUrl: "https://example.test/apply",
    board: "tefl",
    company: "Example School",
    compensation: {
      amountMaximum: 3000,
      amountMinimum: 2500,
      confidence: "exact",
      currency: "USD",
      display: "$2,500-$3,000 monthly",
      period: "month",
      qualifier: "range",
    },
    contactName: "Hiring Team",
    country: "Georgia",
    description:
      "Teach English and support adult learners in Tbilisi. Housing is provided.",
    employerId: "employer-42",
    lastSeenAt: timestamp,
    location: "Tbilisi, Georgia",
    marketSegments: ["school"],
    salary: "$2,500-$3,000 monthly",
    sourceDates: {
      expires: { date: null, provenance: "unknown", raw: "" },
      posted: {
        date: "2026-07-20",
        provenance: "board-published",
        raw: "July 20, 2026",
      },
    },
    sourceReference: id,
    sourceUrl: `https://example.test/jobs/${id}`,
    title: "English Teacher",
    ...overrides,
    id,
  };
  const materialJson = serializeInventoryJobMaterial(job);
  const materialHash = await inventoryJobMaterialHash(job);
  const sourceHash = await jobSourceHash(job);
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO job_listings (
        id,board,title,company,salary,description,apply_url,first_seen_at,
        updated_at,inventory_status,material_hash,material_hash_version,
        material_version,material_changed_at
      ) VALUES (?,?,?,?,?,?,?,?,?,'active',?,1,1,?)`
    ).bind(
      id,
      job.board,
      job.title,
      job.company,
      job.salary,
      job.description,
      job.applyUrl,
      timestamp,
      timestamp,
      materialHash,
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO job_listing_versions (
        listing_id,material_version,material_hash,material_hash_version,
        material_json,created_at
      ) VALUES (?,1,?,1,?,?)`
    ).bind(id, materialHash, materialJson, timestamp),
  ]);
  return { job, materialHash, materialJson, sourceHash };
}

export async function seedAnalyses(
  listing: SeededListing,
  analysis: JobPositionAnalysis,
  options: {
    factsJson?: string;
    includeContent?: boolean;
    includeFacts?: boolean;
    includePosition?: boolean;
    sourceHash?: string;
  } = {}
) {
  const sourceHash = options.sourceHash ?? listing.sourceHash;
  const statements: D1PreparedStatement[] = [];
  if (options.includeFacts !== false) {
    statements.push(
      testEnv.DB.prepare(
        `INSERT INTO job_match_facts (
          job_id,facts_json,schema_version,model_provider,model_id,source_hash,
          updated_at
        ) VALUES (?,?,5,'codex','test-model',?,?)
        ON CONFLICT(job_id) DO UPDATE SET
          facts_json=excluded.facts_json,
          schema_version=excluded.schema_version,
          model_provider=excluded.model_provider,
          model_id=excluded.model_id,
          source_hash=excluded.source_hash,
          updated_at=excluded.updated_at`
      ).bind(
        listing.job.id,
        options.factsJson ?? JSON.stringify(matchFacts()),
        sourceHash,
        timestamp
      )
    );
  }
  if (options.includeContent !== false) {
    statements.push(
      testEnv.DB.prepare(
        `INSERT INTO job_content_analyses (
          job_id,content_json,schema_version,model_provider,model_id,source_hash,
          updated_at
        ) VALUES (?,?,1,'codex','test-model',?,?)
        ON CONFLICT(job_id) DO UPDATE SET
          content_json=excluded.content_json,
          schema_version=excluded.schema_version,
          model_provider=excluded.model_provider,
          model_id=excluded.model_id,
          source_hash=excluded.source_hash,
          updated_at=excluded.updated_at`
      ).bind(
        listing.job.id,
        JSON.stringify(contentAnalysis(listing.job.description)),
        sourceHash,
        timestamp
      )
    );
  }
  if (options.includePosition !== false) {
    statements.push(
      testEnv.DB.prepare(
        "DELETE FROM job_position_variants WHERE job_id=?"
      ).bind(listing.job.id),
      testEnv.DB.prepare(
        `INSERT INTO job_position_analyses (
          job_id,scope,review_notes_json,schema_version,model_provider,model_id,
          source_hash,updated_at
        ) VALUES (?,?,?,?,'codex','test-model',?,?)
        ON CONFLICT(job_id) DO UPDATE SET
          scope=excluded.scope,
          review_notes_json=excluded.review_notes_json,
          schema_version=excluded.schema_version,
          model_provider=excluded.model_provider,
          model_id=excluded.model_id,
          source_hash=excluded.source_hash,
          updated_at=excluded.updated_at`
      ).bind(
        listing.job.id,
        analysis.scope,
        JSON.stringify(analysis.reviewNotes),
        JOB_POSITION_ANALYSIS_SCHEMA_VERSION,
        sourceHash,
        timestamp
      ),
      ...analysis.positions.map((value, ordinal) =>
        testEnv.DB.prepare(
          `INSERT INTO job_position_variants (
            id,job_id,ordinal,title,role_family,subjects_json,locations_json,
            audiences_json,employment_types_json,requirements_json,
            evidence_json,compensation_evidence_json,certainty,created_at,
            updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(
          `${listing.job.id}:position:${ordinal}`,
          listing.job.id,
          ordinal,
          value.title,
          value.roleFamily,
          JSON.stringify(value.subjects),
          JSON.stringify(value.locations),
          JSON.stringify(value.audiences),
          JSON.stringify(value.employmentTypes),
          JSON.stringify(value.requirements),
          JSON.stringify(value.evidence),
          JSON.stringify(value.compensationEvidence),
          value.certainty,
          timestamp,
          timestamp
        )
      )
    );
  }
  await testEnv.DB.batch(statements);
}
