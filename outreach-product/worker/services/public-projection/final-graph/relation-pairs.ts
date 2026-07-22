import {
  type CanonicalRelationCandidate,
  FinalDuplicateSnapshotError,
} from "./model";

export const SAME_RUN_CANONICAL_LEFT_KEYSET_SQL = `SELECT left_input.canonical_signal_hash signal_hash,
          left_input.member_key left_member_key,
          left_input.position_item_id left_position_item_id
     FROM public_projection_final_work_resolution_inputs left_input
       INDEXED BY idx_projection_final_resolution_relation_lookup
    WHERE left_input.run_id=?
      AND left_input.resolution_state='resolved'
      AND left_input.canonical_signal_hash IS NOT NULL
      AND (left_input.canonical_signal_hash,left_input.member_key)>(?,?)
      AND EXISTS (
        SELECT 1
          FROM public_projection_final_work_resolution_inputs right_input
            INDEXED BY idx_projection_final_resolution_relation_lookup
         WHERE right_input.run_id=left_input.run_id
           AND right_input.resolution_state='resolved'
           AND right_input.canonical_signal_hash=
               left_input.canonical_signal_hash
           AND right_input.member_key>left_input.member_key
           AND NOT EXISTS (
             SELECT 1 FROM public_projection_duplicate_comparisons comparison
              WHERE comparison.run_id=left_input.run_id
                AND comparison.target_kind='same_run'
                AND comparison.owner_position_item_id=
                    left_input.position_item_id
                AND comparison.target_position_item_id=
                    right_input.position_item_id
           )
           AND NOT EXISTS (
             SELECT 1 FROM public_projection_duplicate_comparisons comparison
              WHERE comparison.run_id=left_input.run_id
                AND comparison.target_kind='same_run'
                AND comparison.owner_position_item_id=
                    right_input.position_item_id
                AND comparison.target_position_item_id=
                    left_input.position_item_id
           )
      )
    ORDER BY left_input.canonical_signal_hash,left_input.member_key LIMIT 1`;

export const SAME_RUN_CANONICAL_RIGHT_PAGE_SQL = `SELECT right_input.member_key right_member_key
     FROM public_projection_final_work_resolution_inputs right_input
       INDEXED BY idx_projection_final_resolution_relation_lookup
    WHERE right_input.run_id=?
      AND right_input.resolution_state='resolved'
      AND right_input.canonical_signal_hash=?
      AND right_input.member_key>?
      AND NOT EXISTS (
        SELECT 1 FROM public_projection_duplicate_comparisons comparison
         WHERE comparison.run_id=right_input.run_id
           AND comparison.target_kind='same_run'
           AND comparison.owner_position_item_id=?
           AND comparison.target_position_item_id=right_input.position_item_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public_projection_duplicate_comparisons comparison
         WHERE comparison.run_id=right_input.run_id
           AND comparison.target_kind='same_run'
           AND comparison.owner_position_item_id=right_input.position_item_id
           AND comparison.target_position_item_id=?
      )
    ORDER BY right_input.member_key LIMIT ?`;

export async function readSameRunCanonicalPairPage(
  db: D1Database,
  input: {
    cursor: null | {
      leftMemberKey: string;
      rightMemberKey: string;
      signalHash: string;
    };
    limit: number;
    runId: string;
  }
): Promise<CanonicalRelationCandidate[]> {
  const candidates: CanonicalRelationCandidate[] = [];
  const initialCursor = input.cursor;
  let signalHash = initialCursor ? initialCursor.signalHash : "";
  let leftMemberKey = initialCursor ? initialCursor.leftMemberKey : "";
  let leftPositionItemId: null | string = null;
  let rightCursor = initialCursor ? initialCursor.rightMemberKey : "";
  let continueCurrentLeft = initialCursor !== null && leftMemberKey !== "";
  while (candidates.length < input.limit) {
    if (continueCurrentLeft) {
      // biome-ignore lint/performance/noAwaitInLoops: The keyset cursor makes each lookup depend on the prior page.
      const left = await db
        .prepare(
          `SELECT position_item_id FROM public_projection_final_work_resolution_inputs
             INDEXED BY idx_projection_final_resolution_relation_lookup
            WHERE run_id=? AND resolution_state='resolved'
              AND canonical_signal_hash=? AND member_key=? LIMIT 1`
        )
        .bind(input.runId, signalHash, leftMemberKey)
        .first<{ position_item_id: string }>();
      leftPositionItemId = left?.position_item_id ?? null;
    } else {
      const left = await db
        .prepare(SAME_RUN_CANONICAL_LEFT_KEYSET_SQL)
        .bind(input.runId, signalHash, leftMemberKey)
        .first<{
          left_member_key: string;
          left_position_item_id: string;
          signal_hash: string;
        }>();
      if (!left) {
        break;
      }
      signalHash = left.signal_hash;
      leftMemberKey = left.left_member_key;
      leftPositionItemId = left.left_position_item_id;
      rightCursor = leftMemberKey;
    }
    if (!leftPositionItemId) {
      throw new FinalDuplicateSnapshotError(
        "The same-run relation cursor lost its left member"
      );
    }
    const remaining = input.limit - candidates.length;
    const rights = await db
      .prepare(SAME_RUN_CANONICAL_RIGHT_PAGE_SQL)
      .bind(
        input.runId,
        signalHash,
        rightCursor,
        leftPositionItemId,
        leftPositionItemId,
        remaining
      )
      .all<{ right_member_key: string }>();
    for (const right of rights.results) {
      candidates.push({
        leftMemberKey,
        rightMemberKey: right.right_member_key,
        signalHash,
      });
    }
    if (rights.results.length === remaining) {
      break;
    }
    continueCurrentLeft = false;
    rightCursor = "";
  }
  return candidates;
}

