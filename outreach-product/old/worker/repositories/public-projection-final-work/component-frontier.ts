import { changeAssertion, pageJson } from "./shared";
import type { FinalComponentWork } from "./types";

export function readNextUnassignedShadowSeed(db: D1Database, runId: string) {
  return db
    .prepare(
      `SELECT input.member_key
         FROM public_projection_final_work_resolution_inputs input
        WHERE input.run_id=? AND input.resolution_state='resolved'
          AND NOT EXISTS (
            SELECT 1 FROM public_projection_final_component_frontier frontier
             WHERE frontier.run_id=input.run_id
               AND frontier.member_key=input.member_key
          )
        ORDER BY input.member_key LIMIT 1`
    )
    .bind(runId)
    .first<{ member_key: string }>()
    .then((row) => row?.member_key ?? null);
}

export function initializeComponentStatements(
  db: D1Database,
  input: { frozenAt: string; runId: string; seedMemberKey: string }
) {
  return [
    db
      .prepare(
        `INSERT INTO public_projection_final_component_work (
          run_id,seed_member_key,state,created_at,updated_at
        ) VALUES (?,?,'expanding',?,?)`
      )
      .bind(input.runId, input.seedMemberKey, input.frozenAt, input.frozenAt),
    changeAssertion(db, 1),
    db
      .prepare(
        `INSERT INTO public_projection_final_component_frontier (
          run_id,seed_member_key,member_key,created_at
        ) VALUES (?,?,?,?)`
      )
      .bind(
        input.runId,
        input.seedMemberKey,
        input.seedMemberKey,
        input.frozenAt
      ),
    changeAssertion(db, 1),
  ];
}

export async function readComponentWork(
  db: D1Database,
  input: { runId: string; seedMemberKey: string }
): Promise<FinalComponentWork | null> {
  const row = await db
    .prepare(
      `SELECT seed_member_key,state,child_cursor,member_count,
              relation_count,root_count,root_candidate_count,oversized,ambiguous,
              source_mapped_winner,member_digest,member_last_cursor,
              relation_digest,relation_last_cursor,root_digest,
              root_expected_count,root_last_cursor,root_summary_ready,
              update_last_cursor,allocation_id,
              allocation_hash,artifact_hash,founding_source_position_id,
              proposed_public_job_id,winning_public_job_id,losing_root_count,
              allocation_state,reason_code,encoded_bytes
         FROM public_projection_final_component_work
        WHERE run_id=? AND seed_member_key=? LIMIT 1`
    )
    .bind(input.runId, input.seedMemberKey)
    .first<{
      allocation_id: null | string;
      allocation_state: null | "blocked" | "promotable";
      allocation_hash: null | string;
      ambiguous: number;
      artifact_hash: null | string;
      child_cursor: string;
      encoded_bytes: number;
      founding_source_position_id: null | string;
      losing_root_count: null | number;
      member_count: number;
      member_digest: null | string;
      member_last_cursor: string;
      oversized: number;
      proposed_public_job_id: null | string;
      reason_code: null | string;
      relation_count: number;
      relation_digest: null | string;
      relation_last_cursor: string;
      root_count: number;
      root_candidate_count: number;
      root_digest: null | string;
      root_expected_count: null | number;
      root_last_cursor: string;
      root_summary_ready: number;
      seed_member_key: string;
      source_mapped_winner: number;
      state: FinalComponentWork["state"];
      update_last_cursor: string;
      winning_public_job_id: null | string;
    }>();
  return row
    ? {
        allocationHash: row.allocation_hash,
        allocationId: row.allocation_id,
        allocationState: row.allocation_state,
        ambiguous: row.ambiguous === 1,
        artifactHash: row.artifact_hash,
        childCursor: row.child_cursor,
        encodedBytes: row.encoded_bytes,
        foundingSourcePositionId: row.founding_source_position_id,
        losingRootCount: row.losing_root_count,
        memberCount: row.member_count,
        memberDigest: row.member_digest,
        memberLastCursor: row.member_last_cursor,
        oversized: row.oversized === 1,
        proposedPublicJobId: row.proposed_public_job_id,
        reasonCode: row.reason_code,
        relationCount: row.relation_count,
        relationDigest: row.relation_digest,
        relationLastCursor: row.relation_last_cursor,
        rootCandidateCount: row.root_candidate_count,
        rootCount: row.root_count,
        rootDigest: row.root_digest,
        rootExpectedCount: row.root_expected_count,
        rootLastCursor: row.root_last_cursor,
        rootSummaryReady: row.root_summary_ready === 1,
        seedMemberKey: row.seed_member_key,
        sourceMappedWinner: row.source_mapped_winner === 1,
        state: row.state,
        updateLastCursor: row.update_last_cursor,
        winningPublicJobId: row.winning_public_job_id,
      }
    : null;
}

export function readNextComponentFrontier(
  db: D1Database,
  input: { runId: string; seedMemberKey: string }
) {
  return db
    .prepare(
      `SELECT member_key,left_edge_cursor,right_edge_cursor
         FROM public_projection_final_component_frontier
        WHERE run_id=? AND seed_member_key=? AND expanded=0
        ORDER BY member_key LIMIT 1`
    )
    .bind(input.runId, input.seedMemberKey)
    .first<{
      left_edge_cursor: string;
      member_key: string;
      right_edge_cursor: string;
    }>();
}

