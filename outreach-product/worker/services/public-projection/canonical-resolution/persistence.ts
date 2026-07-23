import { canonicalJson } from "../hash";
import type { ClaimedProjectionPosition } from "../position-items";
import {
  CanonicalResolutionInputError,
  LOCATION_RESOLVER_VERSION,
  type LocationCandidateArtifact,
  type LocationEvidenceArtifact,
  type LocationResolutionArtifact,
  MAX_D1_BOUND_JSON_BYTES,
  ORGANIZATION_RESOLVER_VERSION,
  type OrganizationCandidateArtifact,
  type OrganizationEvidenceArtifact,
  type OrganizationResolutionArtifact,
  type ProviderEvidenceArtifact,
  type ResolutionInputs,
  type ResolutionState,
} from "./model";

export function organizationResolutionInsert(
  db: D1Database,
  claim: ClaimedProjectionPosition,
  inputs: ResolutionInputs,
  resolution: OrganizationResolutionArtifact,
  resolutionGuardToken: string,
  timestamp: string
) {
  return db
    .prepare(
      `INSERT INTO public_projection_organization_resolutions (
        id,run_id,position_item_id,source_position_id,position_input_hash,
        duplicate_batch_input_hash,listing_id,material_version,material_hash,
        content_analysis_hash,match_facts_analysis_hash,position_analysis_hash,
        position_payload_hash,normalized_company_name,asserted_country_code,
        resolved_locality,state,selected_organization_id,
        selected_display_name,resolver_version,reason_code,candidate_count,
        evidence_count,candidate_digest,evidence_digest,resolution_hash,
        claim_lease_token,resolution_guard_token,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      resolution.resolutionId,
      claim.runId,
      claim.id,
      claim.sourcePositionId,
      claim.inputHash,
      inputs.batch.input_hash,
      inputs.listing.listingId,
      inputs.listing.materialVersion,
      inputs.listing.materialHash,
      inputs.checkpoint.analysisHashes.content,
      inputs.checkpoint.analysisHashes.matchFacts,
      inputs.checkpoint.analysisHashes.position,
      inputs.checkpoint.positionPayloadHash,
      resolution.normalizedCompanyName,
      resolution.assertedCountryCode,
      resolution.resolvedLocality,
      resolution.state,
      resolution.selectedOrganizationId,
      resolution.selectedDisplayName,
      ORGANIZATION_RESOLVER_VERSION,
      resolution.reasonCode,
      resolution.candidateCount,
      resolution.evidenceCount,
      resolution.candidateDigest,
      resolution.evidenceDigest,
      resolution.resolutionHash,
      claim.leaseToken,
      resolutionGuardToken,
      timestamp
    );
}

export function organizationCandidatesInserts(
  db: D1Database,
  rows: OrganizationCandidateArtifact[]
) {
  return canonicalJsonPages(rows, "organization candidates").map((page) =>
    db
      .prepare(
        `INSERT INTO public_projection_organization_candidates (
        resolution_id,run_id,ordinal,organization_id,evidence_tier,
        organization_status,normalized_name,country_code,
        normalized_locality,normalized_domain,selected,candidate_hash,
        created_at
      )
      SELECT json_extract(value,'$.resolutionId'),
             json_extract(value,'$.runId'),json_extract(value,'$.ordinal'),
             json_extract(value,'$.organizationId'),
             json_extract(value,'$.evidenceTier'),
             json_extract(value,'$.organizationStatus'),
             json_extract(value,'$.normalizedName'),
             json_extract(value,'$.countryCode'),
             json_extract(value,'$.normalizedLocality'),
             json_extract(value,'$.normalizedDomain'),
             json_extract(value,'$.selected'),
             json_extract(value,'$.candidateHash'),
             json_extract(value,'$.createdAt')
        FROM json_each(?)`
      )
      .bind(page)
  );
}

export function organizationEvidenceInserts(
  db: D1Database,
  rows: OrganizationEvidenceArtifact[]
) {
  return canonicalJsonPages(rows, "organization evidence").map((page) =>
    db
      .prepare(
        `INSERT INTO public_projection_organization_evidence (
        resolution_id,run_id,ordinal,organization_id,evidence_tier,
        evidence_kind,polarity,source_key,source_reference,observed_at,
        evidence_hash,created_at
      )
      SELECT json_extract(value,'$.resolutionId'),
             json_extract(value,'$.runId'),json_extract(value,'$.ordinal'),
             json_extract(value,'$.organizationId'),
             json_extract(value,'$.evidenceTier'),
             json_extract(value,'$.evidenceKind'),
             json_extract(value,'$.polarity'),
             json_extract(value,'$.sourceKey'),
             json_extract(value,'$.sourceReference'),
             json_extract(value,'$.observedAt'),
             json_extract(value,'$.evidenceHash'),
             json_extract(value,'$.createdAt')
        FROM json_each(?)`
      )
      .bind(page)
  );
}

export function locationResolutionInserts(
  db: D1Database,
  claim: ClaimedProjectionPosition,
  rows: LocationResolutionArtifact[],
  resolutionGuardToken: string
) {
  const persistedRows = rows.map(
    ({
      candidates: _candidates,
      evidence: _evidence,
      providerEvidence: _providerEvidence,
      ...row
    }) => row
  );
  return canonicalJsonPages(persistedRows, "location resolutions").map((page) =>
    db
      .prepare(
        `INSERT INTO public_projection_location_resolutions (
        id,run_id,position_item_id,ordinal,position_input_hash,literal_label,
        literal_evidence,normalized_label,semantic_kind,location_role,scope,
        workplace_type,asserted_country_code,state,reason_code,provider,
        selected_provider_place_id,proposed_canonical_location_id,
        display_name,country_code,region,locality,postal_code,latitude,
        longitude,bounds_json,feature_type,coordinate_kind,resolver_version,
        request_hash,response_hash,candidate_count,viable_candidate_count,
        candidate_digest,evidence_digest,resolution_hash,claim_lease_token,
        resolution_guard_token,queried_at,created_at
      )
      SELECT json_extract(value,'$.resolutionId'),
             json_extract(value,'$.runId'),?,json_extract(value,'$.ordinal'),?,
             json_extract(value,'$.literalLabel'),
             json_extract(value,'$.literalEvidence'),
             json_extract(value,'$.normalizedLabel'),
             json_extract(value,'$.semanticKind'),
             json_extract(value,'$.locationRole'),
             json_extract(value,'$.scope'),
             json_extract(value,'$.workplaceType'),
             json_extract(value,'$.assertedCountryCode'),
             json_extract(value,'$.state'),json_extract(value,'$.reasonCode'),
             json_extract(value,'$.provider'),
             json_extract(value,'$.selectedProviderPlaceId'),
             json_extract(value,'$.proposedCanonicalLocationId'),
             json_extract(value,'$.displayName'),
             json_extract(value,'$.countryCode'),json_extract(value,'$.region'),
             json_extract(value,'$.locality'),
             json_extract(value,'$.postalCode'),
             json_extract(value,'$.latitude'),
             json_extract(value,'$.longitude'),
             json_extract(value,'$.boundsJson'),
             json_extract(value,'$.featureType'),
             json_extract(value,'$.coordinateKind'),?,
             json_extract(value,'$.requestHash'),
             json_extract(value,'$.responseHash'),
             json_extract(value,'$.candidateCount'),
             json_extract(value,'$.viableCandidateCount'),
             json_extract(value,'$.candidateDigest'),
             json_extract(value,'$.evidenceDigest'),
             json_extract(value,'$.resolutionHash'),?,?,
             json_extract(value,'$.queriedAt'),json_extract(value,'$.createdAt')
        FROM json_each(?)`
      )
      .bind(
        claim.id,
        claim.inputHash,
        LOCATION_RESOLVER_VERSION,
        claim.leaseToken,
        resolutionGuardToken,
        page
      )
  );
}

export function locationProviderEvidenceInserts(
  db: D1Database,
  rows: ProviderEvidenceArtifact[]
) {
  return canonicalJsonPages(rows, "location provider evidence").map((page) =>
    db
      .prepare(
        `INSERT INTO public_projection_location_provider_evidence (
        resolution_id,run_id,provider,permanent,request_json,request_hash,
        response_json,response_hash,ordered_candidate_ids_json,queried_at,
        created_at
      )
      SELECT json_extract(value,'$.resolutionId'),
             json_extract(value,'$.runId'),json_extract(value,'$.provider'),
             json_extract(value,'$.permanent'),
             json_extract(value,'$.requestJson'),
             json_extract(value,'$.requestHash'),
             json_extract(value,'$.responseJson'),
             json_extract(value,'$.responseHash'),
             json_extract(value,'$.orderedCandidateIdsJson'),
             json_extract(value,'$.queriedAt'),json_extract(value,'$.createdAt')
        FROM json_each(?)`
      )
      .bind(page)
  );
}

export function locationCandidateInserts(
  db: D1Database,
  rows: LocationCandidateArtifact[]
) {
  return canonicalJsonPages(rows, "location candidates").map((page) =>
    db
      .prepare(
        `INSERT INTO public_projection_location_candidates (
        resolution_id,run_id,ordinal,provider_place_id,feature_type,
        preferred_name,full_name,country_code,region,locality,postal_code,
        longitude,latitude,bounds_json,coordinate_accuracy,context_json,
        match_code_json,provider_order,viable,candidate_hash,created_at
      )
      SELECT json_extract(value,'$.resolutionId'),
             json_extract(value,'$.runId'),json_extract(value,'$.ordinal'),
             json_extract(value,'$.providerPlaceId'),
             json_extract(value,'$.featureType'),
             json_extract(value,'$.preferredName'),
             json_extract(value,'$.fullName'),
             json_extract(value,'$.countryCode'),json_extract(value,'$.region'),
             json_extract(value,'$.locality'),
             json_extract(value,'$.postalCode'),
             json_extract(value,'$.longitude'),json_extract(value,'$.latitude'),
             json_extract(value,'$.boundsJson'),
             json_extract(value,'$.coordinateAccuracy'),
             json_extract(value,'$.contextJson'),
             json_extract(value,'$.matchCodeJson'),
             json_extract(value,'$.providerOrder'),
             json_extract(value,'$.viable'),
             json_extract(value,'$.candidateHash'),
             json_extract(value,'$.createdAt')
        FROM json_each(?)`
      )
      .bind(page)
  );
}

export function locationEvidenceInserts(
  db: D1Database,
  rows: LocationEvidenceArtifact[]
) {
  return canonicalJsonPages(rows, "location evidence").map((page) =>
    db
      .prepare(
        `INSERT INTO public_projection_location_evidence (
        resolution_id,run_id,ordinal,evidence_kind,source_reference,
        evidence_json,evidence_hash,created_at
      )
      SELECT json_extract(value,'$.resolutionId'),
             json_extract(value,'$.runId'),json_extract(value,'$.ordinal'),
             json_extract(value,'$.evidenceKind'),
             json_extract(value,'$.sourceReference'),
             json_extract(value,'$.evidenceJson'),
             json_extract(value,'$.evidenceHash'),
             json_extract(value,'$.createdAt')
        FROM json_each(?)`
      )
      .bind(page)
  );
}

export function transactionChangeAssertion(db: D1Database) {
  return db.prepare(
    `INSERT INTO transaction_assertions(must_equal_one)
     SELECT 0 WHERE changes()<>1`
  );
}

function canonicalJsonPages<T>(rows: T[], label: string) {
  if (rows.length === 0) {
    return [];
  }
  const pages: string[] = [];
  let pageRows: string[] = [];
  let pageBytes = 2;
  for (const row of rows) {
    const rowJson = canonicalJson(row);
    const rowBytes = encodedBytes(rowJson);
    if (rowBytes + 2 > MAX_D1_BOUND_JSON_BYTES) {
      throw new CanonicalResolutionInputError(
        "canonical_resolution_evidence_page_too_large",
        `One ${label} row exceeds the D1 bound-value limit`
      );
    }
    const separatorBytes = pageRows.length === 0 ? 0 : 1;
    if (
      pageRows.length > 0 &&
      pageBytes + separatorBytes + rowBytes > MAX_D1_BOUND_JSON_BYTES
    ) {
      pages.push(`[${pageRows.join(",")}]`);
      pageRows = [];
      pageBytes = 2;
    }
    pageRows.push(rowJson);
    pageBytes += (pageRows.length === 1 ? 0 : 1) + rowBytes;
  }
  pages.push(`[${pageRows.join(",")}]`);
  return pages;
}

function encodedBytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

export function canonicalSignalInsert(
  db: D1Database,
  input: {
    createdAt: string;
    locationIdsJson: string;
    locationSetHash: string;
    normalizedSubjectsJson: string;
    normalizedTitle: string;
    organizationResolutionHash: string;
    organizationResolutionId: string;
    positionItemId: string;
    roleFamily: string;
    runId: string;
    signalHash: string | null;
    signalPayloadHash: string;
    state: "blocked" | "resolved";
  }
) {
  return db
    .prepare(
      `INSERT INTO public_projection_canonical_identity_signals (
        run_id,position_item_id,organization_resolution_id,
        organization_resolution_hash,location_set_hash,role_family,
        normalized_title,normalized_subjects_json,location_ids_json,state,
        signal_hash,signal_payload_hash,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      input.runId,
      input.positionItemId,
      input.organizationResolutionId,
      input.organizationResolutionHash,
      input.locationSetHash,
      input.roleFamily,
      input.normalizedTitle,
      input.normalizedSubjectsJson,
      input.locationIdsJson,
      input.state,
      input.signalHash,
      input.signalPayloadHash,
      input.createdAt
    );
}

export function resolutionSealInsert(
  db: D1Database,
  claim: ClaimedProjectionPosition,
  input: {
    canonicalSignalHash: string | null;
    createdAt: string;
    duplicateBatchInputHash: string;
    locationCount: number;
    locationSetHash: string;
    organizationResolutionHash: string;
    organizationResolutionId: string;
    positionInputHash: string;
    positionItemId: string;
    reasonCode: string;
    runId: string;
    sealHash: string;
    sourcePositionId: string;
    state: ResolutionState;
  }
) {
  return db
    .prepare(
      `INSERT INTO public_projection_resolution_seals (
        run_id,position_item_id,source_position_id,position_input_hash,
        duplicate_batch_input_hash,organization_resolution_id,
        organization_resolution_hash,location_count,location_set_hash,
        canonical_signal_hash,state,reason_code,seal_hash,claim_lease_token,
        created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      input.runId,
      input.positionItemId,
      input.sourcePositionId,
      input.positionInputHash,
      input.duplicateBatchInputHash,
      input.organizationResolutionId,
      input.organizationResolutionHash,
      input.locationCount,
      input.locationSetHash,
      input.canonicalSignalHash,
      input.state,
      input.reasonCode,
      input.sealHash,
      claim.leaseToken,
      input.createdAt
    );
}
