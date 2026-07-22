import { canonicalJson } from "../../services/public-projection/hash";
import type {
  FinalGraphMemberSnapshot,
  StoredFinalRelation,
} from "../public-projection-final-graph";
import type { ComponentRootCandidate } from "./component-members";
import { changeAssertion } from "./shared";
import type { FinalWorkRelation } from "./types";

type ComponentRelationSide = "left" | "right";

const COMPONENT_RELATION_OUTER_SQL = {
  left: `SELECT frontier.member_key
     FROM public_projection_final_component_frontier frontier
    WHERE frontier.run_id=? AND frontier.seed_member_key=?
      AND frontier.member_key>?
      AND EXISTS (
        SELECT 1 FROM public_projection_final_work_relations relation
          INDEXED BY idx_projection_final_relations_left_component_page
         WHERE relation.run_id=frontier.run_id
           AND relation.left_member_key=frontier.member_key
           AND NOT EXISTS (
             SELECT 1
               FROM public_projection_final_work_component_relations stored
              WHERE stored.run_id=relation.run_id
                AND stored.seed_member_key=frontier.seed_member_key
                AND stored.relation_id=relation.id
           )
      )
    ORDER BY frontier.member_key LIMIT 1`,
  right: `SELECT frontier.member_key
     FROM public_projection_final_component_frontier frontier
    WHERE frontier.run_id=? AND frontier.seed_member_key=?
      AND frontier.member_key>?
      AND EXISTS (
        SELECT 1 FROM public_projection_final_work_relations relation
          INDEXED BY idx_projection_final_relations_right_component_page
         WHERE relation.run_id=frontier.run_id
           AND relation.right_member_key=frontier.member_key
           AND NOT EXISTS (
             SELECT 1
               FROM public_projection_final_work_component_relations stored
              WHERE stored.run_id=relation.run_id
                AND stored.seed_member_key=frontier.seed_member_key
                AND stored.relation_id=relation.id
           )
      )
    ORDER BY frontier.member_key LIMIT 1`,
} as const;

const COMPONENT_RELATION_INNER_SQL = {
  left: `SELECT relation.ordinal,relation.payload_json,
          relation.operator_decision_id,relation.operator_decision_hash,
          relation.operator_terminal,relation.encoded_bytes,relation.id
     FROM public_projection_final_work_relations relation
       INDEXED BY idx_projection_final_relations_left_component_page
    WHERE relation.run_id=? AND relation.left_member_key=? AND relation.id>?
      AND NOT EXISTS (
        SELECT 1 FROM public_projection_final_work_component_relations stored
         WHERE stored.run_id=relation.run_id AND stored.seed_member_key=?
           AND stored.relation_id=relation.id
      )
    ORDER BY relation.id LIMIT ?`,
  right: `SELECT relation.ordinal,relation.payload_json,
          relation.operator_decision_id,relation.operator_decision_hash,
          relation.operator_terminal,relation.encoded_bytes,relation.id
     FROM public_projection_final_work_relations relation
       INDEXED BY idx_projection_final_relations_right_component_page
    WHERE relation.run_id=? AND relation.right_member_key=? AND relation.id>?
      AND NOT EXISTS (
        SELECT 1 FROM public_projection_final_work_component_relations stored
         WHERE stored.run_id=relation.run_id AND stored.seed_member_key=?
           AND stored.relation_id=relation.id
      )
    ORDER BY relation.id LIMIT ?`,
} as const;

interface ComponentRelationRow {
  encoded_bytes: number;
  id: string;
  operator_decision_hash: null | string;
  operator_decision_id: null | string;
  operator_terminal: number;
  ordinal: number;
  payload_json: string;
}

export async function readComponentRelationPage(
  db: D1Database,
  input: { cursor: string; limit: number; runId: string; seedMemberKey: string }
) {
  let { memberKey, relationId, side } = parseComponentRelationCursor(
    input.cursor
  );
  const relations: FinalWorkRelation[] = [];
  const seen = new Set<string>();
  let consumed = 0;
  let continueCurrent = relationId !== "";
  let complete = false;
  while (consumed < input.limit) {
    if (!continueCurrent) {
      // biome-ignore lint/performance/noAwaitInLoops: Each seek is indexed and capped by the raw page budget.
      const nextMember = await seekComponentRelationMember(db, {
        memberKey,
        runId: input.runId,
        seedMemberKey: input.seedMemberKey,
        side,
      });
      if (nextMember.complete) {
        complete = true;
        break;
      }
      ({ memberKey, side } = nextMember);
      relationId = "";
    }
    const remaining = input.limit - consumed;
    const rows = await db
      .prepare(COMPONENT_RELATION_INNER_SQL[side])
      .bind(input.runId, memberKey, relationId, input.seedMemberKey, remaining)
      .all<ComponentRelationRow>();
    consumed += rows.results.length;
    appendUniqueRelations(relations, seen, rows.results);
    relationId = rows.results.at(-1)?.id ?? relationId;
    if (rows.results.length === remaining) {
      break;
    }
    continueCurrent = false;
    relationId = "";
  }
  return {
    complete,
    cursor: canonicalJson({ memberKey, relationId, side }),
    relations,
  };
}

