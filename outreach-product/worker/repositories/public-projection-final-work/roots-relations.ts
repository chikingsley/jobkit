import { canonicalJson } from "../../services/public-projection/hash";
import { pageJson } from "./shared";
import type { FinalWorkPublicRoot, FinalWorkRelation } from "./types";

export async function readPublicRootIdPage(
  db: D1Database,
  input: { cursor: string; limit: number; runId: string }
) {
  const cursor = parsePublicRootDiscoveryCursor(input.cursor);
  const queryLimit = input.limit + 1;
  const [mappingRows, matchRows, comparisonRows] = await Promise.all([
    db
      .prepare(
        `SELECT public_job_id FROM public_projection_final_work_mapping_inputs
           INDEXED BY idx_projection_final_mapping_public_page
          WHERE run_id=? AND mapping_state='mapped' AND public_job_id>?
          ORDER BY public_job_id LIMIT ?`
      )
      .bind(input.runId, cursor.mapping, queryLimit)
      .all<{ public_job_id: string }>(),
    db
      .prepare(
        `SELECT public_job_id FROM public_projection_final_work_canonical_matches
           INDEXED BY idx_projection_final_canonical_match_public_page
          WHERE run_id=? AND public_job_id>?
          ORDER BY public_job_id,public_job_version,signal_hash LIMIT ?`
      )
      .bind(input.runId, cursor.match, queryLimit)
      .all<{ public_job_id: string }>(),
    db
      .prepare(
        `SELECT target_public_job_id public_job_id
           FROM public_projection_duplicate_comparisons
             INDEXED BY idx_projection_final_d2_public_page
          WHERE run_id=? AND target_kind='existing_public'
            AND target_public_job_id>?
          ORDER BY target_public_job_id LIMIT ?`
      )
      .bind(input.runId, cursor.comparison, queryLimit)
      .all<{ public_job_id: string }>(),
  ]);
  const streams: [string[], string[], string[]] = [
    mappingRows.results.map((row) => row.public_job_id),
    matchRows.results.map((row) => row.public_job_id),
    comparisonRows.results.map((row) => row.public_job_id),
  ];
  const indices: [number, number, number] = [0, 0, 0];
  const publicJobIds: string[] = [];
  while (publicJobIds.length < input.limit) {
    const [next] = streams
      .map((stream, index) => stream[indices[index] ?? 0])
      .filter((value): value is string => value !== undefined)
      .sort(compareUtf8);
    if (next === undefined) {
      break;
    }
    publicJobIds.push(next);
    for (const [index, stream] of streams.entries()) {
      let streamIndex = indices[index] ?? 0;
      while (stream[streamIndex] === next) {
        streamIndex += 1;
      }
      indices[index] = streamIndex;
    }
  }
  const nextCursor = {
    comparison: consumedCursor(streams[2], indices[2], cursor.comparison),
    mapping: consumedCursor(streams[0], indices[0], cursor.mapping),
    match: consumedCursor(streams[1], indices[1], cursor.match),
  };
  return {
    complete: streams.every(
      (stream, index) =>
        indices[index] === stream.length && stream.length < queryLimit
    ),
    cursor: canonicalJson(nextCursor),
    publicJobIds,
  };
}

function consumedCursor(stream: string[], count: number, fallback: string) {
  return count > 0 ? (stream[count - 1] ?? fallback) : fallback;
}

function parsePublicRootDiscoveryCursor(value: string) {
  if (!value) {
    return { comparison: "", mapping: "", match: "" };
  }
  const cursor = JSON.parse(value) as Record<string, unknown>;
  if (
    typeof cursor.comparison !== "string" ||
    typeof cursor.mapping !== "string" ||
    typeof cursor.match !== "string"
  ) {
    throw new Error("The public-root discovery cursor is invalid");
  }
  return {
    comparison: cursor.comparison,
    mapping: cursor.mapping,
    match: cursor.match,
  };
}

