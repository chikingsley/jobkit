import {
  readCanonicalLiveCandidatePage,
  readPublicRootSnapshots,
  type StoredCanonicalLiveInput,
} from "../../../repositories/public-projection-final-graph";
import { commitFinalWorkPage } from "../../../repositories/public-projection-final-work/controller";
import {
  canonicalMatchPageStatements,
  insertCanonicalRequestPageStatement,
  readCanonicalRequestSignalPage,
  readNextUnmatchedCanonicalRequest,
} from "../../../repositories/public-projection-final-work/inputs";
import { encodedJsonBytes } from "../../../repositories/public-projection-final-work/shared";
import {
  type FinalWorkCanonicalMatch,
  type FinalWorkClaim,
  PUBLIC_FINAL_WORK_PAGE_SIZE,
} from "../../../repositories/public-projection-final-work/types";
import { canonicalJson, canonicalSha256 } from "../hash";
import { finalChangeAssertion } from "./boundary";
import { finalPublicMemberKey, uniqueSorted } from "./identity";
import { FinalDuplicateSnapshotError } from "./model";
import {
  appendFinalPhaseDigest,
  FINAL_PHASE_REDUCTION_DOMAINS,
} from "./reduction";

export async function advanceCanonicalRequestPage(
  db: D1Database,
  claim: FinalWorkClaim
) {
  const signals = await readCanonicalRequestSignalPage(db, {
    cursor: claim.phaseCursor,
    limit: PUBLIC_FINAL_WORK_PAGE_SIZE + 1,
    runId: claim.runId,
  });
  const hasMore = signals.length > PUBLIC_FINAL_WORK_PAGE_SIZE;
  const page = signals.slice(0, PUBLIC_FINAL_WORK_PAGE_SIZE);
  const rows = await Promise.all(
    page.map(async (signalHash, index) => {
      const payload = {
        ordinal: claim.phaseOrdinal + index,
        signalHash,
      };
      return {
        ...payload,
        encodedBytes: encodedJsonBytes(payload),
        matchComplete: false,
        matchCount: 0,
        matchCursor: "",
        matchDigest: null,
        requestHash: await canonicalSha256({ signalHash }),
      };
    })
  );
  const digest = await appendFinalPhaseDigest(
    FINAL_PHASE_REDUCTION_DOMAINS.canonicalRequest,
    claim.counterDigest,
    rows.map((row) => row.requestHash)
  );
  const nextCursor = page.at(-1) ?? claim.phaseCursor;
  await commitFinalWorkPage(db, {
    bytesAdded: rows.reduce((sum, row) => sum + row.encodedBytes, 0),
    claim,
    counter: "canonical_request",
    digest,
    lastRowCursor: nextCursor,
    nextCursor,
    nextOrdinal: claim.phaseOrdinal + rows.length,
    nextPhase: hasMore ? "canonical_requests" : "canonical_matches",
    rowsAdded: rows.length,
    statements:
      rows.length === 0
        ? []
        : [
            insertCanonicalRequestPageStatement(db, {
              frozenAt: claim.frozenAt,
              rows,
              runId: claim.runId,
            }),
            finalChangeAssertion(db, rows.length),
          ],
    terminalFence: hasMore
      ? undefined
      : {
          expectedCount: claim.counterCount + rows.length,
          expectedLastCursor: nextCursor,
        },
  });
}

