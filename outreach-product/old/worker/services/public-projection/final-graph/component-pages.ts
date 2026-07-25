import {
  PUBLIC_DUPLICATE_FINALIZATION_VERSION,
  PUBLIC_JOB_ALLOCATION_VERSION,
  type StoredAllocationRoot,
} from "../../../repositories/public-projection-final-graph";
import { stageComponentChildPageStatements } from "../../../repositories/public-projection-final-work/component-artifacts";
import type { readComponentWork } from "../../../repositories/public-projection-final-work/component-frontier";
import {
  type ComponentRootCandidateInput,
  readComponentMemberPage,
  readComponentRootCandidateInputs,
} from "../../../repositories/public-projection-final-work/component-members";
import {
  readComponentPositionUpdatePage,
  readComponentRelationPage,
  readComponentRootCandidatePage,
} from "../../../repositories/public-projection-final-work/component-relations";
import { commitFinalWorkPage } from "../../../repositories/public-projection-final-work/controller";
import { encodedJsonBytes } from "../../../repositories/public-projection-final-work/shared";
import {
  type FinalWorkClaim,
  PUBLIC_FINAL_WORK_PAGE_SIZE,
} from "../../../repositories/public-projection-final-work/types";
import { canonicalJson, canonicalSha256 } from "../hash";
import {
  componentMemberFromInput,
  componentRootReason,
  finalizeComponentArtifact,
  initializeComponentRootSummary,
  parseCheckpoint,
} from "./component-artifacts";
import { uniqueSorted } from "./identity";
import { FinalDuplicateSnapshotError } from "./model";
import {
  appendReductionDigest,
  COMPONENT_MEMBER_DIGEST_DOMAIN,
  COMPONENT_RELATION_DIGEST_DOMAIN,
  COMPONENT_ROOT_DIGEST_DOMAIN,
} from "./reduction";

