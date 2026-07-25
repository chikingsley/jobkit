import type {
  DuplicateWorkSnapshot,
  ExistingPublicDuplicateComparison,
} from "../../../repositories/public-projection-duplicate-comparisons";
import {
  duplicateComparisonId,
  publicDuplicateMemberKey,
  shadowDuplicateMemberKey,
} from "../duplicate-comparisons";
import { assertBoundedFields } from "./classification";
import {
  DuplicateComparisonSnapshotError,
  type ExistingMappingRow,
  PUBLIC_DUPLICATE_PAGE_SIZE,
  type SameRunCandidateRow,
  type StablePosition,
} from "./model";

export async function readExistingPublicPage(
  db: D1Database,
  runId: string,
  cursor: string
) {
  const result = await db
    .prepare(
      `WITH RECURSIVE
       page AS (
         SELECT member.position_item_id owner_position_item_id,
                member.source_position_id,member.input_hash,
                mapping.version mapping_version,mapping.public_job_id,
                public_head.current_version public_job_version
           FROM public_projection_duplicate_batch_members member
           JOIN job_source_position_mapping_heads mapping_head
             ON mapping_head.source_position_id=member.source_position_id
           JOIN job_source_position_mapping_versions mapping
             ON mapping.source_position_id=mapping_head.source_position_id
            AND mapping.version=mapping_head.current_version
            AND mapping.mapping_state='mapped'
           JOIN public_job_heads public_head
             ON public_head.public_job_id=mapping.public_job_id
          WHERE member.run_id=? AND member.position_item_id>?
          ORDER BY member.position_item_id LIMIT ?
       ),
       redirect_chain(
         owner_position_item_id,public_job_id,depth,path,is_terminal
       ) AS (
         SELECT page.owner_position_item_id,page.public_job_id,0,
                '|' || page.public_job_id || '|',
                NOT EXISTS (
                  SELECT 1 FROM public_job_eligibility_heads head
                  JOIN public_job_eligibility_decisions decision
                    ON decision.public_job_id=head.public_job_id
                   AND decision.decision_version=head.current_decision_version
                  WHERE head.public_job_id=page.public_job_id
                    AND decision.publication_state='merged'
                    AND decision.redirect_public_job_id IS NOT NULL
                )
           FROM page
         UNION ALL
         SELECT chain.owner_position_item_id,
                decision.redirect_public_job_id,chain.depth+1,
                chain.path || decision.redirect_public_job_id || '|',
                NOT EXISTS (
                  SELECT 1 FROM public_job_eligibility_heads next_head
                  JOIN public_job_eligibility_decisions next_decision
                    ON next_decision.public_job_id=next_head.public_job_id
                   AND next_decision.decision_version=
                       next_head.current_decision_version
                  WHERE next_head.public_job_id=decision.redirect_public_job_id
                    AND next_decision.publication_state='merged'
                    AND next_decision.redirect_public_job_id IS NOT NULL
                )
           FROM redirect_chain chain
           JOIN public_job_eligibility_heads head
             ON head.public_job_id=chain.public_job_id
           JOIN public_job_eligibility_decisions decision
             ON decision.public_job_id=head.public_job_id
            AND decision.decision_version=head.current_decision_version
          WHERE chain.is_terminal=0 AND chain.depth<100
            AND decision.publication_state='merged'
            AND decision.redirect_public_job_id IS NOT NULL
            AND instr(
              chain.path,'|' || decision.redirect_public_job_id || '|'
            )=0
       ),
       roots AS (
         SELECT *,ROW_NUMBER() OVER (
           PARTITION BY owner_position_item_id ORDER BY depth DESC
         ) root_rank FROM redirect_chain
       )
       SELECT page.*,roots.public_job_id redirect_root_id,
              roots.is_terminal redirect_is_terminal
         FROM page JOIN roots
           ON roots.owner_position_item_id=page.owner_position_item_id
          AND roots.root_rank=1
        ORDER BY page.owner_position_item_id`
    )
    .bind(runId, cursor, PUBLIC_DUPLICATE_PAGE_SIZE + 1)
    .all<ExistingMappingRow>();
  if (result.results.some((row) => row.redirect_is_terminal !== 1)) {
    throw new DuplicateComparisonSnapshotError(
      "A public duplicate target contains a redirect cycle"
    );
  }
  return result.results;
}

export async function existingPublicComparison(
  work: DuplicateWorkSnapshot,
  row: ExistingMappingRow
) {
  assertBoundedFields(row);
  return {
    conflictingSignals: [],
    createdAt: work.createdAt,
    id: await duplicateComparisonId(
      shadowDuplicateMemberKey({
        inputHash: row.input_hash,
        positionItemId: row.owner_position_item_id,
        runId: work.runId,
      }),
      publicDuplicateMemberKey({
        publicJobVersion: row.public_job_version,
        redirectRootId: row.redirect_root_id,
      })
    ),
    matchingSignals: [
      {
        kind: "source_position_mapping_v1",
        value: row.source_position_id,
        version: row.mapping_version,
      },
    ],
    ownerInputHash: row.input_hash,
    ownerPositionItemId: row.owner_position_item_id,
    ownerSourcePositionId: row.source_position_id,
    reasonCode: "same_source_position",
    relation: "same",
    runId: work.runId,
    target: {
      kind: "existing_public",
      publicJobId: row.public_job_id,
      publicJobVersion: row.public_job_version,
      redirectRootId: row.redirect_root_id,
    },
  } satisfies ExistingPublicDuplicateComparison;
}