export const LIVE_CANONICAL_MATCH_KEYSET_SQL = `SELECT member.public_member_key,
          member.signal_hash
     FROM public_projection_final_work_canonical_members member
       INDEXED BY idx_projection_final_canonical_member_page
    WHERE member.run_id=?
      AND (member.public_member_key,member.signal_hash)>(?,?)
      AND EXISTS (
        SELECT 1
          FROM public_projection_final_work_resolution_inputs shadow
            INDEXED BY idx_projection_final_resolution_relation_lookup
         WHERE shadow.run_id=member.run_id
           AND shadow.resolution_state='resolved'
           AND shadow.canonical_signal_hash=member.signal_hash
           AND NOT EXISTS (
             SELECT 1
               FROM public_projection_duplicate_comparisons comparison
               JOIN public_projection_final_work_public_roots d2_root
                 ON d2_root.run_id=comparison.run_id
                AND d2_root.originating_public_job_id=
                    comparison.target_public_job_id
              WHERE comparison.run_id=shadow.run_id
                AND comparison.owner_position_item_id=shadow.position_item_id
                AND comparison.target_kind='existing_public'
                AND d2_root.public_member_key=member.public_member_key
           )
           AND NOT EXISTS (
             SELECT 1 FROM public_projection_final_work_relations work
              WHERE work.run_id=shadow.run_id
                AND work.left_member_key=member.public_member_key
                AND work.right_member_key=shadow.member_key
           )
      )
    ORDER BY member.public_member_key,member.signal_hash LIMIT 1`;

export const LIVE_CANONICAL_SHADOW_PAGE_SQL = `SELECT shadow.member_key,
          shadow.position_item_id
     FROM public_projection_final_work_resolution_inputs shadow
       INDEXED BY idx_projection_final_resolution_relation_lookup
    WHERE shadow.run_id=? AND shadow.resolution_state='resolved'
      AND shadow.canonical_signal_hash=?
      AND (shadow.member_key,shadow.position_item_id)>(?,?)
      AND NOT EXISTS (
        SELECT 1
          FROM public_projection_duplicate_comparisons comparison
          JOIN public_projection_final_work_public_roots d2_root
            ON d2_root.run_id=comparison.run_id
           AND d2_root.originating_public_job_id=
               comparison.target_public_job_id
         WHERE comparison.run_id=shadow.run_id
           AND comparison.owner_position_item_id=shadow.position_item_id
           AND comparison.target_kind='existing_public'
           AND d2_root.public_member_key=?
      )
      AND NOT EXISTS (
        SELECT 1 FROM public_projection_final_work_relations work
         WHERE work.run_id=shadow.run_id
           AND work.left_member_key=?
           AND work.right_member_key=shadow.member_key
      )
    ORDER BY shadow.member_key,shadow.position_item_id LIMIT ?`;

export async function readLiveCanonicalPairPage(
  db: D1Database,
  input: {
    cursor: null | {
      publicMemberKey: string;
      rightMemberKey: string;
      shadowPositionItemId: string;
      signalHash: string;
    };
    limit: number;
    runId: string;
  }
): Promise<CanonicalRelationCandidate[]> {
  const candidates: CanonicalRelationCandidate[] = [];
  const initialCursor = input.cursor ?? {
    publicMemberKey: "",
    rightMemberKey: "",
    shadowPositionItemId: "",
    signalHash: "",
  };
  let {
    publicMemberKey,
    rightMemberKey: shadowMemberKey,
    shadowPositionItemId,
    signalHash,
  } = initialCursor;
  let continueCurrent = input.cursor !== null && publicMemberKey !== "";
  while (candidates.length < input.limit) {
    if (continueCurrent) {
      // biome-ignore lint/performance/noAwaitInLoops: One exact indexed replay lookup resumes the durable nested cursor.
      const current = await db
        .prepare(
          `SELECT 1 FROM public_projection_final_work_canonical_members
            WHERE run_id=? AND public_member_key=? AND signal_hash=? LIMIT 1`
        )
        .bind(input.runId, publicMemberKey, signalHash)
        .first<{ "1": number }>();
      if (!current) {
        throw new FinalDuplicateSnapshotError(
          "The live canonical relation cursor lost its pinned match"
        );
      }
    } else {
      const next = await db
        .prepare(LIVE_CANONICAL_MATCH_KEYSET_SQL)
        .bind(input.runId, publicMemberKey, signalHash)
        .first<{ public_member_key: string; signal_hash: string }>();
      if (!next) {
        break;
      }
      publicMemberKey = next.public_member_key;
      signalHash = next.signal_hash;
      shadowMemberKey = "";
      shadowPositionItemId = "";
    }
    const remaining = input.limit - candidates.length;
    const shadows = await db
      .prepare(LIVE_CANONICAL_SHADOW_PAGE_SQL)
      .bind(
        input.runId,
        signalHash,
        shadowMemberKey,
        shadowPositionItemId,
        publicMemberKey,
        publicMemberKey,
        remaining
      )
      .all<{ member_key: string; position_item_id: string }>();
    for (const shadow of shadows.results) {
      if (!(publicMemberKey < shadow.member_key)) {
        throw new FinalDuplicateSnapshotError(
          "The canonical public/shadow member ordering changed"
        );
      }
      candidates.push({
        leftMemberKey: publicMemberKey,
        liveCursor: {
          publicMemberKey,
          shadowMemberKey: shadow.member_key,
          shadowPositionItemId: shadow.position_item_id,
          signalHash,
        },
        rightMemberKey: shadow.member_key,
        signalHash,
      });
    }
    if (shadows.results.length === remaining) {
      break;
    }
    continueCurrent = false;
    shadowMemberKey = "";
    shadowPositionItemId = "";
  }
  return candidates;
}
