import type { PublicProjectionCandidate } from "../candidates/model";
import { canonicalJson } from "../hash";
import { assertion } from "./guards";
import {
  decisionSourcesStatement,
  eligibilityDecisionStatement,
  eligibilityHeadStatement,
  identitySignalStatement,
  sourceMappingHeadsStatement,
  sourceMappingVersionsStatement,
} from "./live-evidence";
import { promotionStoredLocation } from "./location";
import type { PreparedMapping } from "./model";

export function livePromotionStatements(
  db: D1Database,
  input: {
    candidate: PublicProjectionCandidate;
    decisionHash: string;
    mappings: PreparedMapping[];
    timestamp: string;
  }
) {
  const statements: D1PreparedStatement[] = [
    ...canonicalLocationStatements(db, input.candidate, input.timestamp),
    ...publicJobIdentityStatements(db, input.candidate, input.timestamp),
    publicJobVersionStatement(db, input.candidate, input.timestamp),
    publicJobLocationsStatement(db, input.candidate, input.timestamp),
    publicJobHeadStatement(db, input.candidate, input.timestamp),
    sourceMappingVersionsStatement(
      db,
      input.candidate,
      input.mappings,
      input.timestamp
    ),
    sourceMappingHeadsStatement(db, input.mappings, input.timestamp),
    eligibilityDecisionStatement(
      db,
      input.candidate,
      input.decisionHash,
      input.timestamp
    ),
    decisionSourcesStatement(
      db,
      input.candidate,
      input.mappings,
      input.timestamp
    ),
    eligibilityHeadStatement(db, input.candidate, input.timestamp),
    identitySignalStatement(db, input.candidate, input.timestamp),
  ];
  return statements;
}

function canonicalLocationStatements(
  db: D1Database,
  candidate: PublicProjectionCandidate,
  timestamp: string
) {
  const locationsJson = canonicalJson(candidate.locations);
  return [
    db
      .prepare(
        `INSERT OR IGNORE INTO canonical_locations (
          id,resolution_state,input_label,display_name,country_code,region,
          locality,provider,provider_place_id,latitude,longitude,bounds_json,
          resolution_evidence_json,created_at,updated_at
        )
        SELECT json_extract(value,'$.locationId'),'resolved',
               json_extract(value,'$.inputLabel'),
               json_extract(value,'$.publicValue.displayName'),
               json_extract(value,'$.publicValue.countryCode'),
               COALESCE(json_extract(value,'$.publicValue.region'),''),
               COALESCE(json_extract(value,'$.publicValue.locality'),''),
               'mapbox',json_extract(value,'$.providerPlaceId'),
               json_extract(value,'$.publicValue.coordinates.latitude'),
               json_extract(value,'$.publicValue.coordinates.longitude'),
               json_extract(value,'$.publicValue.bounds'),
               json_extract(value,'$.resolutionEvidence'),?,?
          FROM json_each(?)`
      )
      .bind(timestamp, timestamp, locationsJson),
    assertion(
      db,
      candidate.locations.length,
      `SELECT COUNT(*) FROM json_each(?) location
        JOIN canonical_locations canonical
          ON canonical.id=json_extract(location.value,'$.locationId')
         AND canonical.resolution_state='resolved'
         AND canonical.provider='mapbox'
         AND canonical.provider_place_id=json_extract(
               location.value,'$.providerPlaceId'
             )
         AND canonical.country_code=json_extract(
               location.value,'$.publicValue.countryCode'
             )
         AND canonical.latitude=json_extract(
               location.value,'$.publicValue.coordinates.latitude'
             )
         AND canonical.longitude=json_extract(
               location.value,'$.publicValue.coordinates.longitude'
             )`,
      [locationsJson]
    ),
  ];
}

