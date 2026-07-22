import {
  readCurrentSourceMappings,
  readFinalGraphMemberPage,
} from "../../../repositories/public-projection-final-graph";
import { commitFinalWorkPage } from "../../../repositories/public-projection-final-work/controller";
import {
  assertMappingInputPagePinned,
  insertMappingInputPageStatement,
  insertResolutionInputPageStatement,
  readResolvedWorkSourcePage,
} from "../../../repositories/public-projection-final-work/inputs";
import { encodedJsonBytes } from "../../../repositories/public-projection-final-work/shared";
import {
  type FinalWorkClaim,
  type FinalWorkMappingInput,
  type FinalWorkResolutionInput,
  PUBLIC_FINAL_WORK_PAGE_SIZE,
} from "../../../repositories/public-projection-final-work/types";
import { canonicalJson, canonicalSha256 } from "../hash";
import { finalChangeAssertion } from "./boundary";
import { shadowMember } from "./identity";
import {
  type FinalBoundaryContext,
  FinalDuplicateSnapshotError,
} from "./model";
import {
  appendFinalPhaseDigest,
  FINAL_PHASE_REDUCTION_DOMAINS,
} from "./reduction";

export async function advanceResolutionInputPage(
  db: D1Database,
  context: FinalBoundaryContext,
  claim: FinalWorkClaim
) {
  const cursor = parseResolutionCursor(claim.phaseCursor);
  const snapshots = await readFinalGraphMemberPage(db, {
    cursor,
    limit: PUBLIC_FINAL_WORK_PAGE_SIZE + 1,
    runId: claim.runId,
  });
  const hasMore = snapshots.length > PUBLIC_FINAL_WORK_PAGE_SIZE;
  const page = snapshots.slice(0, PUBLIC_FINAL_WORK_PAGE_SIZE);
  const rows: FinalWorkResolutionInput[] = await Promise.all(
    page.map(async (snapshot, index) => {
      const member =
        snapshot.resolutionState === "resolved"
          ? await shadowMember(snapshot)
          : null;
      const rowPayload = {
        ...snapshot,
        memberHash: member?.memberHash ?? null,
        memberKey: member?.memberKey ?? null,
        ordinal: claim.phaseOrdinal + index,
      };
      return {
        ...rowPayload,
        encodedBytes: encodedJsonBytes(rowPayload),
        rowHash: await canonicalSha256(rowPayload),
      };
    })
  );
  const nextCount = claim.counterCount + rows.length;
  if (nextCount > context.boundary.resolutionCount) {
    throw new FinalDuplicateSnapshotError(
      "The paged resolution input set changed"
    );
  }
  const digest = await appendFinalPhaseDigest(
    FINAL_PHASE_REDUCTION_DOMAINS.resolution,
    claim.counterDigest,
    rows.map(resolutionDigestRecord)
  );
  const last = page.at(-1);
  const nextCursor = last
    ? canonicalJson({
        inputHash: last.inputHash,
        positionItemId: last.positionItemId,
        sourcePositionId: last.sourcePositionId,
      })
    : claim.phaseCursor;
  await commitFinalWorkPage(db, {
    bytesAdded: rows.reduce((sum, row) => sum + row.encodedBytes, 0),
    claim,
    counter: "resolution",
    digest,
    lastRowCursor: nextCursor,
    nextCursor,
    nextOrdinal: claim.phaseOrdinal + rows.length,
    nextPhase: hasMore ? "resolution_inputs" : "mapping_inputs",
    rowsAdded: rows.length,
    statements:
      rows.length === 0
        ? []
        : [
            insertResolutionInputPageStatement(db, {
              frozenAt: claim.frozenAt,
              rows,
              runId: claim.runId,
            }),
            finalChangeAssertion(db, rows.length),
          ],
    terminalFence: hasMore
      ? undefined
      : {
          expectedCount: context.boundary.resolutionCount,
          expectedLastCursor: nextCursor,
        },
  });
}