export const COMPONENT_LEFT_NEIGHBOR_PAGE_SQL = `SELECT right_member_key neighbor_key
   FROM public_projection_final_work_relations
     INDEXED BY idx_projection_final_relations_left_page
  WHERE run_id=? AND relation='same' AND left_member_key=?
    AND right_member_key>?
  ORDER BY right_member_key,id LIMIT ?`;

export const COMPONENT_RIGHT_NEIGHBOR_PAGE_SQL = `SELECT left_member_key neighbor_key
   FROM public_projection_final_work_relations
     INDEXED BY idx_projection_final_relations_right_page
  WHERE run_id=? AND relation='same' AND right_member_key=?
    AND left_member_key>?
  ORDER BY left_member_key,id LIMIT ?`;

export async function readSameRelationNeighborPage(
  db: D1Database,
  input: {
    leftCursor: string;
    limit: number;
    memberKey: string;
    rightCursor: string;
    runId: string;
  }
) {
  const queryLimit = input.limit + 1;
  const [leftRows, rightRows] = await Promise.all([
    db
      .prepare(COMPONENT_LEFT_NEIGHBOR_PAGE_SQL)
      .bind(input.runId, input.memberKey, input.leftCursor, queryLimit)
      .all<{ neighbor_key: string }>(),
    db
      .prepare(COMPONENT_RIGHT_NEIGHBOR_PAGE_SQL)
      .bind(input.runId, input.memberKey, input.rightCursor, queryLimit)
      .all<{ neighbor_key: string }>(),
  ]);
  const left = leftRows.results.map((row) => row.neighbor_key);
  const right = rightRows.results.map((row) => row.neighbor_key);
  const neighborKeys: string[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (
    neighborKeys.length < input.limit &&
    (leftIndex < left.length || rightIndex < right.length)
  ) {
    const leftKey = left[leftIndex];
    const rightKey = right[rightIndex];
    if (
      rightKey === undefined ||
      (leftKey !== undefined && leftKey < rightKey)
    ) {
      if (leftKey !== undefined) {
        neighborKeys.push(leftKey);
      }
      leftIndex += 1;
      continue;
    }
    neighborKeys.push(rightKey);
    rightIndex += 1;
  }
  return {
    complete: leftIndex === left.length && rightIndex === right.length,
    leftCursor: left.at(leftIndex - 1) ?? input.leftCursor,
    neighborKeys,
    rightCursor: right.at(rightIndex - 1) ?? input.rightCursor,
  };
}

export async function readFrontierAssignments(
  db: D1Database,
  input: { memberKeys: string[]; runId: string }
) {
  if (input.memberKeys.length === 0) {
    return new Map<string, string>();
  }
  const rows = await db
    .prepare(
      `SELECT member_key,seed_member_key
         FROM public_projection_final_component_frontier
        WHERE run_id=? AND member_key IN (
          SELECT CAST(value AS TEXT) FROM json_each(?)
        )`
    )
    .bind(input.runId, pageJson(input.memberKeys, "frontier assignment keys"))
    .all<{ member_key: string; seed_member_key: string }>();
  return new Map(
    rows.results.map((row) => [row.member_key, row.seed_member_key])
  );
}

export function expandComponentFrontierStatements(
  db: D1Database,
  input: {
    expanded: boolean;
    frozenAt: string;
    leftEdgeCursor: string;
    memberKey: string;
    newMemberKeys: string[];
    priorLeftEdgeCursor: string;
    priorRightEdgeCursor: string;
    rightEdgeCursor: string;
    runId: string;
    seedMemberKey: string;
  }
) {
  const statements: D1PreparedStatement[] = [];
  if (input.newMemberKeys.length > 0) {
    statements.push(
      db
        .prepare(
          `INSERT INTO public_projection_final_component_frontier (
            run_id,seed_member_key,member_key,created_at
          )
          SELECT ?,?,CAST(value AS TEXT),? FROM json_each(?)`
        )
        .bind(
          input.runId,
          input.seedMemberKey,
          input.frozenAt,
          pageJson(input.newMemberKeys, "component frontier keys")
        ),
      changeAssertion(db, input.newMemberKeys.length)
    );
  }
  statements.push(
    db
      .prepare(
        `UPDATE public_projection_final_component_frontier
            SET left_edge_cursor=?,right_edge_cursor=?,expanded=?
          WHERE run_id=? AND seed_member_key=? AND member_key=?
            AND expanded=0 AND left_edge_cursor=? AND right_edge_cursor=?`
      )
      .bind(
        input.leftEdgeCursor,
        input.rightEdgeCursor,
        input.expanded ? 1 : 0,
        input.runId,
        input.seedMemberKey,
        input.memberKey,
        input.priorLeftEdgeCursor,
        input.priorRightEdgeCursor
      ),
    changeAssertion(db, 1)
  );
  return statements;
}