function publicJobIdentityStatements(
  db: D1Database,
  candidate: PublicProjectionCandidate,
  timestamp: string
) {
  const statements: D1PreparedStatement[] = [];
  if (candidate.publicJobVersionPredecessor === null) {
    statements.push(
      db
        .prepare("INSERT INTO public_jobs (id,created_at) VALUES (?,?)")
        .bind(candidate.publicJobId, timestamp),
      db
        .prepare(
          `INSERT INTO public_job_allocations (
            public_job_id,allocation_algorithm_version,
            founding_source_position_id,allocation_hash,originating_run_id,
            originating_allocation_id,created_at
          )
          SELECT ?,'public-job-allocation-v1',founding_source_position_id,
                 allocation_hash,run_id,id,?
            FROM public_projection_allocation_components
           WHERE run_id=? AND id=?`
        )
        .bind(
          candidate.publicJobId,
          timestamp,
          candidate.runId,
          candidate.allocationId
        )
    );
  }
  statements.push(
    db
      .prepare(
        `INSERT OR IGNORE INTO public_job_aliases (
          public_job_id,slug,created_at
        ) VALUES (?,?,?)`
      )
      .bind(candidate.publicJobId, candidate.version.canonicalSlug, timestamp),
    assertion(
      db,
      1,
      `SELECT COUNT(*) FROM public_job_aliases
        WHERE public_job_id=? AND slug=?`,
      [candidate.publicJobId, candidate.version.canonicalSlug]
    )
  );
  return statements;
}

function publicJobVersionStatement(
  db: D1Database,
  candidate: PublicProjectionCandidate,
  timestamp: string
) {
  const { version } = candidate;
  return db
    .prepare(
      `INSERT INTO public_job_versions (
        public_job_id,version,predecessor_version,canonical_slug,title,
        organization_id,organization_name,organization_resolution_state,
        workplace_type,date_posted,date_posted_provenance,valid_through,
        valid_through_provenance,employment_types_json,compensation_json,
        description_html,public_content_hash,public_content_hash_version,
        material_changed_at,content_schema_version,producer_kind,producer_id,
        idempotency_key,created_at
      ) VALUES (?,?,?,?,?,?,?,'resolved',?,?,?,?,?,?,?,?,?,1,?,?,'deterministic',
        'public-candidate-materializer-v1',?,?)`
    )
    .bind(
      candidate.publicJobId,
      candidate.publicJobVersion,
      candidate.publicJobVersionPredecessor,
      version.canonicalSlug,
      version.title,
      version.organizationId,
      version.organizationName,
      version.workplaceType,
      version.datePosted,
      version.datePostedProvenance,
      version.validThrough,
      version.validThroughProvenance,
      version.employmentTypesJson,
      version.compensationJson,
      version.descriptionHtml,
      candidate.publicContentHash,
      version.materialChangedAt,
      version.contentSchemaVersion,
      candidate.candidateId,
      timestamp
    );
}

function publicJobLocationsStatement(
  db: D1Database,
  candidate: PublicProjectionCandidate,
  timestamp: string
) {
  const locationsJson = canonicalJson(
    candidate.locations.map(promotionStoredLocation)
  );
  return db
    .prepare(
      `INSERT INTO public_job_version_locations (
        public_job_id,public_job_version,ordinal,location_role,location_id,
        resolution_state,display_name,country_code,region,locality,postal_code,
        location_json,created_at
      )
      SELECT ?,?,json_extract(value,'$.ordinal'),
             CASE json_extract(value,'$.publicValue.role')
               WHEN 'applicantArea' THEN 'applicant_area' ELSE 'worksite' END,
             json_extract(value,'$.locationId'),'resolved',
             json_extract(value,'$.publicValue.displayName'),
             json_extract(value,'$.publicValue.countryCode'),
             COALESCE(json_extract(value,'$.publicValue.region'),''),
             COALESCE(json_extract(value,'$.publicValue.locality'),''),
             COALESCE(json_extract(value,'$.publicValue.postalCode'),''),
             json_extract(value,'$.storedValue'),?
        FROM json_each(?)`
    )
    .bind(
      candidate.publicJobId,
      candidate.publicJobVersion,
      timestamp,
      locationsJson
    );
}

function publicJobHeadStatement(
  db: D1Database,
  candidate: PublicProjectionCandidate,
  timestamp: string
) {
  return db
    .prepare(
      `INSERT INTO public_job_heads (public_job_id,current_version,updated_at)
       VALUES (?,?,?)
       ON CONFLICT(public_job_id) DO UPDATE SET
         current_version=excluded.current_version,updated_at=excluded.updated_at`
    )
    .bind(candidate.publicJobId, candidate.publicJobVersion, timestamp);
}
