import { fixtureHash } from "./fixtures";
import { type PositionFixture, testEnv, timestamp } from "./model";

export async function seedOrganization() {
  await testEnv.DB.prepare(
    `INSERT OR IGNORE INTO organizations (
      id,country_code,country_name,name,identity_key,city,region,website_url,
      canonical_domain,market_segment,status,outreach_eligibility,evidence_url,
      created_at,updated_at
    ) VALUES ('fixture-organization','GE','Georgia','Example School',
      'example-school','Tbilisi','','https://example.test',
      'example.test','school','active','eligible','https://example.test',?,?)`
  )
    .bind(timestamp, timestamp)
    .run();
}

export async function seedPublicRoot(input: {
  createdAt: string;
  id: string;
  published: boolean;
  publishedAt?: string;
  signalHash?: string;
}) {
  const routeListing = await testEnv.DB.prepare(
    "SELECT id FROM job_listings ORDER BY id LIMIT 1"
  ).first<{ id: string }>();
  if (!routeListing) {
    throw new Error("Missing route listing fixture");
  }
  const routeId = `route:${input.id}`;
  const statements = [
    testEnv.DB.prepare(
      `INSERT INTO application_routes (
        id,job_id,kind,destination,status,created_at,updated_at
      ) VALUES (?,?,'email',?,'active',?,?)`
    ).bind(
      routeId,
      routeListing.id,
      `${input.id}@example.test`,
      input.createdAt,
      input.createdAt
    ),
    testEnv.DB.prepare(
      "INSERT INTO public_jobs (id,created_at) VALUES (?,?)"
    ).bind(input.id, input.createdAt),
    testEnv.DB.prepare(
      "INSERT INTO public_job_aliases (public_job_id,slug,created_at) VALUES (?,?,?)"
    ).bind(input.id, input.id, input.createdAt),
    publicVersionStatement(input.id, input.createdAt),
    eligibilityDecisionStatement(input, routeId),
    testEnv.DB.prepare(
      `INSERT INTO public_job_heads (
        public_job_id,current_version,updated_at
      ) VALUES (?,1,?)`
    ).bind(input.id, input.createdAt),
    testEnv.DB.prepare(
      `INSERT INTO public_job_eligibility_heads (
        public_job_id,current_decision_version,updated_at
      ) VALUES (?,1,?)`
    ).bind(input.id, input.createdAt),
  ];
  if (input.signalHash) {
    statements.push(
      testEnv.DB.prepare(
        `INSERT INTO public_job_identity_signals (
          public_job_id,public_job_version,signal_kind,signal_hash,created_at
        ) VALUES (?,1,'canonical_identity_v1',?,?)`
      ).bind(input.id, input.signalHash, input.createdAt)
    );
  }
  await testEnv.DB.batch(statements);
}

export function publicVersionStatement(publicJobId: string, createdAt: string) {
  return testEnv.DB.prepare(
    `INSERT INTO public_job_versions (
      public_job_id,version,predecessor_version,canonical_slug,title,
      organization_id,organization_name,organization_resolution_state,
      workplace_type,date_posted,date_posted_provenance,valid_through,
      valid_through_provenance,employment_types_json,compensation_json,
      description_html,public_content_hash,public_content_hash_version,
      material_changed_at,content_schema_version,producer_kind,producer_id,
      idempotency_key,created_at
    ) VALUES (?,1,NULL,?,'English Teacher',NULL,'Example School','unresolved',
      'unknown',NULL,'unknown',NULL,'unknown','[]','{}','Description',?,1,?,1,
      'deterministic','final-graph-test',?,?)`
  ).bind(
    publicJobId,
    publicJobId,
    publicJobId.padEnd(64, "0").slice(0, 64),
    createdAt,
    `content:${publicJobId}`,
    createdAt
  );
}

export function eligibilityDecisionStatement(
  input: {
    createdAt: string;
    id: string;
    published: boolean;
    publishedAt?: string;
  },
  routeId: string
) {
  return testEnv.DB.prepare(
    `INSERT INTO public_job_eligibility_decisions (
      public_job_id,decision_version,predecessor_version,public_job_version,
      publication_state,route_disposition,browse_eligible,
      organic_index_eligible,job_posting_eligible,source_open_state,
      application_route_id,application_route_state,content_review_state,
      privacy_state,verified_at,redirect_public_job_id,reason_codes_json,
      decision_note,evaluator_kind,evaluator_version,decision_hash,
      idempotency_key,decided_at
    ) VALUES (?,1,NULL,1,?,?,?,?,?,?,?,?,?,?,?,?,
      '["fixture"]','fixture','migration','fixture',?,?,?)`
  ).bind(
    input.id,
    input.published ? "published" : "private",
    input.published ? "serve" : "private",
    input.published ? 1 : 0,
    input.published ? 1 : 0,
    input.published ? 1 : 0,
    input.published ? "open" : "unknown",
    input.published ? routeId : null,
    input.published ? "valid" : "unresolved",
    input.published ? "approved" : "unreviewed",
    input.published ? "passed" : "pending",
    input.published ? (input.publishedAt ?? input.createdAt) : null,
    null,
    input.id.padEnd(64, "1").slice(0, 64),
    `decision:${input.id}`,
    input.publishedAt ?? input.createdAt
  );
}

