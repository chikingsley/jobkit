import { z } from "zod";
import {
  materialCloneSignal,
  sourceReferenceSignal,
} from "../../../src/features/public/identity-signals";
import {
  claimDuplicateWork,
  type DuplicateBatchSnapshot,
  type DuplicateMemberSnapshot,
  type DuplicateSignalEvidence,
  type DuplicateWorkSnapshot,
  type ExistingPublicDuplicateComparison,
  initializeDuplicateWork,
  PUBLIC_DUPLICATE_MAX_BINDING_BYTES as MAX_BINDING_BYTES,
  PUBLIC_DUPLICATE_RETRIEVAL_VERSION,
  readDuplicateBatch,
  type SameRunDuplicateComparison,
  sealDuplicateBatch,
  storeDuplicateComparisonPage,
  storeDuplicateMemberPage,
} from "../../repositories/public-projection-duplicate-comparisons";
import {
  canonicalJson,
  canonicalSha256,
  compareUtf8Bytes,
  sha256Hex,
} from "./hash";

export const PUBLIC_DUPLICATE_PAGE_SIZE = 25;
const MAX_PHASE_STEPS_PER_INVOCATION = 4;

const MAX_MEMBER_FIELD_BYTES = 8192;

const IdentityCheckpointSchema = z
  .object({
    identity: z
      .object({
        signals: z.array(
          z.object({
            hash: z.string().length(64),
            kind: z.enum(["material_clone_v1", "source_reference_v1"]),
          })
        ),
        sourcePosition: z.object({
          id: z.string().min(1),
          positionKey: z.string().min(1),
        }),
        state: z.literal("derived"),
      })
      .passthrough(),
    listingInputHash: z.string().length(64),
  })
  .passthrough();

interface BoundaryRow {
  active_identity_count: number;
  active_listing_count: number;
  canonical_count: number;
  mode: string;
  run_id: string;
  selection_complete: number;
  status: string;
}

interface PositionRow {
  checkpoint_json: string;
  current_material_hash: string;
  current_material_version: number;
  input_hash: string;
  listing_id: string;
  listing_input_hash: string;
  material_hash: string;
  material_json: string;
  material_version: number;
  position_item_id: string;
  position_key: string;
  source_key: string;
  source_position_id: string;
}

interface ExistingMappingRow {
  input_hash: string;
  mapping_version: number;
  owner_position_item_id: string;
  public_job_id: string;
  public_job_version: number;
  redirect_is_terminal: number;
  redirect_root_id: string;
  source_position_id: string;
}

interface SameRunCandidateRow {
  left_input_hash: string;
  left_listing_id: string;
  left_material_signal_hash: string;
  left_position_item_id: string;
  left_position_key: string;
  left_source_key: string;
  left_source_position_id: string;
  left_source_reference: string;
  left_source_reference_signal_hash: null | string;
  right_input_hash: string;
  right_listing_id: string;
  right_material_signal_hash: string;
  right_position_item_id: string;
  right_position_key: string;
  right_source_key: string;
  right_source_position_id: string;
  right_source_reference: string;
  right_source_reference_signal_hash: null | string;
}

interface StablePosition {
  inputHash: string;
  listingId: string;
  materialSignalHash: string;
  positionItemId: string;
  positionKey: string;
  sourceKey: string;
  sourcePositionId: string;
  sourceReference: string;
  sourceReferenceSignalHash: null | string;
}

export class DuplicateComparisonSnapshotError extends Error {
  readonly code = "duplicate_pair_input_snapshot_changed";

  constructor(message: string) {
    super(message);
    this.name = "DuplicateComparisonSnapshotError";
  }
}

