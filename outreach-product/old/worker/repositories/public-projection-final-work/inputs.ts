import { changeAssertion, pageJson } from "./shared";
import type {
  FinalWorkCanonicalMatch,
  FinalWorkCanonicalRequest,
  FinalWorkMappingInput,
  FinalWorkResolutionInput,
} from "./types";

export function insertResolutionInputPageStatement(
  db: D1Database,
  input: {
    frozenAt: string;
    rows: FinalWorkResolutionInput[];
    runId: string;
  }
) {
  const payload = pageJson(input.rows, "resolution inputs");
  return db
    .prepare(
      `INSERT INTO public_projection_final_work_resolution_inputs (
        run_id,ordinal,position_item_id,source_position_id,input_hash,
        checkpoint_json,resolution_state,resolution_reason_code,
        resolution_seal_hash,canonical_signal_hash,member_key,member_hash,
        row_hash,encoded_bytes,created_at
      )
      SELECT ?,CAST(json_extract(value,'$.ordinal') AS INTEGER),
             CAST(json_extract(value,'$.positionItemId') AS TEXT),
             CAST(json_extract(value,'$.sourcePositionId') AS TEXT),
             CAST(json_extract(value,'$.inputHash') AS TEXT),
             CAST(json_extract(value,'$.checkpointJson') AS TEXT),
             CAST(json_extract(value,'$.resolutionState') AS TEXT),
             CAST(json_extract(value,'$.resolutionReasonCode') AS TEXT),
             CAST(json_extract(value,'$.resolutionSealHash') AS TEXT),
             CAST(json_extract(value,'$.canonicalSignalHash') AS TEXT),
             CAST(json_extract(value,'$.memberKey') AS TEXT),
             CAST(json_extract(value,'$.memberHash') AS TEXT),
             CAST(json_extract(value,'$.rowHash') AS TEXT),
             CAST(json_extract(value,'$.encodedBytes') AS INTEGER),?
        FROM json_each(?)`
    )
    .bind(input.runId, input.frozenAt, payload);
}

export async function readResolvedWorkSourcePage(
  db: D1Database,
  input: { cursor: string; limit: number; runId: string }
) {
  const rows = await db
    .prepare(
      `SELECT source_position_id
         FROM public_projection_final_work_resolution_inputs
           INDEXED BY idx_projection_final_resolution_source_page
        WHERE run_id=? AND resolution_state='resolved'
          AND source_position_id>?
        ORDER BY source_position_id
        LIMIT ?`
    )
    .bind(input.runId, input.cursor, input.limit)
    .all<{ source_position_id: string }>();
  return rows.results.map((row) => row.source_position_id);
}

export function insertMappingInputPageStatement(
  db: D1Database,
  input: {
    frozenAt: string;
    rows: FinalWorkMappingInput[];
    runId: string;
  }
) {
  const payload = pageJson(input.rows, "mapping inputs");
  return db
    .prepare(
      `INSERT INTO public_projection_final_work_mapping_inputs (
        run_id,ordinal,source_position_id,head_present,mapping_state,mapping_version,
        public_job_id,mapping_hash,input_hash,row_hash,encoded_bytes,created_at
      )
      SELECT ?,CAST(json_extract(value,'$.ordinal') AS INTEGER),
             CAST(json_extract(value,'$.sourcePositionId') AS TEXT),
             CAST(json_extract(value,'$.headPresent') AS INTEGER),
             CAST(json_extract(value,'$.mappingState') AS TEXT),
             CAST(json_extract(value,'$.mappingVersion') AS INTEGER),
             CAST(json_extract(value,'$.publicJobId') AS TEXT),
             CAST(json_extract(value,'$.mappingHash') AS TEXT),
             CAST(json_extract(value,'$.inputHash') AS TEXT),
             CAST(json_extract(value,'$.rowHash') AS TEXT),
             CAST(json_extract(value,'$.encodedBytes') AS INTEGER),?
        FROM json_each(?)`
    )
    .bind(input.runId, input.frozenAt, payload);
}

