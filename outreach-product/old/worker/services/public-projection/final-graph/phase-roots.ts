import { readPublicRootSnapshots } from "../../../repositories/public-projection-final-graph";
import { commitFinalWorkPage } from "../../../repositories/public-projection-final-work/controller";
import {
  insertPublicRootPageStatement,
  insertRelationWorkPageStatement,
  readPublicRootIdPage,
} from "../../../repositories/public-projection-final-work/roots-relations";
import { encodedJsonBytes } from "../../../repositories/public-projection-final-work/shared";
import {
  type FinalWorkClaim,
  type FinalWorkPublicRoot,
  type FinalWorkRelation,
  PUBLIC_FINAL_WORK_PAGE_SIZE,
} from "../../../repositories/public-projection-final-work/types";
import { canonicalSha256 } from "../hash";
import { finalChangeAssertion } from "./boundary";
import { finalPublicMemberKey } from "./identity";
import { FinalDuplicateSnapshotError } from "./model";
import {
  appendFinalPhaseDigest,
  FINAL_PHASE_REDUCTION_DOMAINS,
} from "./reduction";
import {
  buildRelationCandidatePage,
  nextRelationPageCursor,
  parseRelationCursor,
  readRelationCandidatePage,
  relationSourceAfter,
} from "./relation-candidates";

export async function advancePublicRootPage(
  db: D1Database,
  claim: FinalWorkClaim
) {
  const rootPage = await readPublicRootIdPage(db, {
    cursor: claim.phaseCursor,
    limit: PUBLIC_FINAL_WORK_PAGE_SIZE,
    runId: claim.runId,
  });
  const hasMore = !rootPage.complete;
  const page = rootPage.publicJobIds;
  const snapshots = await readPublicRootSnapshots(db, page);
  const byOrigin = new Map(
    snapshots.map((snapshot) => [snapshot.originatingPublicJobId, snapshot])
  );
  if (byOrigin.size !== page.length) {
    throw new FinalDuplicateSnapshotError(
      "A paged public duplicate root is missing or cyclic"
    );
  }
  const rows: FinalWorkPublicRoot[] = await Promise.all(
    page.map(async (publicJobId, index) => {
      const snapshot = byOrigin.get(publicJobId);
      if (!snapshot) {
        throw new FinalDuplicateSnapshotError(
          `A paged public duplicate root is missing ${publicJobId}`
        );
      }
      const [
        allocationInputHash,
        contentHeadHash,
        historyHash,
        redirectPathHash,
      ] = await Promise.all([
        canonicalSha256({
          allocationHash: snapshot.allocationHash,
          foundingSourcePositionId: snapshot.foundingSourcePositionId,
          publicJobId: snapshot.redirectRootId,
        }),
        canonicalSha256({
          eligibilityDecisionVersion: snapshot.eligibilityDecisionVersion,
          publicJobId: snapshot.redirectRootId,
          publicJobVersion: snapshot.publicJobVersion,
        }),
        canonicalSha256({
          firstPublishedAt: snapshot.firstPublishedAt,
          servedPublicly: snapshot.servedPublicly,
        }),
        canonicalSha256(snapshot.redirectPath),
      ]);
      const pin = {
        ...snapshot,
        allocationInputHash,
        contentHeadHash,
        historyHash,
        ordinal: claim.phaseOrdinal + index,
        publicMemberKey: finalPublicMemberKey(snapshot),
        redirectPathHash,
      };
      return {
        ...pin,
        encodedBytes: encodedJsonBytes(pin),
        rowHash: await canonicalSha256(pin),
      };
    })
  );
  const digest = await appendFinalPhaseDigest(
    FINAL_PHASE_REDUCTION_DOMAINS.publicRoot,
    claim.counterDigest,
    rows.map((row) => row.rowHash)
  );
  const lastRowCursor =
    rows.at(-1)?.originatingPublicJobId ?? claim.counterLastCursor;
  await commitFinalWorkPage(db, {
    bytesAdded: rows.reduce((sum, row) => sum + row.encodedBytes, 0),
    claim,
    counter: "public_root",
    digest,
    lastRowCursor,
    nextCursor: rootPage.cursor,
    nextOrdinal: claim.phaseOrdinal + rows.length,
    nextPhase: hasMore ? "public_roots" : "relations",
    rowsAdded: rows.length,
    statements:
      rows.length === 0
        ? []
        : [
            insertPublicRootPageStatement(db, {
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
          expectedLastCursor: lastRowCursor,
        },
  });
}

export async function advanceRelationWorkPage(
  db: D1Database,
  claim: FinalWorkClaim
) {
  const cursor = parseRelationCursor(claim.phaseCursor);
  const page = await readRelationCandidatePage(db, {
    cursor,
    limit: PUBLIC_FINAL_WORK_PAGE_SIZE + 1,
    runId: claim.runId,
  });
  const candidates = page.candidates.slice(0, PUBLIC_FINAL_WORK_PAGE_SIZE);
  const built = await buildRelationCandidatePage(db, {
    candidates,
    runId: claim.runId,
    source: page.source,
  });
  const rows: FinalWorkRelation[] = built.relations.map((relation, index) => {
    const decision = built.decisionById.get(relation.operatorDecisionId ?? "");
    return {
      encodedBytes: encodedJsonBytes(relation),
      operatorDecisionHash: decision?.decisionHash ?? null,
      operatorDecisionId: decision?.id ?? null,
      operatorTerminal: true,
      ordinal: claim.phaseOrdinal + index,
      relation,
    };
  });
  const hasMoreInSource = page.candidates.length > PUBLIC_FINAL_WORK_PAGE_SIZE;
  const nextSource = hasMoreInSource
    ? page.source
    : relationSourceAfter(page.source);
  const complete = nextSource === null;
  const digest = await appendFinalPhaseDigest(
    FINAL_PHASE_REDUCTION_DOMAINS.relation,
    claim.counterDigest,
    rows.map((row) => ({
      id: row.relation.id,
      relationHash: row.relation.relationHash,
    }))
  );
  const lastCandidate = candidates.at(-1);
  const nextCursor = nextRelationPageCursor({
    complete,
    hasMoreInSource,
    lastCandidate,
    nextSource,
    priorCursor: claim.phaseCursor,
  });
  const lastRowCursor = rows.at(-1)?.relation.id ?? claim.counterLastCursor;
  await commitFinalWorkPage(db, {
    bytesAdded: rows.reduce((sum, row) => sum + row.encodedBytes, 0),
    claim,
    counter: "relation",
    digest,
    lastRowCursor,
    nextCursor,
    nextOrdinal: claim.phaseOrdinal + rows.length,
    nextPhase: complete ? "components" : "relations",
    rowsAdded: rows.length,
    statements:
      rows.length === 0
        ? []
        : [
            insertRelationWorkPageStatement(db, {
              frozenAt: claim.frozenAt,
              rows,
              runId: claim.runId,
            }),
            finalChangeAssertion(db, rows.length),
          ],
    terminalFence: complete
      ? {
          expectedCount: claim.counterCount + rows.length,
          expectedLastCursor: lastRowCursor,
        }
      : undefined,
  });
}
