import { JobContentAnalysisSchema } from "../../../../src/features/jobs/content-analysis";
import { JobPositionVariantSchema } from "../../../../src/features/jobs/position-variants";
import { JobMatchFactsSchema } from "../../../../src/features/matching/schema";
import { readExactProjectionListingSnapshot } from "../listing-snapshot";
import { readProjectionAnalysisPrerequisites } from "../prerequisites";
import type {
  CandidateAllocationRow,
  CandidateLocationRow,
  CandidateSourceRow,
} from "./model";

export function readNextCandidateAllocation(db: D1Database, runId: string) {
  return db
    .prepare(
      `SELECT allocation.run_id,allocation.id allocation_id,
              allocation.allocation_hash,allocation.state,
              allocation.reason_code,allocation.founding_source_position_id,
              allocation.proposed_public_job_id,
              allocation.winning_public_job_id,
              final_seal.seal_hash final_duplicate_seal_hash,
              run.policy_heads_hash,run.source_watermark_json
         FROM public_projection_allocation_components allocation
         JOIN public_projection_final_duplicate_seals final_seal
           ON final_seal.run_id=allocation.run_id
         JOIN public_projection_runs run ON run.id=allocation.run_id
        WHERE allocation.run_id=?
          AND NOT EXISTS (
            SELECT 1 FROM public_projection_candidate_results result
             WHERE result.run_id=allocation.run_id
               AND result.allocation_id=allocation.id
          )
        ORDER BY allocation.id LIMIT 1`
    )
    .bind(runId)
    .first<CandidateAllocationRow>();
}

export async function readCandidateSources(
  db: D1Database,
  allocation: CandidateAllocationRow
) {
  const rows = await db
    .prepare(
      `SELECT member.source_position_id,member.input_hash,
              member.position_item_id,item.listing_item_id,
              position.listing_id,listing_item.material_version,
              position.source_key,
              policy_head.current_version policy_version,
              mapping_head.current_version mapping_version
         FROM public_projection_allocation_members member
         JOIN job_source_positions position
           ON position.id=member.source_position_id
         JOIN public_projection_position_items item
           ON item.id=member.position_item_id AND item.run_id=member.run_id
         JOIN public_projection_listing_items listing_item
           ON listing_item.id=item.listing_item_id
         JOIN source_publication_policy_heads policy_head
           ON policy_head.source_key=position.source_key
         LEFT JOIN job_source_position_mapping_heads mapping_head
           ON mapping_head.source_position_id=member.source_position_id
        WHERE member.run_id=? AND member.allocation_id=?
          AND member.member_kind='shadow'
        ORDER BY member.source_position_id`
    )
    .bind(allocation.run_id, allocation.allocation_id)
    .all<CandidateSourceRow>();
  return rows.results;
}

export async function readCandidatePrimaryInput(
  db: D1Database,
  allocation: CandidateAllocationRow,
  sources: CandidateSourceRow[]
) {
  const source = sources.find(
    (value) =>
      value.source_position_id === allocation.founding_source_position_id
  );
  if (!source) {
    throw new CandidateInputError(
      "candidate_founding_source_missing",
      "The sealed allocation lost its founding source position"
    );
  }
  const snapshot = await readExactProjectionListingSnapshot(
    db,
    source.listing_item_id
  );
  const analyses = await readProjectionAnalysisPrerequisites(db, snapshot);
  if (
    !(
      analyses.ready &&
      analyses.content &&
      analyses.matchFacts &&
      analyses.position
    )
  ) {
    throw new CandidateInputError(
      "candidate_analysis_incomplete",
      "The founding source position lacks current normalized analyses"
    );
  }
  const checkpoint = await db
    .prepare(
      `SELECT checkpoint_json FROM public_projection_position_items
        WHERE id=? AND run_id=? LIMIT 1`
    )
    .bind(source.position_item_id, allocation.run_id)
    .first<{ checkpoint_json: string }>();
  const sourceOrdinal = readSourceOrdinal(checkpoint?.checkpoint_json);
  const position = analyses.position.positions[sourceOrdinal];
  if (!position) {
    throw new CandidateInputError(
      "candidate_position_missing",
      "The founding source position lost its normalized position"
    );
  }
  return {
    analysis: JobContentAnalysisSchema.parse(analyses.content),
    facts: JobMatchFactsSchema.parse(analyses.matchFacts),
    position: JobPositionVariantSchema.parse(position),
    snapshot,
    source,
  };
}

function readSourceOrdinal(checkpointJson: string | undefined) {
  if (!checkpointJson) {
    return 0;
  }
  try {
    const value = (JSON.parse(checkpointJson) as { sourceOrdinal?: unknown })
      .sourceOrdinal;
    const ordinal = value === undefined ? 0 : Number(value);
    if (Number.isSafeInteger(ordinal) && ordinal >= 0) {
      return ordinal;
    }
  } catch {
    // The error below gives candidate callers one stable failure code.
  }
  throw new CandidateInputError(
    "candidate_position_checkpoint_invalid",
    "The founding source position checkpoint is invalid"
  );
}

