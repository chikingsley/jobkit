import type { PublicProjectionCandidate } from "../candidates/model";
import { canonicalJson } from "../hash";
import { promotionDecision } from "./derive";
import type { PreparedMapping } from "./model";

export function sourceMappingVersionsStatement(
  db: D1Database,
  candidate: PublicProjectionCandidate,
  mappings: PreparedMapping[],
  timestamp: string
) {
  return db
    .prepare(
      `INSERT INTO job_source_position_mapping_versions (
        source_position_id,version,predecessor_version,listing_id,
        listing_material_version,mapping_state,public_job_id,reason_code,
        mapping_hash,idempotency_key,created_at
      )
      SELECT json_extract(value,'$.sourcePositionId'),
             json_extract(value,'$.mappingVersion'),
             json_extract(value,'$.predecessorMappingVersion'),
             json_extract(value,'$.listingId'),
             json_extract(value,'$.materialVersion'),'mapped',?,
             CASE WHEN json_type(value,'$.predecessorMappingVersion')='null'
               THEN 'initial' ELSE 'correction' END,
             json_extract(value,'$.mappingHash'),?,?
        FROM json_each(?)`
    )
    .bind(
      candidate.publicJobId,
      candidate.candidateId,
      timestamp,
      canonicalJson(mappings)
    );
}

export function sourceMappingHeadsStatement(
  db: D1Database,
  mappings: PreparedMapping[],
  timestamp: string
) {
  return db
    .prepare(
      `INSERT INTO job_source_position_mapping_heads (
        source_position_id,current_version,updated_at
      )
      SELECT json_extract(value,'$.sourcePositionId'),
             json_extract(value,'$.mappingVersion'),?
        FROM json_each(?)
       WHERE true
      ON CONFLICT(source_position_id) DO UPDATE SET
        current_version=excluded.current_version,updated_at=excluded.updated_at`
    )
    .bind(timestamp, canonicalJson(mappings));
}

export function eligibilityDecisionStatement(
  db: D1Database,
  candidate: PublicProjectionCandidate,
  decisionHash: string,
  timestamp: string
) {
  const decision = promotionDecision(candidate);
  return db
    .prepare(
      `INSERT INTO public_job_eligibility_decisions (
        public_job_id,decision_version,predecessor_version,public_job_version,
        publication_state,route_disposition,browse_eligible,
        organic_index_eligible,job_posting_eligible,source_open_state,
        application_route_id,application_route_state,content_review_state,
        privacy_state,verified_at,redirect_public_job_id,reason_codes_json,
        decision_note,evaluator_kind,evaluator_version,decision_hash,
        idempotency_key,decided_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,
        'Explicit operator promotion','operator','operator-promotion-v1',?,?,?)`
    )
    .bind(
      candidate.publicJobId,
      decision.decisionVersion,
      decision.predecessorVersion,
      candidate.publicJobVersion,
      decision.publicationState,
      decision.routeDisposition,
      decision.browseEligible ? 1 : 0,
      decision.organicIndexEligible ? 1 : 0,
      decision.jobPostingEligible ? 1 : 0,
      decision.sourceOpenState,
      decision.applicationRouteId,
      decision.applicationRouteState,
      decision.contentReviewState,
      decision.privacyState,
      decision.applicationRouteId ? timestamp : null,
      canonicalJson(decision.reasonCodes),
      decisionHash,
      candidate.candidateId,
      timestamp
    );
}

export function decisionSourcesStatement(
  db: D1Database,
  candidate: PublicProjectionCandidate,
  mappings: PreparedMapping[],
  timestamp: string
) {
  return db
    .prepare(
      `INSERT INTO public_job_decision_sources (
        public_job_id,decision_version,source_position_id,
        source_mapping_version,source_key,policy_version,contribution_kind,
        fields_used_json,created_at
      )
      SELECT ?,?,json_extract(value,'$.sourcePositionId'),
             json_extract(value,'$.mappingVersion'),
             json_extract(value,'$.sourceKey'),
             json_extract(value,'$.policyVersion'),
             CASE json_array_length(json_extract(value,'$.fieldsUsed'))
               WHEN 0 THEN 'identity_only' ELSE 'public_content' END,
             json_extract(value,'$.fieldsUsed'),?
        FROM json_each(?)`
    )
    .bind(
      candidate.publicJobId,
      candidate.decision.decisionVersion,
      timestamp,
      canonicalJson(mappings)
    );
}

export function eligibilityHeadStatement(
  db: D1Database,
  candidate: PublicProjectionCandidate,
  timestamp: string
) {
  return db
    .prepare(
      `INSERT INTO public_job_eligibility_heads (
        public_job_id,current_decision_version,updated_at
      ) VALUES (?,?,?)
      ON CONFLICT(public_job_id) DO UPDATE SET
        current_decision_version=excluded.current_decision_version,
        updated_at=excluded.updated_at`
    )
    .bind(candidate.publicJobId, candidate.decision.decisionVersion, timestamp);
}

export function identitySignalStatement(
  db: D1Database,
  candidate: PublicProjectionCandidate,
  timestamp: string
) {
  return db
    .prepare(
      `INSERT INTO public_job_identity_signals (
        public_job_id,public_job_version,signal_kind,signal_hash,created_at
      ) VALUES (?,?,'canonical_identity_v1',?,?)`
    )
    .bind(
      candidate.publicJobId,
      candidate.publicJobVersion,
      candidate.identitySignalHash,
      timestamp
    );
}