export async function advanceComponentChildPage(
  db: D1Database,
  claim: FinalWorkClaim,
  work: NonNullable<Awaited<ReturnType<typeof readComponentWork>>>
) {
  if (work.state === "expanding" || work.state === "sealed") {
    throw new FinalDuplicateSnapshotError(
      `The component child state ${work.state} is invalid`
    );
  }
  if (work.state === "members") {
    const candidates = await readComponentMemberPage(db, {
      cursor: work.childCursor,
      limit: PUBLIC_FINAL_WORK_PAGE_SIZE + 1,
      runId: claim.runId,
      seedMemberKey: work.seedMemberKey,
    });
    const hasMore = candidates.length > PUBLIC_FINAL_WORK_PAGE_SIZE;
    const members = await Promise.all(
      candidates
        .slice(0, PUBLIC_FINAL_WORK_PAGE_SIZE)
        .map(componentMemberFromInput)
    );
    const page = members.map((member, index) => ({
      encodedBytes: encodedJsonBytes(member),
      memberHash: member.memberHash,
      ordinal: work.memberCount + index,
      payloadJson: canonicalJson(member),
    }));
    const digest = await appendReductionDigest(
      COMPONENT_MEMBER_DIGEST_DOMAIN,
      work.memberDigest,
      members.map((member) => ({
        memberHash: member.memberHash,
        memberKey: member.memberKey,
      }))
    );
    const rootCandidates = await readComponentRootCandidateInputs(db, {
      memberKeys: members
        .filter((member) => member.kind === "public")
        .map((member) => member.memberKey),
      runId: claim.runId,
    });
    await commitComponentChildPage(db, claim, work, {
      complete: !hasMore,
      digest,
      nextCursor: members.at(-1)?.memberKey ?? work.childCursor,
      page,
      priorDigest: work.memberDigest,
      rootCandidates,
      state: "members",
    });
    return;
  }
  if (work.state === "relations") {
    const relationPage = await readComponentRelationPage(db, {
      cursor: work.childCursor,
      limit: PUBLIC_FINAL_WORK_PAGE_SIZE,
      runId: claim.runId,
      seedMemberKey: work.seedMemberKey,
    });
    const relations = relationPage.relations.map((row) => row.relation);
    const page = relations.map((relation, index) => ({
      encodedBytes: encodedJsonBytes({
        relationHash: relation.relationHash,
        relationId: relation.id,
      }),
      ordinal: work.relationCount + index,
      relationHash: relation.relationHash,
      relationId: relation.id,
    }));
    const digest = await appendReductionDigest(
      COMPONENT_RELATION_DIGEST_DOMAIN,
      work.relationDigest,
      relations.map((relation) => ({
        id: relation.id,
        reasonCode: relation.reasonCode,
        relation: relation.relation,
        relationHash: relation.relationHash,
      }))
    );
    const rootCandidates = await readComponentRootCandidateInputs(db, {
      memberKeys: relations.flatMap((relation) => {
        if (relation.relation === "different") {
          return [];
        }
        const memberKeys: string[] = [];
        if (relation.left.kind === "public") {
          memberKeys.push(relation.left.memberKey);
        }
        if (relation.right.kind === "public") {
          memberKeys.push(relation.right.memberKey);
        }
        return memberKeys;
      }),
      runId: claim.runId,
    });
    await commitComponentChildPage(db, claim, work, {
      ambiguous: relations.some(
        (relation) => relation.relation === "ambiguous"
      ),
      complete: relationPage.complete,
      digest,
      lastRowCursor:
        uniqueSorted([
          work.relationLastCursor,
          ...relations.map((relation) => relation.id),
        ]).at(-1) ?? work.relationLastCursor,
      nextCursor: relationPage.cursor,
      page,
      priorDigest: work.relationDigest,
      rootCandidates,
      sourceMappedWinner: relations.some(
        (relation) => relation.reasonCode === "same_source_position"
      ),
      state: "relations",
    });
    return;
  }
  if (work.state === "roots") {
    if (!work.rootSummaryReady) {
      await initializeComponentRootSummary(db, claim, work);
      return;
    }
    const candidates = await readComponentRootCandidatePage(db, {
      cursor: work.childCursor,
      limit: PUBLIC_FINAL_WORK_PAGE_SIZE + 1,
      runId: claim.runId,
      seedMemberKey: work.seedMemberKey,
    });
    const hasMore = candidates.length > PUBLIC_FINAL_WORK_PAGE_SIZE;
    const roots = await Promise.all(
      candidates
        .slice(0, PUBLIC_FINAL_WORK_PAGE_SIZE)
        .map(async (candidate) => {
          const selected =
            work.allocationState === "promotable" &&
            work.winningPublicJobId === candidate.snapshot.redirectRootId;
          const reasonCode = componentRootReason(work, selected);
          const rootHash = await canonicalSha256({
            eligibilityDecisionVersion:
              candidate.snapshot.eligibilityDecisionVersion,
            firstPublishedAt: candidate.snapshot.firstPublishedAt,
            foundingSourcePositionId:
              candidate.snapshot.foundingSourcePositionId,
            memberKey: candidate.memberKey,
            publicJobCreatedAt: candidate.snapshot.publicJobCreatedAt,
            publicJobId: candidate.snapshot.redirectRootId,
            publicJobVersion: candidate.snapshot.publicJobVersion,
            selected,
            servedPublicly: candidate.snapshot.servedPublicly,
          });
          return {
            eligibilityDecisionVersion:
              candidate.snapshot.eligibilityDecisionVersion,
            firstPublishedAt: candidate.snapshot.firstPublishedAt,
            foundingSourcePositionId:
              candidate.snapshot.foundingSourcePositionId,
            memberKey: candidate.memberKey,
            publicJobCreatedAt: candidate.snapshot.publicJobCreatedAt,
            publicJobId: candidate.snapshot.redirectRootId,
            publicJobVersion: candidate.snapshot.publicJobVersion,
            reasonCode,
            rootHash,
            selected,
            servedPublicly: candidate.snapshot.servedPublicly,
          } satisfies StoredAllocationRoot;
        })
    );
    const page = roots.map((root, index) => ({
      encodedBytes: encodedJsonBytes(root),
      ordinal: work.rootCount + index,
      payloadJson: canonicalJson(root),
      rootHash: root.rootHash,
    }));
    const digest = await appendReductionDigest(
      COMPONENT_ROOT_DIGEST_DOMAIN,
      work.rootDigest,
      roots.map((root) => ({
        memberKey: root.memberKey,
        rootHash: root.rootHash,
      }))
    );
    await commitComponentChildPage(db, claim, work, {
      complete: !hasMore,
      digest,
      nextCursor: roots.at(-1)?.memberKey ?? work.childCursor,
      page,
      priorDigest: work.rootDigest,
      state: "roots",
    });
    return;
  }
  if (!work.allocationHash) {
    await finalizeComponentArtifact(db, claim, work);
    return;
  }
  const candidates = await readComponentPositionUpdatePage(db, {
    cursor: work.childCursor,
    limit: PUBLIC_FINAL_WORK_PAGE_SIZE + 1,
    runId: claim.runId,
    seedMemberKey: work.seedMemberKey,
  });
  const hasMore = candidates.length > PUBLIC_FINAL_WORK_PAGE_SIZE;
  const page = await Promise.all(
    candidates.slice(0, PUBLIC_FINAL_WORK_PAGE_SIZE).map(async (snapshot) => {
      const checkpoint = parseCheckpoint(snapshot.checkpointJson);
      const payload = {
        checkpointJson: canonicalJson({
          ...checkpoint,
          finalDuplicateGraph: {
            allocationAlgorithmVersion: PUBLIC_JOB_ALLOCATION_VERSION,
            allocationHash: work.allocationHash,
            allocationId: work.allocationId,
            artifactHash: work.artifactHash,
            finalizationAlgorithmVersion: PUBLIC_DUPLICATE_FINALIZATION_VERSION,
            memberKey: snapshot.memberKey,
            proposedPublicJobId: work.proposedPublicJobId,
            reasonCode: work.reasonCode,
            state: work.allocationState,
            winningPublicJobId: work.winningPublicJobId,
          },
        }),
        inputHash: snapshot.inputHash,
        ordinal: snapshot.ordinal,
        positionItemId: snapshot.positionItemId,
        sourcePositionId: snapshot.sourcePositionId,
      };
      return {
        ...payload,
        encodedBytes: encodedJsonBytes(payload),
        rowHash: await canonicalSha256(payload),
      };
    })
  );
  await commitFinalWorkPage(db, {
    activeComponentSeed: work.seedMemberKey,
    bytesAdded: 0,
    claim,
    counter: "component",
    nextCursor: claim.phaseCursor,
    nextOrdinal: claim.phaseOrdinal,
    nextPhase: "components",
    rowsAdded: 0,
    statements: stageComponentChildPageStatements(db, {
      complete: !hasMore,
      frozenAt: claim.frozenAt,
      nextCursor:
        candidates.at(
          Math.min(candidates.length, PUBLIC_FINAL_WORK_PAGE_SIZE) - 1
        )?.memberKey ?? work.childCursor,
      page,
      priorCursor: work.childCursor,
      runId: claim.runId,
      seedMemberKey: work.seedMemberKey,
      state: "updates",
    }),
  });
}

