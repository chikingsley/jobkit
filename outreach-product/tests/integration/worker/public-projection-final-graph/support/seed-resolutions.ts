import { readDuplicateBatch } from "../../../../../worker/repositories/public-projection-duplicate-comparisons";
import { finalizeStableDuplicateComparisons } from "../../../../../worker/services/public-projection/duplicate-comparisons";
import { canonicalJson } from "../../../../../worker/services/public-projection/hash";
import { fixtureHash } from "./fixtures";
import { type PositionFixture, testEnv, timestamp } from "./model";
import { seedOrganization } from "./seed-public";

export async function finishD2(runId: string) {
  for (let attempt = 0; attempt < 64; attempt += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: The helper proves the resumable D2 boundary reaches its seal.
    const result = await finalizeStableDuplicateComparisons(
      testEnv.DB,
      runId,
      timestamp
    );
    if (result.state === "complete") {
      const batch = await readDuplicateBatch(testEnv.DB, runId);
      if (batch) {
        return batch;
      }
    }
  }
  throw new Error(`D2 did not seal ${runId}`);
}

export async function seedCanonicalResolution(input: {
  batchInputHash: string;
  canonicalSignalHash: string;
  position: PositionFixture;
  runId: string;
}) {
  const leaseToken = `lease:${input.runId}:${input.position.itemId}`;
  const resolutionGuard = `guard:${input.runId}:${input.position.itemId}`;
  const hashes = {
    content: await fixtureHash(`content:${input.position.sourcePositionId}`),
    matchFacts: await fixtureHash(`match:${input.position.sourcePositionId}`),
    position: await fixtureHash(`position:${input.position.sourcePositionId}`),
    positionPayload: await fixtureHash(
      `payload:${input.position.sourcePositionId}`
    ),
  };
  const listing = await testEnv.DB.prepare(
    "SELECT material_hash FROM job_listings WHERE id=?"
  )
    .bind(input.position.listingId)
    .first<{ material_hash: string }>();
  const current = await testEnv.DB.prepare(
    "SELECT checkpoint_json FROM public_projection_position_items WHERE id=?"
  )
    .bind(input.position.itemId)
    .first<{ checkpoint_json: string }>();
  if (!(listing && current)) {
    throw new Error("Missing canonical fixture inputs");
  }
  const checkpoint = {
    ...(JSON.parse(current.checkpoint_json) as Record<string, unknown>),
    analysisHashes: {
      content: hashes.content,
      matchFacts: hashes.matchFacts,
      position: hashes.position,
    },
    materialHash: listing.material_hash,
    materialVersion: 1,
    positionPayloadHash: hashes.positionPayload,
    resolutionGuard,
  };
  await testEnv.DB.prepare(
    `UPDATE public_projection_position_items
        SET status='processing',attempt_count=attempt_count+1,
            lease_owner='final-graph-test',lease_token=?,
            lease_expires_at='2099-01-01T00:00:00.000Z',
            checkpoint_json=?,started_at=?,updated_at=?
      WHERE id=? AND run_id=? AND status='queued'`
  )
    .bind(
      leaseToken,
      canonicalJson(checkpoint),
      timestamp,
      timestamp,
      input.position.itemId,
      input.runId
    )
    .run();
  await seedOrganization();
  const organizationResolutionId = `org-resolution:${input.position.itemId}`;
  const organizationResolutionHash = await fixtureHash(
    organizationResolutionId
  );
  const locationResolutionId = `location-resolution:${input.position.itemId}`;
  const locationResolutionHash = await fixtureHash(locationResolutionId);
  const locationSetHash = await fixtureHash(
    `location-set:${input.position.sourcePositionId}`
  );
  const signalPayloadHash = await fixtureHash(
    `signal-payload:${input.position.sourcePositionId}`
  );
  const resolutionSealHash = await fixtureHash(
    `resolution-seal:${input.position.sourcePositionId}`
  );
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO public_projection_organization_resolutions (
        id,run_id,position_item_id,source_position_id,position_input_hash,
        duplicate_batch_input_hash,listing_id,material_version,material_hash,
        content_analysis_hash,match_facts_analysis_hash,position_analysis_hash,
        position_payload_hash,normalized_company_name,asserted_country_code,
        resolved_locality,state,selected_organization_id,
        selected_display_name,resolver_version,reason_code,candidate_count,
        evidence_count,candidate_digest,evidence_digest,resolution_hash,
        claim_lease_token,resolution_guard_token,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'example school','GE','Tbilisi',
        'resolved','fixture-organization','Example School',
        'organization-resolver-v1','organization_name_country_locality',
        0,0,?,?,?,?,?,?)`
    ).bind(
      organizationResolutionId,
      input.runId,
      input.position.itemId,
      input.position.sourcePositionId,
      input.position.inputHash,
      input.batchInputHash,
      input.position.listingId,
      1,
      listing.material_hash,
      hashes.content,
      hashes.matchFacts,
      hashes.position,
      hashes.positionPayload,
      await fixtureHash(`org-candidates:${input.position.sourcePositionId}`),
      await fixtureHash(`org-evidence:${input.position.sourcePositionId}`),
      organizationResolutionHash,
      leaseToken,
      resolutionGuard,
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO public_projection_location_resolutions (
        id,run_id,position_item_id,ordinal,position_input_hash,literal_label,
        literal_evidence,normalized_label,semantic_kind,location_role,scope,
        workplace_type,asserted_country_code,state,reason_code,provider,
        selected_provider_place_id,proposed_canonical_location_id,display_name,
        country_code,region,locality,postal_code,latitude,longitude,bounds_json,
        feature_type,coordinate_kind,resolver_version,request_hash,response_hash,
        candidate_count,viable_candidate_count,candidate_digest,evidence_digest,
        resolution_hash,claim_lease_token,resolution_guard_token,queried_at,
        created_at
      ) VALUES (?, ?, ?, 0, ?, 'Tbilisi, Georgia','fixture','tbilisi georgia',
        'city','worksite','locality','onsite','GE','resolved',
        'location_exact_provider_match','mapbox-geocoding-v6',
        'place.tbilisi','cloc_fixture_tbilisi','Tbilisi, Georgia','GE','',
        'Tbilisi','',41.7151,44.8271,NULL,'place','centroid',
        'mapbox-location-resolver-v1-us',?,?,0,0,?,?,?,?,?,?,?)`
    ).bind(
      locationResolutionId,
      input.runId,
      input.position.itemId,
      input.position.inputHash,
      await fixtureHash(`map-request:${input.position.sourcePositionId}`),
      await fixtureHash(`map-response:${input.position.sourcePositionId}`),
      await fixtureHash(
        `location-candidates:${input.position.sourcePositionId}`
      ),
      await fixtureHash(`location-evidence:${input.position.sourcePositionId}`),
      locationResolutionHash,
      leaseToken,
      resolutionGuard,
      timestamp,
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO public_projection_canonical_identity_signals (
        run_id,position_item_id,organization_resolution_id,
        organization_resolution_hash,location_set_hash,role_family,
        normalized_title,normalized_subjects_json,location_ids_json,state,
        signal_hash,signal_payload_hash,created_at
      ) VALUES (?,?,?,?,?,'english_language_teacher','english teacher','[]',?,
        'resolved',?,?,?)`
    ).bind(
      input.runId,
      input.position.itemId,
      organizationResolutionId,
      organizationResolutionHash,
      locationSetHash,
      canonicalJson(["cloc_fixture_tbilisi"]),
      input.canonicalSignalHash,
      signalPayloadHash,
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO public_projection_resolution_seals (
        run_id,position_item_id,source_position_id,position_input_hash,
        duplicate_batch_input_hash,organization_resolution_id,
        organization_resolution_hash,location_count,location_set_hash,
        canonical_signal_hash,state,reason_code,seal_hash,claim_lease_token,
        created_at
      ) VALUES (?,?,?,?,?,?,?,1,?,?,'resolved',
        'canonical_resolution_resolved',?,?,?)`
    ).bind(
      input.runId,
      input.position.itemId,
      input.position.sourcePositionId,
      input.position.inputHash,
      input.batchInputHash,
      organizationResolutionId,
      organizationResolutionHash,
      locationSetHash,
      input.canonicalSignalHash,
      resolutionSealHash,
      leaseToken,
      timestamp
    ),
  ]);
  await testEnv.DB.prepare(
    `UPDATE public_projection_position_items
        SET status='queued',lease_owner=NULL,lease_token=NULL,
            lease_expires_at=NULL,checkpoint_json=?,updated_at=?
      WHERE id=? AND run_id=? AND status='processing' AND lease_token=?`
  )
    .bind(
      canonicalJson({
        ...checkpoint,
        canonicalResolution: {
          canonicalSignalHash: input.canonicalSignalHash,
          locationCount: 1,
          locationSetHash,
          organizationResolutionHash,
          organizationResolutionId,
          reasonCode: "canonical_resolution_resolved",
          sealHash: resolutionSealHash,
          state: "resolved",
        },
      }),
      timestamp,
      input.position.itemId,
      input.runId,
      leaseToken
    )
    .run();
}
