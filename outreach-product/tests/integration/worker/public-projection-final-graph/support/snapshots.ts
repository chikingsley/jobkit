import { canonicalJson } from "../../../../../worker/services/public-projection/hash";
import { testEnv } from "./model";

export async function liveGraphSnapshot() {
  const [
    jobs,
    aliases,
    versions,
    heads,
    versionLocations,
    decisions,
    decisionHeads,
    decisionSources,
    signals,
    mappingVersions,
    mappingHeads,
    allocations,
    catalogVersions,
    catalogHead,
    catalogSeals,
    catalogHistory,
    catalogMembers,
    searchIndex,
    searchTerms,
    browseLocations,
    outbox,
  ] = await Promise.all([
    testEnv.DB.prepare("SELECT * FROM public_jobs ORDER BY id").all(),
    testEnv.DB.prepare(
      "SELECT * FROM public_job_aliases ORDER BY public_job_id,slug"
    ).all(),
    testEnv.DB.prepare(
      "SELECT * FROM public_job_versions ORDER BY public_job_id,version"
    ).all(),
    testEnv.DB.prepare(
      "SELECT * FROM public_job_heads ORDER BY public_job_id"
    ).all(),
    testEnv.DB.prepare(
      `SELECT * FROM public_job_version_locations
        ORDER BY public_job_id,public_job_version,ordinal`
    ).all(),
    testEnv.DB.prepare(
      `SELECT * FROM public_job_eligibility_decisions
        ORDER BY public_job_id,decision_version`
    ).all(),
    testEnv.DB.prepare(
      `SELECT * FROM public_job_eligibility_heads
        ORDER BY public_job_id`
    ).all(),
    testEnv.DB.prepare(
      `SELECT * FROM public_job_decision_sources
        ORDER BY public_job_id,decision_version,source_position_id,
                 source_mapping_version`
    ).all(),
    testEnv.DB.prepare(
      `SELECT * FROM public_job_identity_signals
        ORDER BY public_job_id,public_job_version,signal_kind,signal_hash`
    ).all(),
    testEnv.DB.prepare(
      `SELECT * FROM job_source_position_mapping_versions
        ORDER BY source_position_id,version`
    ).all(),
    testEnv.DB.prepare(
      `SELECT * FROM job_source_position_mapping_heads
        ORDER BY source_position_id`
    ).all(),
    testEnv.DB.prepare(
      "SELECT * FROM public_job_allocations ORDER BY public_job_id"
    ).all(),
    testEnv.DB.prepare(
      "SELECT * FROM public_job_catalog_versions ORDER BY version"
    ).all(),
    testEnv.DB.prepare(
      "SELECT * FROM public_job_catalog_head_pointer ORDER BY singleton"
    ).all(),
    testEnv.DB.prepare(
      "SELECT * FROM public_job_catalog_seals ORDER BY catalog_version"
    ).all(),
    testEnv.DB.prepare(
      "SELECT * FROM public_job_catalog_head_history ORDER BY catalog_version"
    ).all(),
    testEnv.DB.prepare(
      `SELECT * FROM public_job_catalog_members
        ORDER BY public_job_id,valid_from_ordinal`
    ).all(),
    testEnv.DB.prepare(
      `SELECT * FROM public_job_search_index
        ORDER BY public_job_id,valid_from_ordinal`
    ).all(),
    testEnv.DB.prepare(
      `SELECT * FROM public_job_search_terms
        ORDER BY public_job_id,valid_from_ordinal,term`
    ).all(),
    testEnv.DB.prepare(
      `SELECT * FROM public_browse_job_locations
        ORDER BY public_job_id,valid_from_ordinal,ordinal`
    ).all(),
    testEnv.DB.prepare("SELECT * FROM work_outbox ORDER BY id").all(),
  ]);
  return canonicalJson({
    aliases: aliases.results,
    allocations: allocations.results,
    browseLocations: browseLocations.results,
    catalogHead: catalogHead.results,
    catalogHistory: catalogHistory.results,
    catalogMembers: catalogMembers.results,
    catalogSeals: catalogSeals.results,
    catalogVersions: catalogVersions.results,
    decisionHeads: decisionHeads.results,
    decisionSources: decisionSources.results,
    decisions: decisions.results,
    heads: heads.results,
    jobs: jobs.results,
    mappingHeads: mappingHeads.results,
    mappingVersions: mappingVersions.results,
    outbox: outbox.results,
    searchIndex: searchIndex.results,
    searchTerms: searchTerms.results,
    signals: signals.results,
    versionLocations: versionLocations.results,
    versions: versions.results,
  });
}

export async function finalGraphCounts(runId: string) {
  const row = await testEnv.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM public_projection_allocation_components
        WHERE run_id=?) components,
      (SELECT COUNT(*) FROM public_projection_allocation_members
        WHERE run_id=?) members,
      (SELECT COUNT(*) FROM public_projection_allocation_roots
        WHERE run_id=?) roots,
      (SELECT COUNT(*) FROM public_projection_allocation_relations
        WHERE run_id=?) allocations,
      (SELECT COUNT(*) FROM public_projection_final_duplicate_relations
        WHERE run_id=?) relations,
      (SELECT COUNT(*) FROM public_projection_final_canonical_live_inputs
        WHERE run_id=?) canonical_inputs,
      (SELECT COUNT(*) FROM public_projection_final_source_mapping_inputs
        WHERE run_id=?) mapping_inputs,
      (SELECT COUNT(*) FROM public_projection_final_duplicate_seals
        WHERE run_id=?) seals`
  )
    .bind(runId, runId, runId, runId, runId, runId, runId, runId)
    .first<{
      allocations: number;
      canonical_inputs: number;
      components: number;
      mapping_inputs: number;
      members: number;
      relations: number;
      roots: number;
      seals: number;
    }>();
  if (!row) {
    throw new Error(`Missing final graph count fixture ${runId}`);
  }
  return {
    allocations: row.allocations,
    canonicalInputs: row.canonical_inputs,
    components: row.components,
    mappingInputs: row.mapping_inputs,
    members: row.members,
    relations: row.relations,
    roots: row.roots,
    seals: row.seals,
  };
}