export async function readCandidateResolution(
  db: D1Database,
  runId: string,
  positionItemId: string
) {
  const [organization, locations] = await Promise.all([
    db
      .prepare(
        `SELECT state,selected_organization_id,selected_display_name,
                resolution_hash
           FROM public_projection_organization_resolutions
          WHERE run_id=? AND position_item_id=? LIMIT 1`
      )
      .bind(runId, positionItemId)
      .first<{
        resolution_hash: string;
        selected_display_name: string;
        selected_organization_id: string | null;
        state: string;
      }>(),
    db
      .prepare(
        `SELECT id resolution_id,ordinal,literal_label,location_role role,
                scope,state,workplace_type,proposed_canonical_location_id,
                selected_provider_place_id provider_place_id,display_name,
                country_code,region,locality,postal_code,latitude,longitude,
                bounds_json,coordinate_kind,resolution_hash
           FROM public_projection_location_resolutions
          WHERE run_id=? AND position_item_id=? ORDER BY ordinal`
      )
      .bind(runId, positionItemId)
      .all<CandidateLocationRow>(),
  ]);
  if (
    organization?.state !== "resolved" ||
    !organization.selected_organization_id ||
    !organization.selected_display_name
  ) {
    throw new CandidateInputError(
      "candidate_organization_unresolved",
      "The founding source position lacks a resolved organization"
    );
  }
  if (
    locations.results.length === 0 ||
    locations.results.some(
      (location) =>
        location.state !== "resolved" ||
        !location.country_code ||
        location.latitude === null ||
        location.longitude === null
    )
  ) {
    throw new CandidateInputError(
      "candidate_location_unresolved",
      "The founding source position lacks a complete resolved location"
    );
  }
  return {
    locations: locations.results,
    organization: {
      ...organization,
      selected_display_name: organization.selected_display_name,
      selected_organization_id: organization.selected_organization_id,
    } as typeof organization & {
      selected_display_name: string;
      selected_organization_id: string;
    },
  };
}

export async function readCandidatePolicy(
  db: D1Database,
  sourceKey: string,
  policyVersion: number
) {
  const row = await db
    .prepare(
      `SELECT policy.approval_state,policy.publication_scope,
              policy.publication_enabled,policy.allowed_fields_json,
              policy.attribution_mode,policy.source_origin_url,
              label.display_label
         FROM source_publication_policy_versions policy
         JOIN source_publication_policy_label_versions binding
           ON binding.source_key=policy.source_key
          AND binding.policy_version=policy.version
         JOIN public_source_display_label_versions label
           ON label.source_key=binding.source_key
          AND label.version=binding.label_version
        WHERE policy.source_key=? AND policy.version=? LIMIT 1`
    )
    .bind(sourceKey, policyVersion)
    .first<{
      allowed_fields_json: string;
      approval_state: string;
      attribution_mode: "none" | "source_link" | "source_name";
      display_label: string;
      publication_enabled: number;
      publication_scope: string;
      source_origin_url: string;
    }>();
  if (!row) {
    throw new CandidateInputError(
      "candidate_policy_missing",
      "The founding source policy is unavailable"
    );
  }
  return {
    allowedFields: new Set(JSON.parse(row.allowed_fields_json) as string[]),
    attributionMode: row.attribution_mode,
    displayLabel: row.display_label,
    enabled:
      row.approval_state === "approved" &&
      row.publication_enabled === 1 &&
      row.publication_scope !== "blocked",
    sourceOriginUrl: row.source_origin_url,
  };
}

export function readLivePredecessor(db: D1Database, publicJobId: string) {
  return db
    .prepare(
      `SELECT job_head.current_version,decision_head.current_decision_version
         FROM public_jobs job
         JOIN public_job_heads job_head ON job_head.public_job_id=job.id
         JOIN public_job_eligibility_heads decision_head
           ON decision_head.public_job_id=job.id
        WHERE job.id=? LIMIT 1`
    )
    .bind(publicJobId)
    .first<{
      current_decision_version: number;
      current_version: number;
    }>();
}

export function readApplicationRoute(db: D1Database, listingId: string) {
  return db
    .prepare(
      `SELECT id FROM application_routes
        WHERE job_id=? AND status='active'
        ORDER BY CASE kind
          WHEN 'email' THEN 0 WHEN 'board_form' THEN 1
          WHEN 'external_url' THEN 2 WHEN 'login_gated_form' THEN 3
          WHEN 'manual' THEN 4 ELSE 5 END,id
        LIMIT 1`
    )
    .bind(listingId)
    .first<{ id: string }>();
}

export async function readIdentitySignal(
  db: D1Database,
  runId: string,
  positionItemId: string
) {
  const row = await db
    .prepare(
      `SELECT signal_hash FROM public_projection_canonical_identity_signals
        WHERE run_id=? AND position_item_id=? AND state='resolved' LIMIT 1`
    )
    .bind(runId, positionItemId)
    .first<{ signal_hash: string }>();
  if (!row) {
    throw new CandidateInputError(
      "candidate_identity_signal_missing",
      "The founding source position lacks a canonical identity signal"
    );
  }
  return row.signal_hash;
}

export class CandidateInputError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "CandidateInputError";
  }
}