export async function advanceMappingInputPage(
  db: D1Database,
  context: FinalBoundaryContext,
  claim: FinalWorkClaim
) {
  const sources = await readResolvedWorkSourcePage(db, {
    cursor: claim.phaseCursor,
    limit: PUBLIC_FINAL_WORK_PAGE_SIZE + 1,
    runId: claim.runId,
  });
  const hasMore = sources.length > PUBLIC_FINAL_WORK_PAGE_SIZE;
  const page = sources.slice(0, PUBLIC_FINAL_WORK_PAGE_SIZE);
  const currentMappings = await readCurrentSourceMappings(db, page);
  const mappingBySource = new Map(
    currentMappings.map((mapping) => [mapping.sourcePositionId, mapping])
  );
  const rows: FinalWorkMappingInput[] = await Promise.all(
    page.map(async (sourcePositionId, index) => {
      const mapping = mappingBySource.get(sourcePositionId);
      if (!mapping) {
        throw new FinalDuplicateSnapshotError(
          `The source mapping snapshot omitted ${sourcePositionId}`
        );
      }
      const inputHash = await canonicalSha256(mapping);
      const rowPayload = {
        headPresent: mapping.headPresent,
        inputHash,
        mappingHash: mapping.mappingHash,
        mappingState: mapping.mappingState,
        mappingVersion: mapping.mappingVersion,
        ordinal: claim.phaseOrdinal + index,
        publicJobId: mapping.publicJobId,
        sourcePositionId,
      };
      return {
        ...rowPayload,
        encodedBytes: encodedJsonBytes(rowPayload),
        rowHash: await canonicalSha256(rowPayload),
      };
    })
  );
  if (
    claim.counterCount + rows.length >
    context.boundary.resolvedPositionCount
  ) {
    throw new FinalDuplicateSnapshotError(
      "The paged source mapping set changed"
    );
  }
  await assertMappingInputPagePinned(db, { rows, runId: claim.runId });
  const digest = await appendFinalPhaseDigest(
    FINAL_PHASE_REDUCTION_DOMAINS.mapping,
    claim.counterDigest,
    rows.map((row) => row.rowHash)
  );
  const mappedRows = rows.filter(
    (row) => row.mappingState === "mapped" && row.publicJobId !== null
  );
  const sourceMappingDigest = await appendFinalPhaseDigest(
    FINAL_PHASE_REDUCTION_DOMAINS.sourceMapping,
    claim.sourceMappingDigest,
    mappedRows.map((row) => row.inputHash)
  );
  const nextCursor = page.at(-1) ?? claim.phaseCursor;
  const sourceMappingLastCursor =
    mappedRows.at(-1)?.sourcePositionId ?? claim.sourceMappingLastCursor;
  await commitFinalWorkPage(db, {
    bytesAdded: rows.reduce((sum, row) => sum + row.encodedBytes, 0),
    claim,
    counter: "mapping",
    digest,
    lastRowCursor: nextCursor,
    nextCursor,
    nextOrdinal: claim.phaseOrdinal + rows.length,
    nextPhase: hasMore ? "mapping_inputs" : "canonical_requests",
    rowsAdded: rows.length,
    sourceMappingDigest,
    sourceMappingLastCursor,
    sourceMappingRowsAdded: mappedRows.length,
    statements:
      rows.length === 0
        ? []
        : [
            insertMappingInputPageStatement(db, {
              frozenAt: claim.frozenAt,
              rows,
              runId: claim.runId,
            }),
            finalChangeAssertion(db, rows.length),
          ],
    terminalFence: hasMore
      ? undefined
      : {
          expectedCount: context.boundary.resolvedPositionCount,
          expectedLastCursor: nextCursor,
        },
  });
}

function parseResolutionCursor(value: string) {
  if (!value) {
    return null;
  }
  try {
    const cursor = JSON.parse(value) as Record<string, unknown>;
    return typeof cursor.inputHash === "string" &&
      typeof cursor.positionItemId === "string" &&
      typeof cursor.sourcePositionId === "string"
      ? {
          inputHash: cursor.inputHash,
          positionItemId: cursor.positionItemId,
          sourcePositionId: cursor.sourcePositionId,
        }
      : null;
  } catch {
    return null;
  }
}

function resolutionDigestRecord(row: FinalWorkResolutionInput) {
  return {
    canonicalSignalHash: row.canonicalSignalHash,
    inputHash: row.inputHash,
    reasonCode: row.resolutionReasonCode,
    resolutionSealHash: row.resolutionSealHash,
    sourcePositionId: row.sourcePositionId,
    state: row.resolutionState,
  };
}
