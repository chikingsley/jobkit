import { pageJson } from "./shared";
import { type FinalWorkPublicRoot, PUBLIC_FINAL_WORK_PAGE_SIZE } from "./types";

export interface ComponentMemberInput {
  eligibilityDecisionVersion: null | number;
  inputHash: null | string;
  kind: "public" | "shadow";
  memberHash: null | string;
  memberKey: string;
  positionItemId: null | string;
  publicJobId: null | string;
  publicJobVersion: null | number;
  sourcePositionId: null | string;
}

export interface ComponentRootCandidate {
  memberKey: string;
  snapshot: FinalWorkPublicRoot;
}

export interface ComponentRootCandidateInput {
  firstPublishedSort: string;
  memberKey: string;
  originatingPublicJobId: string;
  publicJobCreatedAt: string;
  publishedMissingRank: 0 | 1;
  redirectRootId: string;
  servedPublicly: 0 | 1;
}

export const COMPONENT_ROOT_CANDIDATE_PAGE_SIZE =
  PUBLIC_FINAL_WORK_PAGE_SIZE * 2;

export async function readComponentRootCandidateInputs(
  db: D1Database,
  input: { memberKeys: string[]; runId: string }
): Promise<ComponentRootCandidateInput[]> {
  const memberKeys = [...new Set(input.memberKeys)].sort();
  if (memberKeys.length === 0) {
    return [];
  }
  const payload = pageJson(
    memberKeys,
    "component root candidate member keys",
    COMPONENT_ROOT_CANDIDATE_PAGE_SIZE
  );
  const rows = await db
    .prepare(
      `WITH requested(member_key) AS (
        SELECT CAST(value AS TEXT) FROM json_each(?)
      )
      SELECT root.public_member_key member_key,
             root.originating_public_job_id,root.served_publicly,
             CASE WHEN root.served_publicly=1
                       AND root.first_published_at IS NULL
               THEN 1 ELSE 0 END published_missing_rank,
             CASE WHEN root.served_publicly=1
               THEN COALESCE(root.first_published_at,'') ELSE ''
             END first_published_sort,
             root.public_job_created_at,root.redirect_root_id
        FROM requested
        JOIN public_projection_final_work_public_roots root
          ON root.run_id=? AND root.public_member_key=requested.member_key
         AND root.originating_public_job_id=(
           SELECT candidate.originating_public_job_id
             FROM public_projection_final_work_public_roots candidate
                  INDEXED BY idx_projection_final_public_root_member_page
            WHERE candidate.run_id=?
              AND candidate.public_member_key=requested.member_key
            ORDER BY candidate.originating_public_job_id LIMIT 1
         )
       ORDER BY root.public_member_key`
    )
    .bind(payload, input.runId, input.runId)
    .all<{
      first_published_sort: string;
      member_key: string;
      originating_public_job_id: string;
      public_job_created_at: string;
      published_missing_rank: number;
      redirect_root_id: string;
      served_publicly: number;
    }>();
  return rows.results.map((row) => ({
    firstPublishedSort: row.first_published_sort,
    memberKey: row.member_key,
    originatingPublicJobId: row.originating_public_job_id,
    publicJobCreatedAt: row.public_job_created_at,
    publishedMissingRank: row.published_missing_rank === 1 ? 1 : 0,
    redirectRootId: row.redirect_root_id,
    servedPublicly: row.served_publicly === 1 ? 1 : 0,
  }));
}

interface RelationMemberPair {
  leftMemberKey: string;
  rightMemberKey: string;
}

function relationPairPayload(pairs: RelationMemberPair[]) {
  return pageJson(pairs, "relation member pairs");
}

export async function readRelationPageMemberInputs(
  db: D1Database,
  input: { pairs: RelationMemberPair[]; runId: string }
): Promise<ComponentMemberInput[]> {
  if (input.pairs.length === 0) {
    return [];
  }
  const payload = relationPairPayload(input.pairs);
  const rows = await db
    .prepare(
      `WITH requested(member_key) AS (
        SELECT CAST(json_extract(value,'$.leftMemberKey') AS TEXT)
          FROM json_each(?)
        UNION
        SELECT CAST(json_extract(value,'$.rightMemberKey') AS TEXT)
          FROM json_each(?)
      ), candidates AS (
      SELECT input.member_key member_key,'shadow' kind,input.position_item_id,
             input.source_position_id,input.input_hash,input.member_hash,
             NULL public_job_id,NULL public_job_version,
             NULL eligibility_decision_version
        FROM requested
        JOIN public_projection_final_work_resolution_inputs input
          ON input.run_id=? AND input.member_key=requested.member_key
      UNION ALL
      SELECT requested.member_key,'public' kind,NULL,NULL,NULL,NULL,
             root.redirect_root_id,root.public_job_version,
             root.eligibility_decision_version
        FROM requested
        JOIN public_projection_final_work_public_roots root
          ON root.run_id=? AND root.public_member_key=requested.member_key
         AND root.originating_public_job_id=(
           SELECT candidate.originating_public_job_id
             FROM public_projection_final_work_public_roots candidate
               INDEXED BY idx_projection_final_public_root_member_page
            WHERE candidate.run_id=?
              AND candidate.public_member_key=requested.member_key
            ORDER BY candidate.originating_public_job_id LIMIT 1
         )
      )
      SELECT * FROM candidates ORDER BY member_key`
    )
    .bind(payload, payload, input.runId, input.runId, input.runId)
    .all<{
      eligibility_decision_version: null | number;
      input_hash: null | string;
      kind: "public" | "shadow";
      member_hash: null | string;
      member_key: string;
      position_item_id: null | string;
      public_job_id: null | string;
      public_job_version: null | number;
      source_position_id: null | string;
    }>();
  return rows.results.map((row) => ({
    eligibilityDecisionVersion: row.eligibility_decision_version,
    inputHash: row.input_hash,
    kind: row.kind,
    memberHash: row.member_hash,
    memberKey: row.member_key,
    positionItemId: row.position_item_id,
    publicJobId: row.public_job_id,
    publicJobVersion: row.public_job_version,
    sourcePositionId: row.source_position_id,
  }));
}

