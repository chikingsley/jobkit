import {
  catalogActivationStatements,
  prepareCatalogPromotion,
} from "./catalog";
import {
  preparePromotionMappings,
  promotionDecisionHash,
  promotionManifestHash,
} from "./derive";
import { promotionGuardStatements } from "./guards";
import { livePromotionStatements } from "./live";
import { PublicProjectionPromotionError } from "./model";
import {
  readPromotionCandidate,
  readPromotionCatalogHead,
  readPromotionManifest,
} from "./read";

export async function promoteProjectionCandidate(
  db: D1Database,
  input: {
    allocationId: string;
    runId: string;
    userId: string;
  }
) {
  const existing = await readPromotionManifest(
    db,
    input.runId,
    input.allocationId
  );
  if (existing) {
    return { created: false, manifest: manifestValue(existing) };
  }
  const timestamp = new Date().toISOString();
  const [{ candidate, candidateHash, candidateSealDigest }, catalogHead] =
    await Promise.all([
      readPromotionCandidate(db, input.runId, input.allocationId),
      readPromotionCatalogHead(db),
    ]);
  const [mappings, decisionHash] = await Promise.all([
    preparePromotionMappings(candidate),
    promotionDecisionHash(candidate),
  ]);
  const catalog = await prepareCatalogPromotion(db, {
    candidate,
    catalogHead,
    decisionHash,
    timestamp,
  });
  const activatedCatalogVersion =
    catalog === null ? catalogHead.current_version : catalog.catalogVersion;
  const manifestHash = await promotionManifestHash({
    activatedCatalogVersion,
    authorizedAt: timestamp,
    candidate,
    candidateHash,
    candidateSealDigest,
    predecessorCatalogVersion: catalogHead.current_version,
    userId: input.userId,
  });
  const statements = [
    ...promotionGuardStatements(db, {
      candidate,
      candidateHash,
      candidateSealDigest,
      catalogHeadVersion: catalogHead.current_version,
      mappings,
    }),
    ...livePromotionStatements(db, {
      candidate,
      decisionHash,
      mappings,
      timestamp,
    }),
    ...(catalog
      ? catalogActivationStatements(db, {
          candidate,
          catalogHead,
          prepared: catalog,
          timestamp,
        })
      : []),
    promotionManifestStatement(db, {
      activatedCatalogVersion,
      candidate,
      candidateHash,
      candidateSealDigest,
      manifestHash,
      predecessorCatalogVersion: catalogHead.current_version,
      timestamp,
      userId: input.userId,
    }),
  ];
  try {
    await db.batch(statements);
  } catch (cause) {
    const replay = await readPromotionManifest(
      db,
      input.runId,
      input.allocationId
    );
    if (replay) {
      return { created: false, manifest: manifestValue(replay) };
    }
    const detail = cause instanceof Error ? cause.message : String(cause);
    const promotionError = new PublicProjectionPromotionError(
      `Promotion lost an atomic precondition: ${detail}`,
      409
    );
    promotionError.cause = cause;
    throw promotionError;
  }
  const manifest = await readPromotionManifest(
    db,
    input.runId,
    input.allocationId
  );
  if (!manifest) {
    throw new PublicProjectionPromotionError(
      "Promotion committed without its immutable manifest"
    );
  }
  return { created: true, manifest: manifestValue(manifest) };
}

function promotionManifestStatement(
  db: D1Database,
  input: {
    activatedCatalogVersion: string;
    candidate: Awaited<ReturnType<typeof readPromotionCandidate>>["candidate"];
    candidateHash: string;
    candidateSealDigest: string;
    manifestHash: string;
    predecessorCatalogVersion: string;
    timestamp: string;
    userId: string;
  }
) {
  return db
    .prepare(
      `INSERT INTO public_projection_promotion_manifests (
        id,run_id,allocation_id,candidate_id,candidate_hash,
        candidate_seal_digest,predecessor_catalog_version,
        activated_catalog_version,public_job_id,public_job_version,
        eligibility_decision_version,authorized_by_user_id,authorized_at,
        manifest_hash,completed_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      `promotion:${input.candidate.candidateId}`,
      input.candidate.runId,
      input.candidate.allocationId,
      input.candidate.candidateId,
      input.candidateHash,
      input.candidateSealDigest,
      input.predecessorCatalogVersion,
      input.activatedCatalogVersion,
      input.candidate.publicJobId,
      input.candidate.publicJobVersion,
      input.candidate.decision.decisionVersion,
      input.userId,
      input.timestamp,
      input.manifestHash,
      input.timestamp
    );
}

function manifestValue(
  row: NonNullable<Awaited<ReturnType<typeof readPromotionManifest>>>
) {
  return {
    activatedCatalogVersion: row.activated_catalog_version,
    allocationId: row.allocation_id,
    authorizedAt: row.authorized_at,
    candidateHash: row.candidate_hash,
    candidateId: row.candidate_id,
    candidateSealDigest: row.candidate_seal_digest,
    completedAt: row.completed_at,
    eligibilityDecisionVersion: row.eligibility_decision_version,
    id: row.id,
    manifestHash: row.manifest_hash,
    predecessorCatalogVersion: row.predecessor_catalog_version,
    publicJobId: row.public_job_id,
    publicJobVersion: row.public_job_version,
    runId: row.run_id,
  };
}
