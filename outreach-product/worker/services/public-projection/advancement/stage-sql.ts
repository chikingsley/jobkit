/**
 * Single source of truth for every SQL predicate that decides whether
 * projection stage work exists. The run selector (stage-machine.ts), the item
 * claim queries, the D2 boundary reader, and run completion all interpolate
 * these fragments, so "what the selector sees" and "what a consumer will
 * claim" cannot drift apart.
 *
 * Every builder takes the table alias it should qualify columns with, because
 * the same predicate is used both inside correlated EXISTS subqueries and in
 * UPDATE statements that cannot alias their target table.
 */

/** A listing item a stage consumer is able to claim right now. */
export function claimableListingItemSql(item: string) {
  return `${item}.status='queued' AND ${item}.attempt_count<${item}.max_attempts`;
}

/** A position item a stage consumer is able to claim right now. */
export function claimablePositionItemSql(item: string) {
  return `${item}.status='queued' AND ${item}.attempt_count<${item}.max_attempts`;
}

/** A listing item that still owes the run terminal accounting. */
export function activeListingItemSql(item: string) {
  return `${item}.status IN ('queued','processing','waiting_analysis')`;
}

/** An identity-stage position item that still owes terminal accounting. */
export function activeIdentityPositionItemSql(item: string) {
  return `${item}.stage='identity'
    AND ${item}.status IN ('queued','processing','waiting_analysis')`;
}

/** A position item inside the stable D2 canonical-resolution cohort. */
export function stableCanonicalResolutionPositionSql(item: string) {
  return `${item}.stage='canonical_resolution' AND ${item}.status='queued'`;
}

/**
 * The canonical-resolution work gate: the position still lacks a resolution
 * seal and belongs to the pending sealed D2 batch under its exact member
 * snapshot. Shared verbatim by the claim query and the run selector.
 */
export function unsealedCanonicalResolutionGateSql(item: string) {
  return `NOT EXISTS (
    SELECT 1 FROM public_projection_resolution_seals seal
     WHERE seal.run_id=${item}.run_id
       AND seal.position_item_id=${item}.id
  )
  AND EXISTS (
    SELECT 1
      FROM public_projection_duplicate_batches batch
      JOIN public_projection_duplicate_batch_members member
        ON member.run_id=batch.run_id
     WHERE batch.run_id=${item}.run_id
       AND batch.canonical_identity_state='pending'
       AND member.position_item_id=${item}.id
       AND member.source_position_id=${item}.source_position_id
       AND member.input_hash=${item}.input_hash
  )`;
}

/** The run already sealed its D2 duplicate-comparison batch. */
export function duplicateBatchExistsSql(run: string) {
  return `EXISTS (
    SELECT 1 FROM public_projection_duplicate_batches batch
     WHERE batch.run_id=${run}.id
  )`;
}

/** The run's D2 batch is sealed and still awaits canonical identity. */
export function pendingDuplicateBatchExistsSql(run: string) {
  return `EXISTS (
    SELECT 1 FROM public_projection_duplicate_batches batch
     WHERE batch.run_id=${run}.id
       AND batch.canonical_identity_state='pending'
  )`;
}

/** Some sealed D2 member still lacks its canonical resolution seal. */
export function unsealedDuplicateMemberExistsSql(run: string) {
  return `EXISTS (
    SELECT 1 FROM public_projection_duplicate_batch_members member
     WHERE member.run_id=${run}.id
       AND NOT EXISTS (
         SELECT 1 FROM public_projection_resolution_seals seal
          WHERE seal.run_id=member.run_id
            AND seal.position_item_id=member.position_item_id
       )
  )`;
}

/** The run recorded its final duplicate-graph seal (D3 complete). */
export function finalDuplicateSealExistsSql(run: string) {
  return `EXISTS (
    SELECT 1 FROM public_projection_final_duplicate_seals seal
     WHERE seal.run_id=${run}.id
  )`;
}

/** The run recorded its candidate seal (D4 complete). */
export function candidateSealExistsSql(run: string) {
  return `EXISTS (
    SELECT 1 FROM public_projection_candidate_seals seal
     WHERE seal.run_id=${run}.id
  )`;
}