export async function readSameRunCandidatePage(
  db: D1Database,
  work: DuplicateWorkSnapshot
) {
  const result = await db
    .prepare(
      `WITH
       listing_candidates(owner_id,target_id) AS (
         SELECT left_member.position_item_id,right_member.position_item_id
           FROM public_projection_duplicate_batch_members left_member
           JOIN public_projection_duplicate_batch_members right_member
             ON right_member.run_id=left_member.run_id
            AND right_member.listing_id=left_member.listing_id
            AND right_member.position_item_id>left_member.position_item_id
          WHERE left_member.run_id=?
            AND (
              left_member.position_item_id>?
              OR (
                left_member.position_item_id=?
                AND right_member.position_item_id>?
              )
            )
          ORDER BY left_member.position_item_id,right_member.position_item_id
          LIMIT ?
       ),
       source_reference_candidates(owner_id,target_id) AS (
         SELECT left_member.position_item_id,right_member.position_item_id
           FROM public_projection_duplicate_batch_members left_member
           JOIN public_projection_duplicate_batch_members right_member
             ON right_member.run_id=left_member.run_id
            AND right_member.source_key=left_member.source_key
            AND right_member.position_key=left_member.position_key
            AND right_member.source_reference=left_member.source_reference
            AND right_member.position_item_id>left_member.position_item_id
          WHERE left_member.run_id=? AND left_member.source_reference<>''
            AND (
              left_member.position_item_id>?
              OR (
                left_member.position_item_id=?
                AND right_member.position_item_id>?
              )
            )
          ORDER BY left_member.position_item_id,right_member.position_item_id
          LIMIT ?
       ),
       material_candidates(owner_id,target_id) AS (
         SELECT left_member.position_item_id,right_member.position_item_id
           FROM public_projection_duplicate_batch_members left_member
           JOIN public_projection_duplicate_batch_members right_member
             ON right_member.run_id=left_member.run_id
            AND right_member.material_signal_hash=
                left_member.material_signal_hash
            AND right_member.position_key=left_member.position_key
            AND right_member.position_item_id>left_member.position_item_id
          WHERE left_member.run_id=?
            AND (
              left_member.position_item_id>?
              OR (
                left_member.position_item_id=?
                AND right_member.position_item_id>?
              )
            )
          ORDER BY left_member.position_item_id,right_member.position_item_id
          LIMIT ?
       ),
       candidates(owner_id,target_id) AS (
         SELECT owner_id,target_id FROM listing_candidates
         UNION
         SELECT owner_id,target_id FROM source_reference_candidates
         UNION
         SELECT owner_id,target_id FROM material_candidates
       )
       SELECT left_member.position_item_id left_position_item_id,
              left_member.source_position_id left_source_position_id,
              left_member.input_hash left_input_hash,
              left_member.listing_id left_listing_id,
              left_member.source_key left_source_key,
              left_member.position_key left_position_key,
              left_member.source_reference left_source_reference,
              left_member.source_reference_signal_hash
                left_source_reference_signal_hash,
              left_member.material_signal_hash left_material_signal_hash,
              right_member.position_item_id right_position_item_id,
              right_member.source_position_id right_source_position_id,
              right_member.input_hash right_input_hash,
              right_member.listing_id right_listing_id,
              right_member.source_key right_source_key,
              right_member.position_key right_position_key,
              right_member.source_reference right_source_reference,
              right_member.source_reference_signal_hash
                right_source_reference_signal_hash,
              right_member.material_signal_hash right_material_signal_hash
         FROM candidates
         JOIN public_projection_duplicate_batch_members left_member
           ON left_member.run_id=?
          AND left_member.position_item_id=candidates.owner_id
         JOIN public_projection_duplicate_batch_members right_member
           ON right_member.run_id=left_member.run_id
          AND right_member.position_item_id=candidates.target_id
        ORDER BY candidates.owner_id,candidates.target_id
        LIMIT ?`
    )
    .bind(
      work.runId,
      work.sameRunOwnerCursor,
      work.sameRunOwnerCursor,
      work.sameRunTargetCursor,
      PUBLIC_DUPLICATE_PAGE_SIZE + 1,
      work.runId,
      work.sameRunOwnerCursor,
      work.sameRunOwnerCursor,
      work.sameRunTargetCursor,
      PUBLIC_DUPLICATE_PAGE_SIZE + 1,
      work.runId,
      work.sameRunOwnerCursor,
      work.sameRunOwnerCursor,
      work.sameRunTargetCursor,
      PUBLIC_DUPLICATE_PAGE_SIZE + 1,
      work.runId,
      PUBLIC_DUPLICATE_PAGE_SIZE + 1
    )
    .all<SameRunCandidateRow>();
  return result.results;
}

export function candidateFromRow(row: SameRunCandidateRow) {
  const left: StablePosition = {
    inputHash: row.left_input_hash,
    listingId: row.left_listing_id,
    materialSignalHash: row.left_material_signal_hash,
    positionItemId: row.left_position_item_id,
    positionKey: row.left_position_key,
    sourceKey: row.left_source_key,
    sourcePositionId: row.left_source_position_id,
    sourceReference: row.left_source_reference,
    sourceReferenceSignalHash: row.left_source_reference_signal_hash,
  };
  const right: StablePosition = {
    inputHash: row.right_input_hash,
    listingId: row.right_listing_id,
    materialSignalHash: row.right_material_signal_hash,
    positionItemId: row.right_position_item_id,
    positionKey: row.right_position_key,
    sourceKey: row.right_source_key,
    sourcePositionId: row.right_source_position_id,
    sourceReference: row.right_source_reference,
    sourceReferenceSignalHash: row.right_source_reference_signal_hash,
  };
  assertBoundedFields(left);
  assertBoundedFields(right);
  return { left, right };
}