export async function finalizeStableDuplicateComparisons(
  db: D1Database,
  runId: string,
  timestamp: string
) {
  const existingBatch = await readDuplicateBatch(db, runId);
  if (existingBatch) {
    return completeResult(existingBatch.comparisonCount, 0, true);
  }

  const boundary = await readStableBoundary(db, runId);
  if (!boundary) {
    throw new DuplicateComparisonSnapshotError(
      "The duplicate comparison run is unavailable"
    );
  }
  if (
    boundary.mode !== "shadow" ||
    boundary.status !== "running" ||
    boundary.selection_complete !== 1 ||
    boundary.active_listing_count > 0 ||
    boundary.active_identity_count > 0
  ) {
    return pendingResult(0, 0);
  }

  const [memberDigest, comparisonDigest] = await Promise.all([
    sha256Hex("jobkit-projection-duplicate-member-stream/v1"),
    sha256Hex("jobkit-projection-duplicate-comparison-stream/v1"),
  ]);
  await initializeDuplicateWork(db, {
    comparisonDigest,
    expectedMemberCount: boundary.canonical_count,
    memberDigest,
    runId,
    timestamp,
  });

  let comparisonsCreated = 0;
  for (let step = 0; step < MAX_PHASE_STEPS_PER_INVOCATION; step += 1) {
    const leaseToken = crypto.randomUUID();
    // biome-ignore lint/performance/noAwaitInLoops: Each phase owns one durable cursor transition and must commit before the next phase is claimed.
    const work = await claimDuplicateWork(db, {
      leaseToken,
      runId,
      timestamp,
    });
    if (!work) {
      return pendingResult(0, comparisonsCreated);
    }
    const outcome = await processWorkPhase(db, work, leaseToken, timestamp);
    comparisonsCreated += outcome.comparisonsCreated;
    if (outcome.batch) {
      return completeResult(
        outcome.batch.comparisonCount,
        comparisonsCreated,
        false
      );
    }
    if (!outcome.phaseAdvanced) {
      return pendingResult(outcome.comparisonCount, comparisonsCreated);
    }
  }
  return pendingResult(0, comparisonsCreated);
}

export function shadowDuplicateMemberKey(input: {
  inputHash: string;
  positionItemId: string;
  runId: string;
}) {
  return `shadow:${input.runId}:${input.positionItemId}:${input.inputHash}`;
}

export function publicDuplicateMemberKey(input: {
  publicJobVersion: number;
  redirectRootId: string;
}) {
  return `public:${input.redirectRootId}:${input.publicJobVersion}`;
}

export async function duplicateComparisonId(
  leftMemberKey: string,
  rightMemberKey: string
) {
  const [lower, higher] =
    compareUtf8Bytes(leftMemberKey, rightMemberKey) <= 0
      ? [leftMemberKey, rightMemberKey]
      : [rightMemberKey, leftMemberKey];
  return `pdup_v1_${await sha256Hex(
    `jobkit-projection-duplicate-pair/v1\0${lower}\0${higher}`
  )}`;
}

async function processWorkPhase(
  db: D1Database,
  work: DuplicateWorkSnapshot,
  leaseToken: string,
  timestamp: string
) {
  switch (work.phase) {
    case "members":
      return processMemberPage(db, work, leaseToken, timestamp);
    case "existing_public":
      return processExistingPublicPage(db, work, leaseToken, timestamp);
    case "same_run":
      return processSameRunPage(db, work, leaseToken, timestamp);
    case "ready": {
      const batch: DuplicateBatchSnapshot = {
        comparisonCount: work.comparisonCount,
        comparisonDigest: work.comparisonDigest,
        createdAt: work.createdAt,
        inputHash: await canonicalSha256({
          comparisonCount: work.comparisonCount,
          comparisonDigest: work.comparisonDigest,
          contractVersion: 2,
          memberDigest: work.memberDigest,
          positionMemberCount: work.memberCount,
          retrievalAlgorithmVersion: PUBLIC_DUPLICATE_RETRIEVAL_VERSION,
        }),
        memberDigest: work.memberDigest,
        positionMemberCount: work.memberCount,
        runId: work.runId,
      };
      await sealDuplicateBatch(db, { batch, leaseToken, timestamp });
      return {
        batch,
        comparisonCount: batch.comparisonCount,
        comparisonsCreated: 0,
        phaseAdvanced: true,
      };
    }
    case "sealed": {
      const batch = await readDuplicateBatch(db, work.runId);
      if (!batch) {
        throw new Error("Sealed duplicate work is missing its batch");
      }
      return {
        batch,
        comparisonCount: batch.comparisonCount,
        comparisonsCreated: 0,
        phaseAdvanced: false,
      };
    }
    default:
      throw new Error(`Unsupported duplicate work phase: ${work.phase}`);
  }
}