function compareUtf8(left: string, right: string) {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

export function insertPublicRootPageStatement(
  db: D1Database,
  input: { frozenAt: string; rows: FinalWorkPublicRoot[]; runId: string }
) {
  return db
    .prepare(
      `INSERT INTO public_projection_final_work_public_roots (
        run_id,ordinal,originating_public_job_id,redirect_root_id,
        public_member_key,redirect_path_json,public_job_version,
        eligibility_decision_version,
        public_job_created_at,served_publicly,first_published_at,
        founding_source_position_id,allocation_hash,content_head_hash,
        redirect_path_hash,history_hash,allocation_input_hash,row_hash,
        encoded_bytes,created_at
      )
      SELECT ?,CAST(json_extract(value,'$.ordinal') AS INTEGER),
             CAST(json_extract(value,'$.originatingPublicJobId') AS TEXT),
             CAST(json_extract(value,'$.redirectRootId') AS TEXT),
             CAST(json_extract(value,'$.publicMemberKey') AS TEXT),
             CAST(json_extract(value,'$.redirectPathJson') AS TEXT),
             CAST(json_extract(value,'$.publicJobVersion') AS INTEGER),
             CAST(json_extract(
               value,'$.eligibilityDecisionVersion') AS INTEGER),
             CAST(json_extract(value,'$.publicJobCreatedAt') AS TEXT),
             CAST(json_extract(value,'$.servedPublicly') AS INTEGER),
             CAST(json_extract(value,'$.firstPublishedAt') AS TEXT),
             CAST(json_extract(
               value,'$.foundingSourcePositionId') AS TEXT),
             CAST(json_extract(value,'$.allocationHash') AS TEXT),
             CAST(json_extract(value,'$.contentHeadHash') AS TEXT),
             CAST(json_extract(value,'$.redirectPathHash') AS TEXT),
             CAST(json_extract(value,'$.historyHash') AS TEXT),
             CAST(json_extract(value,'$.allocationInputHash') AS TEXT),
             CAST(json_extract(value,'$.rowHash') AS TEXT),
             CAST(json_extract(value,'$.encodedBytes') AS INTEGER),?
        FROM json_each(?)`
    )
    .bind(
      input.runId,
      input.frozenAt,
      pageJson(
        input.rows.map((row) => ({
          ...row,
          redirectPathJson: canonicalJson(row.redirectPath),
          servedPublicly: row.servedPublicly ? 1 : 0,
        })),
        "public root inputs"
      )
    );
}

export function insertRelationWorkPageStatement(
  db: D1Database,
  input: { frozenAt: string; rows: FinalWorkRelation[]; runId: string }
) {
  const payload = pageJson(
    input.rows.map((row) => ({
      ...row,
      leftMemberKey: row.relation.left.memberKey,
      operatorTerminal: 1,
      payloadJson: canonicalJson(row.relation),
      relationHash: row.relation.relationHash,
      relationId: row.relation.id,
      relationState: row.relation.relation,
      rightMemberKey: row.relation.right.memberKey,
    })),
    "final relation work"
  );
  return db
    .prepare(
      `INSERT INTO public_projection_final_work_relations (
        run_id,ordinal,id,left_member_key,right_member_key,payload_json,
        operator_decision_id,operator_decision_hash,operator_terminal,
        relation,relation_hash,encoded_bytes,created_at
      )
      SELECT ?,CAST(json_extract(value,'$.ordinal') AS INTEGER),
             CAST(json_extract(value,'$.relationId') AS TEXT),
             CAST(json_extract(value,'$.leftMemberKey') AS TEXT),
             CAST(json_extract(value,'$.rightMemberKey') AS TEXT),
             CAST(json_extract(value,'$.payloadJson') AS TEXT),
             CAST(json_extract(value,'$.operatorDecisionId') AS TEXT),
             CAST(json_extract(value,'$.operatorDecisionHash') AS TEXT),
             CAST(json_extract(value,'$.operatorTerminal') AS INTEGER),
             CAST(json_extract(value,'$.relationState') AS TEXT),
             CAST(json_extract(value,'$.relationHash') AS TEXT),
             CAST(json_extract(value,'$.encodedBytes') AS INTEGER),?
        FROM json_each(?)`
    )
    .bind(input.runId, input.frozenAt, payload);
}