async function seekComponentRelationMember(
  db: D1Database,
  input: {
    memberKey: string;
    runId: string;
    seedMemberKey: string;
    side: ComponentRelationSide;
  }
) {
  const current = await readRelationMember(db, input);
  if (current) {
    return { complete: false, memberKey: current, side: input.side } as const;
  }
  if (input.side === "left") {
    const right = await readRelationMember(db, {
      ...input,
      memberKey: "",
      side: "right",
    });
    if (right) {
      return { complete: false, memberKey: right, side: "right" } as const;
    }
  }
  return { complete: true, memberKey: "", side: "right" } as const;
}

function readRelationMember(
  db: D1Database,
  input: {
    memberKey: string;
    runId: string;
    seedMemberKey: string;
    side: ComponentRelationSide;
  }
) {
  return db
    .prepare(COMPONENT_RELATION_OUTER_SQL[input.side])
    .bind(input.runId, input.seedMemberKey, input.memberKey)
    .first<{ member_key: string }>()
    .then((row) => row?.member_key ?? null);
}

function appendUniqueRelations(
  relations: FinalWorkRelation[],
  seen: Set<string>,
  rows: ComponentRelationRow[]
) {
  for (const row of rows) {
    if (seen.has(row.id)) {
      continue;
    }
    seen.add(row.id);
    relations.push({
      encodedBytes: row.encoded_bytes,
      operatorDecisionHash: row.operator_decision_hash,
      operatorDecisionId: row.operator_decision_id,
      operatorTerminal: true,
      ordinal: row.ordinal,
      relation: JSON.parse(row.payload_json) as StoredFinalRelation,
    });
  }
}

function parseComponentRelationCursor(value: string): {
  memberKey: string;
  relationId: string;
  side: ComponentRelationSide;
} {
  if (!value) {
    return { memberKey: "", relationId: "", side: "left" };
  }
  const cursor = JSON.parse(value) as Record<string, unknown>;
  if (
    typeof cursor.memberKey !== "string" ||
    typeof cursor.relationId !== "string" ||
    (cursor.side !== "left" && cursor.side !== "right")
  ) {
    throw new Error("The component relation cursor is invalid");
  }
  return {
    memberKey: cursor.memberKey,
    relationId: cursor.relationId,
    side: cursor.side,
  };
}

export async function readComponentRootCandidatePage(
  db: D1Database,
  input: { cursor: string; limit: number; runId: string; seedMemberKey: string }
): Promise<ComponentRootCandidate[]> {
  const rows = await db
    .prepare(COMPONENT_ROOT_CANDIDATE_PAGE_SQL)
    .bind(input.runId, input.seedMemberKey, input.cursor, input.limit)
    .all<Record<string, unknown>>();
  return rows.results.map(componentRootCandidateFromRow);
}

export async function readComponentRootSummary(
  db: D1Database,
  input: { runId: string; seedMemberKey: string }
) {
  const [count, winner] = await Promise.all([
    db
      .prepare(
        `SELECT root_candidate_count count
           FROM public_projection_final_component_work
          WHERE run_id=? AND seed_member_key=? LIMIT 1`
      )
      .bind(input.runId, input.seedMemberKey)
      .first<{ count: number }>(),
    db
      .prepare(COMPONENT_ROOT_WINNER_SQL)
      .bind(input.runId, input.seedMemberKey)
      .first<Record<string, unknown>>(),
  ]);
  return {
    count: count?.count ?? 0,
    winner: winner ? componentRootCandidateFromRow(winner) : null,
  };
}

export const COMPONENT_ROOT_CANDIDATE_PAGE_SQL = `SELECT candidate.member_key,
       root.*
  FROM public_projection_final_component_root_candidates candidate
  JOIN public_projection_final_work_public_roots root
    ON root.run_id=candidate.run_id
   AND root.originating_public_job_id=candidate.originating_public_job_id
 WHERE candidate.run_id=? AND candidate.seed_member_key=?
   AND candidate.member_key>?
 ORDER BY candidate.member_key LIMIT ?`;

export const COMPONENT_ROOT_WINNER_SQL = `SELECT candidate.member_key,root.*
  FROM public_projection_final_component_root_candidates candidate
       INDEXED BY idx_projection_final_component_root_winner
  JOIN public_projection_final_work_public_roots root
    ON root.run_id=candidate.run_id
   AND root.originating_public_job_id=candidate.originating_public_job_id
 WHERE candidate.run_id=? AND candidate.seed_member_key=?
 ORDER BY candidate.served_publicly DESC,candidate.published_missing_rank,
          candidate.first_published_sort,candidate.public_job_created_at,
          candidate.redirect_root_id,candidate.member_key LIMIT 1`;