export async function advanceCanonicalMatchPage(
  db: D1Database,
  claim: FinalWorkClaim
) {
  const request = await readNextUnmatchedCanonicalRequest(db, {
    runId: claim.runId,
  });
  if (!request) {
    const digest = await appendFinalPhaseDigest(
      FINAL_PHASE_REDUCTION_DOMAINS.canonicalMatch,
      claim.counterDigest,
      []
    );
    await commitFinalWorkPage(db, {
      bytesAdded: 0,
      claim,
      counter: "canonical_match",
      digest,
      lastRowCursor: claim.counterLastCursor,
      nextCursor: claim.phaseCursor,
      nextOrdinal: claim.phaseOrdinal,
      nextPhase: "public_roots",
      rowsAdded: 0,
      statements: [],
      terminalFence: {
        expectedCount: claim.counterCount,
        expectedLastCursor: claim.counterLastCursor,
      },
    });
    return;
  }
  const cursor = parseCanonicalMatchCursor(request.matchCursor);
  const candidates = await readCanonicalLiveCandidatePage(db, {
    cursor,
    limit: PUBLIC_FINAL_WORK_PAGE_SIZE + 1,
    signalHash: request.signalHash,
  });
  const hasMore = candidates.length > PUBLIC_FINAL_WORK_PAGE_SIZE;
  const sealedMatches = await sealCanonicalLiveInputs(
    candidates.slice(0, PUBLIC_FINAL_WORK_PAGE_SIZE)
  );
  const rootSnapshots = await readPublicRootSnapshots(
    db,
    uniqueSorted(sealedMatches.map((match) => match.publicJobId))
  );
  const rootByOrigin = new Map(
    rootSnapshots.map((snapshot) => [snapshot.originatingPublicJobId, snapshot])
  );
  const matches: FinalWorkCanonicalMatch[] = await Promise.all(
    sealedMatches.map(async (match, index) => {
      const root = rootByOrigin.get(match.publicJobId);
      if (!root) {
        throw new FinalDuplicateSnapshotError(
          `A canonical match lost public root ${match.publicJobId}`
        );
      }
      const publicMemberKey = finalPublicMemberKey(root);
      const rowPayload = {
        ...match,
        ordinal: claim.phaseOrdinal + index,
        publicMemberKey,
      };
      return {
        ...rowPayload,
        encodedBytes: encodedJsonBytes(rowPayload),
        rowHash: await canonicalSha256(rowPayload),
      };
    })
  );
  const digest = await appendFinalPhaseDigest(
    FINAL_PHASE_REDUCTION_DOMAINS.canonicalMatch,
    claim.counterDigest,
    matches.map((match) => match.rowHash)
  );
  const requestDigest = await appendFinalPhaseDigest(
    FINAL_PHASE_REDUCTION_DOMAINS.canonicalMatchRequest,
    request.matchDigest,
    matches.map((match) => match.rowHash)
  );
  const lastMatch = matches.at(-1);
  const requestCursor = lastMatch
    ? canonicalJson({
        publicJobId: lastMatch.publicJobId,
        publicJobVersion: lastMatch.publicJobVersion,
      })
    : request.matchCursor;
  const lastRowCursor = lastMatch
    ? canonicalJson({
        publicJobId: lastMatch.publicJobId,
        publicJobVersion: lastMatch.publicJobVersion,
        signalHash: lastMatch.signalHash,
      })
    : claim.counterLastCursor;
  await commitFinalWorkPage(db, {
    bytesAdded: matches.reduce(
      (sum, match) => sum + encodedJsonBytes(match),
      0
    ),
    claim,
    counter: "canonical_match",
    digest,
    lastRowCursor,
    nextCursor: request.signalHash,
    nextOrdinal: claim.phaseOrdinal + matches.length,
    nextPhase: "canonical_matches",
    rowsAdded: matches.length,
    statements: canonicalMatchPageStatements(db, {
      completed: !hasMore,
      digest: requestDigest,
      frozenAt: claim.frozenAt,
      matchCount: request.matchCount + matches.length,
      matchCursor: requestCursor,
      matches,
      priorCount: request.matchCount,
      priorCursor: request.matchCursor,
      priorDigest: request.matchDigest,
      runId: claim.runId,
      signalHash: request.signalHash,
    }),
  });
}

function parseCanonicalMatchCursor(value: string) {
  if (!value) {
    return null;
  }
  try {
    const cursor = JSON.parse(value) as Record<string, unknown>;
    if (
      typeof cursor.publicJobId === "string" &&
      typeof cursor.publicJobVersion === "number"
    ) {
      return {
        publicJobId: cursor.publicJobId,
        publicJobVersion: cursor.publicJobVersion,
      };
    }
  } catch {
    // The durable cursor error below is the stable failure contract.
  }
  throw new FinalDuplicateSnapshotError(
    "The canonical match request cursor is invalid"
  );
}

function sealCanonicalLiveInputs(
  candidates: {
    publicJobId: string;
    publicJobVersion: number;
    signalHash: string;
    signalKind: "canonical_identity_v1";
  }[]
): Promise<StoredCanonicalLiveInput[]> {
  return Promise.all(
    candidates.map(async (candidate) => ({
      ...candidate,
      inputHash: await canonicalSha256(candidate),
    }))
  );
}