export function seedSourceMapping(
  position: PositionFixture,
  publicJobId: string
) {
  return seedSourceMappingState(position, {
    publicJobId,
    state: "mapped",
  });
}

export function seedUnmappedSourceMapping(position: PositionFixture) {
  return seedSourceMappingState(position, {
    publicJobId: null,
    state: "unmapped",
  });
}

export async function seedSourceMappingState(
  position: PositionFixture,
  input: { publicJobId: null | string; state: "mapped" | "unmapped" }
) {
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO job_source_position_mapping_versions (
        source_position_id,version,predecessor_version,listing_id,
        listing_material_version,mapping_state,public_job_id,reason_code,
        mapping_hash,idempotency_key,created_at
      ) VALUES (?,1,NULL,?,1,?,?,'initial',?,?,?)`
    ).bind(
      position.sourcePositionId,
      position.listingId,
      input.state,
      input.publicJobId,
      await fixtureHash(`mapping:${position.sourcePositionId}`),
      `mapping:${position.sourcePositionId}`,
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO job_source_position_mapping_heads (
        source_position_id,current_version,updated_at
      ) VALUES (?,1,?)`
    ).bind(position.sourcePositionId, timestamp),
  ]);
}

export async function advancePublicJobHead(
  publicJobId: string,
  signalHash: string
) {
  const successorCreatedAt = "2026-07-22T12:00:01.000Z";
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO public_job_versions (
        public_job_id,version,predecessor_version,canonical_slug,title,
        organization_id,organization_name,organization_resolution_state,
        workplace_type,date_posted,date_posted_provenance,valid_through,
        valid_through_provenance,employment_types_json,compensation_json,
        description_html,public_content_hash,public_content_hash_version,
        material_changed_at,content_schema_version,producer_kind,producer_id,
        idempotency_key,created_at
      )
      SELECT public_job_id,2,1,canonical_slug,title,organization_id,
             organization_name,organization_resolution_state,workplace_type,
             date_posted,date_posted_provenance,valid_through,
             valid_through_provenance,employment_types_json,compensation_json,
             description_html,public_content_hash,public_content_hash_version,
             ?,content_schema_version,producer_kind,producer_id,?,?
        FROM public_job_versions
       WHERE public_job_id=? AND version=1`
    ).bind(
      successorCreatedAt,
      `content:${publicJobId}:v2`,
      successorCreatedAt,
      publicJobId
    ),
    testEnv.DB.prepare(
      `INSERT INTO public_job_identity_signals (
        public_job_id,public_job_version,signal_kind,signal_hash,created_at
      ) VALUES (?,2,'canonical_identity_v1',?,?)`
    ).bind(publicJobId, signalHash, successorCreatedAt),
    testEnv.DB.prepare(
      `UPDATE public_job_heads
          SET current_version=2,updated_at=?
        WHERE public_job_id=? AND current_version=1`
    ).bind(successorCreatedAt, publicJobId),
  ]);
}

export function advanceSourceMappingHead(
  position: PositionFixture,
  publicJobId: string,
  reasonCode: "correction" | "split" = "correction"
) {
  return advanceSourceMappingState(position, {
    publicJobId,
    reasonCode,
    state: "mapped",
  });
}

export function advanceUnmappedSourceMappingHead(
  position: PositionFixture,
  publicJobId: null | string = null
) {
  return advanceSourceMappingState(position, {
    publicJobId,
    reasonCode: publicJobId ? "correction" : "unmapped",
    state: publicJobId ? "mapped" : "unmapped",
  });
}

export async function advanceSourceMappingState(
  position: PositionFixture,
  input: {
    publicJobId: null | string;
    reasonCode: string;
    state: "mapped" | "unmapped";
  }
) {
  const successorCreatedAt = "2026-07-22T12:00:01.000Z";
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO job_source_position_mapping_versions (
        source_position_id,version,predecessor_version,listing_id,
        listing_material_version,mapping_state,public_job_id,reason_code,
        mapping_hash,idempotency_key,created_at
      ) VALUES (?,2,1,?,1,?,?,?,?,?,?)`
    ).bind(
      position.sourcePositionId,
      position.listingId,
      input.state,
      input.publicJobId,
      input.reasonCode,
      await fixtureHash(`mapping-v2:${position.sourcePositionId}`),
      `mapping-v2:${position.sourcePositionId}`,
      successorCreatedAt
    ),
    testEnv.DB.prepare(
      `UPDATE job_source_position_mapping_heads
          SET current_version=2,updated_at=?
        WHERE source_position_id=? AND current_version=1`
    ).bind(successorCreatedAt, position.sourcePositionId),
  ]);
}