export async function assertMappingInputPagePinned(
  db: D1Database,
  input: { rows: FinalWorkMappingInput[]; runId: string }
) {
  if (input.rows.length === 0) {
    return;
  }
  const payload = pageJson(input.rows, "mapping validation inputs");
  const invalid = await db
    .prepare(
      `SELECT COUNT(*) invalid_count
         FROM json_each(?) requested
        WHERE (
          CAST(json_extract(requested.value,'$.mappingState') AS TEXT)='mapped'
        )<>(
          EXISTS (
            SELECT 1
              FROM public_projection_final_work_resolution_inputs owner
              JOIN public_projection_duplicate_comparisons comparison
                ON comparison.run_id=owner.run_id
               AND comparison.owner_position_item_id=owner.position_item_id
             WHERE owner.run_id=? AND owner.resolution_state='resolved'
               AND owner.source_position_id=CAST(json_extract(
                 requested.value,'$.sourcePositionId') AS TEXT)
               AND comparison.target_kind='existing_public'
               AND comparison.reason_code='same_source_position'
               AND comparison.target_public_job_id=CAST(json_extract(
                 requested.value,'$.publicJobId') AS TEXT)
          )
        ) OR EXISTS (
          SELECT 1
            FROM public_projection_final_work_resolution_inputs owner
            JOIN public_projection_duplicate_comparisons comparison
              ON comparison.run_id=owner.run_id
             AND comparison.owner_position_item_id=owner.position_item_id
           WHERE owner.run_id=? AND owner.resolution_state='resolved'
             AND owner.source_position_id=CAST(json_extract(
               requested.value,'$.sourcePositionId') AS TEXT)
             AND comparison.target_kind='existing_public'
             AND comparison.reason_code='same_source_position'
             AND (
               CAST(json_extract(requested.value,'$.mappingState') AS TEXT)
                 <>'mapped'
               OR comparison.target_public_job_id<>CAST(json_extract(
                 requested.value,'$.publicJobId') AS TEXT)
             )
        )`
    )
    .bind(payload, input.runId, input.runId)
    .first<{ invalid_count: number }>();
  if ((invalid?.invalid_count ?? input.rows.length) !== 0) {
    throw new Error("The page-local source mapping evidence changed");
  }
}

export async function readCanonicalRequestSignalPage(
  db: D1Database,
  input: { cursor: string; limit: number; runId: string }
) {
  const signals: string[] = [];
  let { cursor } = input;
  while (signals.length < input.limit) {
    // biome-ignore lint/performance/noAwaitInLoops: Each seek advances to the next distinct indexed signal with a fixed query count.
    const row = await db
      .prepare(
        `SELECT canonical_signal_hash
           FROM public_projection_final_work_resolution_inputs
             INDEXED BY idx_projection_final_resolution_relation_lookup
          WHERE run_id=? AND resolution_state='resolved'
            AND canonical_signal_hash>?
          ORDER BY canonical_signal_hash,member_key,position_item_id LIMIT 1`
      )
      .bind(input.runId, cursor)
      .first<{ canonical_signal_hash: string }>();
    if (!row) {
      break;
    }
    signals.push(row.canonical_signal_hash);
    cursor = row.canonical_signal_hash;
  }
  return signals;
}

export function insertCanonicalRequestPageStatement(
  db: D1Database,
  input: {
    frozenAt: string;
    rows: FinalWorkCanonicalRequest[];
    runId: string;
  }
) {
  const payload = pageJson(input.rows, "canonical requests");
  return db
    .prepare(
      `INSERT INTO public_projection_final_work_canonical_requests (
        run_id,ordinal,signal_hash,request_hash,encoded_bytes,created_at
      )
      SELECT ?,CAST(json_extract(value,'$.ordinal') AS INTEGER),
             CAST(json_extract(value,'$.signalHash') AS TEXT),
             CAST(json_extract(value,'$.requestHash') AS TEXT),
             CAST(json_extract(value,'$.encodedBytes') AS INTEGER),?
        FROM json_each(?)`
    )
    .bind(input.runId, input.frozenAt, payload);
}