async function processMemberPage(
  db: D1Database,
  work: DuplicateWorkSnapshot,
  leaseToken: string,
  timestamp: string
) {
  const rows = await readStablePositionPage(db, work.runId, work.memberCursor);
  const pageRows = rows.slice(0, PUBLIC_DUPLICATE_PAGE_SIZE);
  const stable = await Promise.all(pageRows.map(positionFromRow));
  const members = stable.map((position, index) => ({
    ...position,
    ordinal: work.memberCount + index,
    runId: work.runId,
  }));
  assertBoundedChunk(members, "duplicate member");
  const hasMore = rows.length > pageRows.length;
  const nextMemberCount = work.memberCount + members.length;
  if (!hasMore && nextMemberCount !== work.expectedMemberCount) {
    throw new DuplicateComparisonSnapshotError(
      "The stable duplicate position set changed during member capture"
    );
  }
  const digest = await streamDigest(
    work.memberDigest,
    "members",
    members.map(memberDigestRecord)
  );
  await storeDuplicateMemberPage(db, {
    digest,
    leaseToken,
    members,
    nextCursor: members.at(-1)?.positionItemId ?? work.memberCursor,
    nextPhase: hasMore ? "members" : "existing_public",
    runId: work.runId,
    timestamp,
  });
  return {
    batch: null,
    comparisonCount: work.comparisonCount,
    comparisonsCreated: 0,
    phaseAdvanced: !hasMore,
  };
}

async function processExistingPublicPage(
  db: D1Database,
  work: DuplicateWorkSnapshot,
  leaseToken: string,
  timestamp: string
) {
  const rows = await readExistingPublicPage(
    db,
    work.runId,
    work.existingPublicCursor
  );
  const page = rows.slice(0, PUBLIC_DUPLICATE_PAGE_SIZE);
  const comparisons = await Promise.all(
    page.map((row) => existingPublicComparison(work, row))
  );
  assertBoundedChunk(comparisons, "existing-public comparison");
  const hasMore = rows.length > page.length;
  const digest = await streamDigest(
    work.comparisonDigest,
    "existing_public",
    comparisons
  );
  await storeDuplicateComparisonPage(db, {
    comparisons,
    digest,
    leaseToken,
    nextCursor: {
      owner: page.at(-1)?.owner_position_item_id ?? work.existingPublicCursor,
      target: "",
    },
    nextPhase: hasMore ? "existing_public" : "same_run",
    phase: "existing_public",
    runId: work.runId,
    timestamp,
  });
  return {
    batch: null,
    comparisonCount: work.comparisonCount + comparisons.length,
    comparisonsCreated: comparisons.length,
    phaseAdvanced: !hasMore,
  };
}

