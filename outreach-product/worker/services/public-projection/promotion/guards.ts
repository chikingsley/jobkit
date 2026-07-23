import type { PublicProjectionCandidate } from "../candidates/model";
import type { PreparedMapping } from "./model";

export function promotionGuardStatements(
  db: D1Database,
  input: {
    candidate: PublicProjectionCandidate;
    candidateHash: string;
    candidateSealDigest: string;
    catalogHeadVersion: string;
    mappings: PreparedMapping[];
  }
) {
  const mappingsJson = JSON.stringify(input.mappings);
  const statements = [
    assertion(
      db,
      1,
      `SELECT COUNT(*)
         FROM public_projection_candidate_results result
         JOIN public_projection_candidate_seals seal ON seal.run_id=result.run_id
        WHERE result.run_id=? AND result.allocation_id=?
          AND result.state='prepared' AND result.candidate_id=?
          AND result.candidate_hash=? AND seal.result_digest=?`,
      [
        input.candidate.runId,
        input.candidate.allocationId,
        input.candidate.candidateId,
        input.candidateHash,
        input.candidateSealDigest,
      ]
    ),
    assertion(
      db,
      0,
      `SELECT COUNT(*) FROM public_projection_promotion_manifests
        WHERE run_id=? AND allocation_id=?`,
      [input.candidate.runId, input.candidate.allocationId]
    ),
    assertion(
      db,
      1,
      `SELECT COUNT(*) FROM public_job_catalog_head_pointer
        WHERE singleton=1 AND current_version=?`,
      [input.catalogHeadVersion]
    ),
    assertion(
      db,
      input.mappings.length,
      `SELECT COUNT(*) FROM json_each(?) mapping
        JOIN source_publication_policy_heads head
          ON head.source_key=json_extract(mapping.value,'$.sourceKey')
         AND head.current_version=json_extract(mapping.value,'$.policyVersion')`,
      [mappingsJson]
    ),
    assertion(
      db,
      input.mappings.length,
      `SELECT COUNT(*) FROM json_each(?) mapping
        JOIN job_listings listing
          ON listing.id=json_extract(mapping.value,'$.listingId')
         AND listing.material_version=json_extract(
               mapping.value,'$.materialVersion'
             )
         AND listing.inventory_status='active'`,
      [mappingsJson]
    ),
    assertion(
      db,
      input.mappings.length,
      `SELECT COUNT(*) FROM json_each(?) mapping
        WHERE (
          json_type(mapping.value,'$.predecessorMappingVersion')='null'
          AND NOT EXISTS (
            SELECT 1 FROM job_source_position_mapping_heads head
             WHERE head.source_position_id=json_extract(
               mapping.value,'$.sourcePositionId'
             )
          )
        ) OR EXISTS (
          SELECT 1 FROM job_source_position_mapping_heads head
           WHERE head.source_position_id=json_extract(
             mapping.value,'$.sourcePositionId'
           )
             AND head.current_version=json_extract(
               mapping.value,'$.predecessorMappingVersion'
             )
        )`,
      [mappingsJson]
    ),
    ...publicJobPredecessorGuard(db, input.candidate),
  ];
  if (input.candidate.applicationRouteId) {
    statements.push(
      assertion(
        db,
        1,
        `SELECT COUNT(*) FROM application_routes route
          WHERE route.id=? AND route.status='active'
            AND EXISTS (
              SELECT 1 FROM json_each(?) mapping
               WHERE json_extract(mapping.value,'$.listingId')=route.job_id
            )`,
        [input.candidate.applicationRouteId, mappingsJson]
      )
    );
  }
  return statements;
}

function publicJobPredecessorGuard(
  db: D1Database,
  candidate: PublicProjectionCandidate
) {
  if (candidate.publicJobVersionPredecessor === null) {
    return [
      assertion(db, 0, "SELECT COUNT(*) FROM public_jobs WHERE id=?", [
        candidate.publicJobId,
      ]),
    ];
  }
  return [
    assertion(
      db,
      1,
      `SELECT COUNT(*) FROM public_job_heads content
        JOIN public_job_eligibility_heads decision
          ON decision.public_job_id=content.public_job_id
       WHERE content.public_job_id=? AND content.current_version=?
         AND decision.current_decision_version=?`,
      [
        candidate.publicJobId,
        candidate.publicJobVersionPredecessor,
        candidate.decision.predecessorVersion,
      ]
    ),
  ];
}

export function assertion(
  db: D1Database,
  expected: number,
  countSql: string,
  bindings: unknown[]
) {
  return db
    .prepare(
      `INSERT INTO public_projection_final_assertions (
        expected_changes,actual_changes
      ) SELECT ?,(${countSql})`
    )
    .bind(expected, ...bindings);
}
