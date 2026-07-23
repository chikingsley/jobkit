import type {
  CatalogCopyMember,
  CatalogPromotionStatementInput,
} from "./catalog";
import { catalogVersionStatement } from "./catalog";
import {
  copyCatalogMembers,
  copyLocationFacets,
  copySearchRows,
  copySearchTerms,
} from "./catalog-statements";
import { assertion } from "./guards";

// Activation still copies every retained predecessor row into the new
// catalog version. Staging spreads that O(catalog) copy across bounded
// batches so a single D1 transaction never carries the whole catalog; the
// candidate rows and the head flip commit later in one atomic batch.
export const CATALOG_COPY_CHUNK_MEMBERS = 64;

export interface CatalogStagingInput extends CatalogPromotionStatementInput {
  candidateHash: string;
  candidateSealDigest: string;
}

interface CopyChunk {
  afterId: string;
  members: CatalogCopyMember[];
}

export function catalogStagingBatches(
  db: D1Database,
  input: CatalogStagingInput
): D1PreparedStatement[][] {
  const batches: D1PreparedStatement[][] = [
    [
      ...stagingGuards(db, input),
      catalogVersionStatement(db, input),
      assertion(db, 1, "SELECT changes()", []),
    ],
  ];
  for (const chunk of copyChunks(input.prepared.copyMembers)) {
    batches.push(copyChunkStatements(db, input, chunk));
  }
  return batches;
}

function copyChunks(members: CatalogCopyMember[]): CopyChunk[] {
  const chunks: CopyChunk[] = [];
  let afterId = "";
  for (
    let start = 0;
    start < members.length;
    start += CATALOG_COPY_CHUNK_MEMBERS
  ) {
    const slice = members.slice(start, start + CATALOG_COPY_CHUNK_MEMBERS);
    const boundary = slice.at(-1);
    if (!boundary) {
      break;
    }
    chunks.push({ afterId, members: slice });
    afterId = boundary.publicJobId;
  }
  return chunks;
}

function copyChunkStatements(
  db: D1Database,
  input: CatalogStagingInput,
  chunk: CopyChunk
): D1PreparedStatement[] {
  const last = chunk.members.at(-1);
  if (!last) {
    return [];
  }
  const range = { afterId: chunk.afterId, throughId: last.publicJobId };
  const termCount = chunk.members.reduce(
    (count, member) => count + member.termCount,
    0
  );
  const facetCount = chunk.members.reduce(
    (count, member) => count + member.facetCount,
    0
  );
  return [
    ...stagingGuards(db, input),
    copyCatalogMembers(db, input, range),
    assertion(db, chunk.members.length, "SELECT changes()", []),
    copySearchRows(db, input, range),
    assertion(db, chunk.members.length, "SELECT changes()", []),
    copySearchTerms(db, input, range),
    assertion(db, termCount, "SELECT changes()", []),
    copyLocationFacets(db, input, range),
    assertion(db, facetCount, "SELECT changes()", []),
  ];
}

function stagingGuards(db: D1Database, input: CatalogStagingInput) {
  return [
    assertion(
      db,
      1,
      `SELECT COUNT(*) FROM public_job_catalog_head_pointer
        WHERE singleton=1 AND current_version=?`,
      [input.catalogHead.current_version]
    ),
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
  ];
}