async function commitComponentChildPage(
  db: D1Database,
  claim: FinalWorkClaim,
  work: NonNullable<Awaited<ReturnType<typeof readComponentWork>>>,
  input: {
    ambiguous?: boolean;
    complete: boolean;
    digest: string;
    lastRowCursor?: string;
    nextCursor: string;
    page: unknown[];
    priorDigest: null | string;
    rootCandidates?: ComponentRootCandidateInput[];
    sourceMappedWinner?: boolean;
    state: "members" | "relations" | "roots";
  }
) {
  await commitFinalWorkPage(db, {
    activeComponentSeed: work.seedMemberKey,
    bytesAdded: 0,
    claim,
    counter: "component",
    nextCursor: claim.phaseCursor,
    nextOrdinal: claim.phaseOrdinal,
    nextPhase: "components",
    rowsAdded: 0,
    statements: stageComponentChildPageStatements(db, {
      ambiguous: input.ambiguous,
      complete: input.complete,
      digest: input.digest,
      frozenAt: claim.frozenAt,
      lastRowCursor: input.lastRowCursor,
      nextCursor: input.nextCursor,
      page: input.page,
      priorCursor: work.childCursor,
      priorDigest: input.priorDigest,
      rootCandidates: input.rootCandidates,
      runId: claim.runId,
      seedMemberKey: work.seedMemberKey,
      sourceMappedWinner: input.sourceMappedWinner,
      state: input.state,
    }),
  });
}