export async function readComponentLowestShadowSourcePositionId(
  db: D1Database,
  input: { runId: string; seedMemberKey: string }
) {
  const row = await db
    .prepare(
      `SELECT MIN(input.source_position_id) source_position_id
         FROM public_projection_final_component_frontier frontier
         JOIN public_projection_final_work_resolution_inputs input
           ON input.run_id=frontier.run_id
          AND input.member_key=frontier.member_key
        WHERE frontier.run_id=? AND frontier.seed_member_key=?`
    )
    .bind(input.runId, input.seedMemberKey)
    .first<{ source_position_id: null | string }>();
  return row?.source_position_id ?? null;
}

export async function readComponentPositionUpdatePage(
  db: D1Database,
  input: { cursor: string; limit: number; runId: string; seedMemberKey: string }
) {
  const rows = await db
    .prepare(
      `SELECT input.ordinal,input.position_item_id,input.source_position_id,
              input.input_hash,input.checkpoint_json,input.resolution_state,
              input.resolution_reason_code,input.resolution_seal_hash,
              input.canonical_signal_hash,input.member_key,input.member_hash,
              input.row_hash,input.encoded_bytes
         FROM public_projection_final_component_frontier frontier
         JOIN public_projection_final_work_resolution_inputs input
           ON input.run_id=frontier.run_id
          AND input.member_key=frontier.member_key
        WHERE frontier.run_id=? AND frontier.seed_member_key=?
          AND frontier.member_key>?
        ORDER BY frontier.member_key LIMIT ?`
    )
    .bind(input.runId, input.seedMemberKey, input.cursor, input.limit)
    .all<{
      canonical_signal_hash: null | string;
      checkpoint_json: string;
      encoded_bytes: number;
      input_hash: string;
      member_hash: string;
      member_key: string;
      ordinal: number;
      position_item_id: string;
      resolution_reason_code: string;
      resolution_seal_hash: string;
      resolution_state: FinalGraphMemberSnapshot["resolutionState"];
      row_hash: string;
      source_position_id: string;
    }>();
  return rows.results.map((row) => ({
    canonicalSignalHash: row.canonical_signal_hash,
    checkpointJson: row.checkpoint_json,
    encodedBytes: row.encoded_bytes,
    inputHash: row.input_hash,
    memberHash: row.member_hash,
    memberKey: row.member_key,
    ordinal: row.ordinal,
    positionItemId: row.position_item_id,
    resolutionReasonCode: row.resolution_reason_code,
    resolutionSealHash: row.resolution_seal_hash,
    resolutionState: row.resolution_state,
    rowHash: row.row_hash,
    sourcePositionId: row.source_position_id,
  }));
}

export function initializeComponentArtifactStatements(
  db: D1Database,
  input: { frozenAt: string; runId: string; seedMemberKey: string }
) {
  return [
    db
      .prepare(
        `UPDATE public_projection_final_component_work
            SET state='members',child_cursor='',updated_at=?
          WHERE run_id=? AND seed_member_key=? AND state='expanding'
            AND NOT EXISTS (
              SELECT 1 FROM public_projection_final_component_frontier frontier
               WHERE frontier.run_id=? AND frontier.seed_member_key=?
                 AND frontier.expanded=0
            )`
      )
      .bind(
        input.frozenAt,
        input.runId,
        input.seedMemberKey,
        input.runId,
        input.seedMemberKey
      ),
    changeAssertion(db, 1),
  ];
}

function componentRootCandidateFromRow(
  row: Record<string, unknown>
): ComponentRootCandidate {
  return {
    memberKey: String(row.member_key),
    snapshot: {
      allocationHash: (row.allocation_hash as null | string) ?? null,
      allocationInputHash: String(row.allocation_input_hash),
      contentHeadHash: String(row.content_head_hash),
      eligibilityDecisionVersion: Number(row.eligibility_decision_version),
      encodedBytes: Number(row.encoded_bytes),
      firstPublishedAt: (row.first_published_at as null | string) ?? null,
      foundingSourcePositionId:
        (row.founding_source_position_id as null | string) ?? null,
      historyHash: String(row.history_hash),
      ordinal: Number(row.ordinal),
      originatingPublicJobId: String(row.originating_public_job_id),
      publicJobCreatedAt: String(row.public_job_created_at),
      publicJobVersion: Number(row.public_job_version),
      publicMemberKey: String(row.public_member_key),
      redirectPath: JSON.parse(String(row.redirect_path_json)) as string[],
      redirectPathHash: String(row.redirect_path_hash),
      redirectRootId: String(row.redirect_root_id),
      rowHash: String(row.row_hash),
      servedPublicly: Number(row.served_publicly) === 1,
    },
  };
}