async function processSameRunPage(
  db: D1Database,
  work: DuplicateWorkSnapshot,
  leaseToken: string,
  timestamp: string
) {
  const rows = await readSameRunCandidatePage(db, work);
  const page = rows.slice(0, PUBLIC_DUPLICATE_PAGE_SIZE);
  const comparisons = (
    await Promise.all(
      page.map((row) => sameRunComparison(work, candidateFromRow(row)))
    )
  ).filter(isPresent);
  assertBoundedChunk(comparisons, "same-run comparison");
  const hasMore = rows.length > page.length;
  const digest = await streamDigest(
    work.comparisonDigest,
    "same_run",
    comparisons
  );
  const last = page.at(-1);
  await storeDuplicateComparisonPage(db, {
    comparisons,
    digest,
    leaseToken,
    nextCursor: {
      owner: last?.left_position_item_id ?? work.sameRunOwnerCursor,
      target: last?.right_position_item_id ?? work.sameRunTargetCursor,
    },
    nextPhase: hasMore ? "same_run" : "ready",
    phase: "same_run",
    runId: work.runId,
    timestamp,
  });
  return {
    batch: null,
    comparisonCount: work.comparisonCount + comparisons.length,
    comparisonsCreated: comparisons.length,
    phaseAdvanced: !hasMore,
  };
}

function readStableBoundary(db: D1Database, runId: string) {
  return db
    .prepare(
      `SELECT run.id run_id,run.mode,run.status,run.selection_complete,
              (SELECT COUNT(*) FROM public_projection_listing_items item
                WHERE item.run_id=run.id AND item.status IN (
                  'queued','processing','waiting_analysis'
                )) active_listing_count,
              (SELECT COUNT(*) FROM public_projection_position_items item
                WHERE item.run_id=run.id AND item.stage='identity'
                  AND item.status IN (
                    'queued','processing','waiting_analysis'
                  )) active_identity_count,
              (SELECT COUNT(*) FROM public_projection_position_items item
                WHERE item.run_id=run.id
                  AND item.stage='canonical_resolution'
                  AND item.status='queued') canonical_count
         FROM public_projection_runs run WHERE run.id=? LIMIT 1`
    )
    .bind(runId)
    .first<BoundaryRow>();
}

async function readStablePositionPage(
  db: D1Database,
  runId: string,
  cursor: string
) {
  const result = await db
    .prepare(
      `SELECT item.id position_item_id,item.source_position_id,item.input_hash,
              item.checkpoint_json,source_position.source_key,
              source_position.position_key,listing_item.listing_id,
              listing_item.material_version,listing_item.input_hash
                listing_input_hash,version.material_hash,version.material_json,
              listing.material_version current_material_version,
              listing.material_hash current_material_hash
         FROM public_projection_position_items item
         JOIN job_source_positions source_position
           ON source_position.id=item.source_position_id
         JOIN public_projection_listing_items listing_item
           ON listing_item.id=item.listing_item_id
          AND listing_item.run_id=item.run_id
         JOIN job_listing_versions version
           ON version.listing_id=listing_item.listing_id
          AND version.material_version=listing_item.material_version
         JOIN job_listings listing ON listing.id=listing_item.listing_id
        WHERE item.run_id=? AND item.stage='canonical_resolution'
          AND item.status='queued' AND item.id>?
        ORDER BY item.id LIMIT ?`
    )
    .bind(runId, cursor, PUBLIC_DUPLICATE_PAGE_SIZE + 1)
    .all<PositionRow>();
  return result.results;
}