export async function readNextUnmatchedCanonicalRequest(
  db: D1Database,
  input: { runId: string }
) {
  const row = await db
    .prepare(
      `SELECT ordinal,signal_hash,request_hash,encoded_bytes,match_count,
              match_digest,match_cursor,match_complete
         FROM public_projection_final_work_canonical_requests
        WHERE run_id=? AND match_complete=0
        ORDER BY signal_hash LIMIT 1`
    )
    .bind(input.runId)
    .first<{
      encoded_bytes: number;
      match_complete: number;
      match_count: number;
      match_cursor: string;
      match_digest: null | string;
      ordinal: number;
      request_hash: string;
      signal_hash: string;
    }>();
  return row
    ? {
        encodedBytes: row.encoded_bytes,
        matchComplete: row.match_complete === 1,
        matchCount: row.match_count,
        matchCursor: row.match_cursor,
        matchDigest: row.match_digest,
        ordinal: row.ordinal,
        requestHash: row.request_hash,
        signalHash: row.signal_hash,
      }
    : null;
}

export function canonicalMatchPageStatements(
  db: D1Database,
  input: {
    completed: boolean;
    digest: string;
    frozenAt: string;
    matches: FinalWorkCanonicalMatch[];
    matchCount: number;
    matchCursor: string;
    priorCount: number;
    priorCursor: string;
    priorDigest: null | string;
    runId: string;
    signalHash: string;
  }
) {
  const payload = pageJson(input.matches, "canonical matches");
  const statements = [
    db
      .prepare(
        `INSERT INTO public_projection_final_work_canonical_matches (
          run_id,ordinal,signal_hash,public_job_id,public_job_version,
          signal_kind,public_member_key,input_hash,row_hash,encoded_bytes,
          created_at
        )
        SELECT ?,CAST(json_extract(value,'$.ordinal') AS INTEGER),
               CAST(json_extract(value,'$.signalHash') AS TEXT),
               CAST(json_extract(value,'$.publicJobId') AS TEXT),
               CAST(json_extract(value,'$.publicJobVersion') AS INTEGER),
               CAST(json_extract(value,'$.signalKind') AS TEXT),
               CAST(json_extract(value,'$.publicMemberKey') AS TEXT),
               CAST(json_extract(value,'$.inputHash') AS TEXT),
               CAST(json_extract(value,'$.rowHash') AS TEXT),
               CAST(json_extract(value,'$.encodedBytes') AS INTEGER),?
          FROM json_each(?)`
      )
      .bind(input.runId, input.frozenAt, payload),
    changeAssertion(db, input.matches.length),
    db
      .prepare(
        `INSERT OR IGNORE INTO public_projection_final_work_canonical_members (
          run_id,public_member_key,signal_hash,created_at
        )
        SELECT ?,CAST(json_extract(value,'$.publicMemberKey') AS TEXT),
               CAST(json_extract(value,'$.signalHash') AS TEXT),?
          FROM json_each(?)`
      )
      .bind(input.runId, input.frozenAt, payload),
    db
      .prepare(
        `UPDATE public_projection_final_work_canonical_requests
            SET match_count=?,match_digest=?,match_cursor=?,match_complete=?
          WHERE run_id=? AND signal_hash=? AND match_complete=0
            AND match_count=? AND match_digest IS ? AND match_cursor=?`
      )
      .bind(
        input.matchCount,
        input.digest,
        input.matchCursor,
        input.completed ? 1 : 0,
        input.runId,
        input.signalHash,
        input.priorCount,
        input.priorDigest,
        input.priorCursor
      ),
    changeAssertion(db, 1),
  ];
  return statements;
}
