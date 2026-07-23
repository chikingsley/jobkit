import {
  materialCloneSignal,
  sourceReferenceSignal,
} from "../../../../src/features/public/identity-signals";
import {
  type DuplicateWorkSnapshot,
  storeDuplicateComparisonPage,
  storeDuplicateMemberPage,
} from "../../../repositories/public-projection-duplicate-comparisons";
import { canonicalJson, compareUtf8Bytes } from "../hash";
import {
  candidateFromRow,
  existingPublicComparison,
  readExistingPublicPage,
  readSameRunCandidatePage,
} from "./candidates";
import {
  assertBoundedChunk,
  assertBoundedFields,
  isPresent,
  memberDigestRecord,
  normalizeIdentifier,
  parseJson,
  sameRunComparison,
  streamDigest,
} from "./classification";
import {
  type BoundaryRow,
  DuplicateComparisonSnapshotError,
  IdentityCheckpointSchema,
  type PositionRow,
  PUBLIC_DUPLICATE_PAGE_SIZE,
  type StablePosition,
} from "./model";

export async function processMemberPage(
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

export async function processExistingPublicPage(
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

export async function processSameRunPage(
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

export function readStableBoundary(db: D1Database, runId: string) {
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