async function positionFromRow(row: PositionRow): Promise<StablePosition> {
  const checkpoint = IdentityCheckpointSchema.safeParse(
    parseJson(row.checkpoint_json)
  );
  const material = parseJson(row.material_json) as {
    sourceReference?: unknown;
  } | null;
  if (
    !checkpoint.success ||
    checkpoint.data.listingInputHash !== row.listing_input_hash ||
    checkpoint.data.identity.sourcePosition.id !== row.source_position_id ||
    checkpoint.data.identity.sourcePosition.positionKey !== row.position_key ||
    row.listing_input_hash !== row.material_hash ||
    row.material_version !== row.current_material_version ||
    row.material_hash !== row.current_material_hash ||
    !material ||
    typeof material.sourceReference !== "string"
  ) {
    throw new DuplicateComparisonSnapshotError(
      `The duplicate input snapshot changed for ${row.position_item_id}`
    );
  }
  const sourceReference = normalizeIdentifier(material.sourceReference);
  const expectedSignals = [await materialCloneSignal(row.material_hash)];
  if (sourceReference) {
    expectedSignals.push(
      await sourceReferenceSignal({
        sourceKey: row.source_key,
        sourceReference,
      })
    );
  }
  expectedSignals.sort((left, right) =>
    compareUtf8Bytes(left.kind, right.kind)
  );
  if (
    canonicalJson(checkpoint.data.identity.signals) !==
    canonicalJson(expectedSignals)
  ) {
    throw new DuplicateComparisonSnapshotError(
      `The identity signals changed for ${row.position_item_id}`
    );
  }
  const materialSignal = expectedSignals.find(
    (signal) => signal.kind === "material_clone_v1"
  );
  const referenceSignal = expectedSignals.find(
    (signal) => signal.kind === "source_reference_v1"
  );
  const position = {
    inputHash: row.input_hash,
    listingId: row.listing_id,
    materialSignalHash: materialSignal?.hash ?? "",
    positionItemId: row.position_item_id,
    positionKey: row.position_key,
    sourceKey: normalizeIdentifier(row.source_key),
    sourcePositionId: row.source_position_id,
    sourceReference,
    sourceReferenceSignalHash: referenceSignal?.hash ?? null,
  };
  assertBoundedFields(position);
  return position;
}