export async function readRelationPageCanonicalSignals(
  db: D1Database,
  input: { pairs: RelationMemberPair[]; runId: string }
) {
  if (input.pairs.length === 0) {
    return [];
  }
  const payload = relationPairPayload(input.pairs);
  const rows = await db
    .prepare(
      `WITH requested(member_key) AS (
        SELECT CAST(json_extract(value,'$.leftMemberKey') AS TEXT)
          FROM json_each(?)
        UNION
        SELECT CAST(json_extract(value,'$.rightMemberKey') AS TEXT)
          FROM json_each(?)
      ), signals AS (
      SELECT input.member_key member_key,
             input.canonical_signal_hash signal_hash
        FROM requested
        JOIN public_projection_final_work_resolution_inputs input
          ON input.run_id=? AND input.member_key=requested.member_key
       WHERE input.canonical_signal_hash IS NOT NULL
      UNION
      SELECT requested.member_key,member.signal_hash
        FROM requested
        JOIN public_projection_final_work_canonical_members member
          ON member.run_id=?
         AND member.public_member_key=requested.member_key
      )
      SELECT * FROM signals ORDER BY member_key,signal_hash LIMIT ?`
    )
    .bind(
      payload,
      payload,
      input.runId,
      input.runId,
      COMPONENT_ROOT_CANDIDATE_PAGE_SIZE + 1
    )
    .all<{ member_key: string; signal_hash: string }>();
  if (rows.results.length > COMPONENT_ROOT_CANDIDATE_PAGE_SIZE) {
    throw new Error(
      "The relation canonical signal page exceeded its row budget"
    );
  }
  return rows.results.map((row) => ({
    memberKey: row.member_key,
    signalHash: row.signal_hash,
  }));
}

export async function readComponentMemberPage(
  db: D1Database,
  input: { cursor: string; limit: number; runId: string; seedMemberKey: string }
): Promise<ComponentMemberInput[]> {
  const rows = await db
    .prepare(
      `WITH candidates AS (
        SELECT frontier.member_key,'shadow' kind,input.position_item_id,
               input.source_position_id,input.input_hash,input.member_hash,
               NULL public_job_id,NULL public_job_version,
               NULL eligibility_decision_version
          FROM public_projection_final_component_frontier frontier
          JOIN public_projection_final_work_resolution_inputs input
            ON input.run_id=frontier.run_id
           AND input.member_key=frontier.member_key
         WHERE frontier.run_id=? AND frontier.seed_member_key=?
        UNION ALL
        SELECT frontier.member_key,'public' kind,NULL,NULL,NULL,NULL,
               root.redirect_root_id,root.public_job_version,
               root.eligibility_decision_version
          FROM public_projection_final_component_frontier frontier
          JOIN public_projection_final_work_public_roots root
            ON root.run_id=frontier.run_id
           AND root.public_member_key=frontier.member_key
           AND root.originating_public_job_id=(
             SELECT candidate.originating_public_job_id
               FROM public_projection_final_work_public_roots candidate
                 INDEXED BY idx_projection_final_public_root_member_page
              WHERE candidate.run_id=frontier.run_id
                AND candidate.public_member_key=frontier.member_key
              ORDER BY candidate.originating_public_job_id LIMIT 1
           )
         WHERE frontier.run_id=? AND frontier.seed_member_key=?
      )
      SELECT * FROM candidates WHERE member_key>?
       ORDER BY member_key LIMIT ?`
    )
    .bind(
      input.runId,
      input.seedMemberKey,
      input.runId,
      input.seedMemberKey,
      input.cursor,
      input.limit
    )
    .all<{
      eligibility_decision_version: null | number;
      input_hash: null | string;
      kind: "public" | "shadow";
      member_hash: null | string;
      member_key: string;
      position_item_id: null | string;
      public_job_id: null | string;
      public_job_version: null | number;
      source_position_id: null | string;
    }>();
  return rows.results.map((row) => ({
    eligibilityDecisionVersion: row.eligibility_decision_version,
    inputHash: row.input_hash,
    kind: row.kind,
    memberHash: row.member_hash,
    memberKey: row.member_key,
    positionItemId: row.position_item_id,
    publicJobId: row.public_job_id,
    publicJobVersion: row.public_job_version,
    sourcePositionId: row.source_position_id,
  }));
}