async function readExistingPublicPage(
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

async function existingPublicComparison(
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

async function readSameRunCandidatePage(
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

function candidateFromRow(row: SameRunCandidateRow) {
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

async function sameRunComparison(
  work: DuplicateWorkSnapshot,
  candidate: { left: StablePosition; right: StablePosition }
) {
  const { left, right } = candidate;
  const classified = classifyStablePair(left, right);
  if (!classified) {
    return null;
  }
  return {
    conflictingSignals: sortSignals(classified.conflictingSignals),
    createdAt: work.createdAt,
    id: await duplicateComparisonId(
      shadowDuplicateMemberKey({
        inputHash: left.inputHash,
        positionItemId: left.positionItemId,
        runId: work.runId,
      }),
      shadowDuplicateMemberKey({
        inputHash: right.inputHash,
        positionItemId: right.positionItemId,
        runId: work.runId,
      })
    ),
    matchingSignals: matchingSignals(left, right),
    ownerInputHash: left.inputHash,
    ownerPositionItemId: left.positionItemId,
    ownerSourcePositionId: left.sourcePositionId,
    reasonCode: classified.reasonCode,
    relation: classified.relation,
    runId: work.runId,
    target: {
      inputHash: right.inputHash,
      kind: "same_run",
      positionItemId: right.positionItemId,
      sourcePositionId: right.sourcePositionId,
    },
  } satisfies SameRunDuplicateComparison;
}

function matchingSignals(
  left: StablePosition,
  right: StablePosition
): DuplicateSignalEvidence[] {
  const signals: DuplicateSignalEvidence[] = [];
  if (left.listingId === right.listingId) {
    signals.push({ kind: "listing_id_v1", value: left.listingId });
  }
  if (
    left.sourceKey === right.sourceKey &&
    left.positionKey === right.positionKey &&
    left.sourceReference &&
    left.sourceReference === right.sourceReference &&
    left.sourceReferenceSignalHash
  ) {
    signals.push(
      { kind: "position_key_v1", value: left.positionKey },
      { kind: "source_key_v1", value: left.sourceKey },
      { hash: left.sourceReferenceSignalHash, kind: "source_reference_v1" }
    );
  }
  if (
    left.positionKey === right.positionKey &&
    left.materialSignalHash === right.materialSignalHash
  ) {
    signals.push(
      { hash: left.materialSignalHash, kind: "material_clone_v1" },
      { kind: "position_key_v1", value: left.positionKey }
    );
  }
  return sortSignals(signals);
}

function classifyStablePair(
  left: StablePosition,
  right: StablePosition
): {
  conflictingSignals: DuplicateSignalEvidence[];
  reasonCode:
    | "conflicting_stable_identifier"
    | "same_listing_distinct_position"
    | "same_source_reference_position";
  relation: "different" | "same";
} | null {
  if (
    left.listingId === right.listingId &&
    left.positionKey !== right.positionKey
  ) {
    return {
      conflictingSignals: [
        {
          kind: "position_key_v1",
          ownerValue: left.positionKey,
          targetValue: right.positionKey,
        },
      ],
      reasonCode: "same_listing_distinct_position",
      relation: "different",
    };
  }
  if (
    left.sourceKey === right.sourceKey &&
    left.positionKey === right.positionKey &&
    left.sourceReference &&
    right.sourceReference &&
    left.sourceReference !== right.sourceReference
  ) {
    return {
      conflictingSignals: [
        {
          kind: "source_reference_v1",
          ownerValue: left.sourceReference,
          targetValue: right.sourceReference,
        },
      ],
      reasonCode: "conflicting_stable_identifier",
      relation: "different",
    };
  }
  if (
    left.sourceKey === right.sourceKey &&
    left.positionKey === right.positionKey &&
    left.sourceReference &&
    left.sourceReference === right.sourceReference
  ) {
    return {
      conflictingSignals: [],
      reasonCode: "same_source_reference_position",
      relation: "same",
    };
  }
  return null;
}

function streamDigest(
  previousDigest: string,
  phase: string,
  records: unknown[]
) {
  if (records.length === 0) {
    return previousDigest;
  }
  return canonicalSha256({ phase, previousDigest, records });
}

function memberDigestRecord(member: DuplicateMemberSnapshot) {
  return {
    inputHash: member.inputHash,
    listingId: member.listingId,
    materialSignalHash: member.materialSignalHash,
    ordinal: member.ordinal,
    positionItemId: member.positionItemId,
    positionKey: member.positionKey,
    sourceKey: member.sourceKey,
    sourcePositionId: member.sourcePositionId,
    sourceReference: member.sourceReference,
    sourceReferenceSignalHash: member.sourceReferenceSignalHash,
  };
}

function assertBoundedChunk(value: unknown[], label: string) {
  if (value.length > PUBLIC_DUPLICATE_PAGE_SIZE) {
    throw new Error(`${label} page exceeded its fixed row limit`);
  }
  const { byteLength } = new TextEncoder().encode(canonicalJson(value));
  if (byteLength > MAX_BINDING_BYTES) {
    throw new DuplicateComparisonSnapshotError(
      `The ${label} page exceeds the fixed D1 binding limit`
    );
  }
}

function assertBoundedFields(value: object) {
  for (const field of Object.values(value)) {
    if (
      typeof field === "string" &&
      new TextEncoder().encode(field).byteLength > MAX_MEMBER_FIELD_BYTES
    ) {
      throw new DuplicateComparisonSnapshotError(
        "A duplicate snapshot field exceeds the accepted row limit"
      );
    }
  }
}

function completeResult(
  comparisonCount: number,
  comparisonsCreated: number,
  replayed: boolean
) {
  return {
    comparisonCount,
    comparisonsCreated,
    replayed,
    state: "complete" as const,
  };
}

function pendingResult(comparisonCount: number, comparisonsCreated: number) {
  return {
    comparisonCount,
    comparisonsCreated,
    replayed: false,
    state: "pending" as const,
  };
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

function sortSignals(signals: DuplicateSignalEvidence[]) {
  const unique = new Map(
    signals.map((signal) => [JSON.stringify(signal), signal] as const)
  );
  return [...unique.values()].sort((left, right) =>
    compareUtf8Bytes(JSON.stringify(left), JSON.stringify(right))
  );
}

function normalizeIdentifier(value: string) {
  return value.normalize("NFKC").trim();
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
