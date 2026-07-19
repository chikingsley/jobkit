import type { Job } from "../../src/features/jobs/types";
import {
  type JobMatchFacts,
  JobMatchFactsSchema,
} from "../../src/features/matching/schema";
import { JOB_MATCH_FACTS_SCHEMA_VERSION } from "../../src/features/matching/version";
import { compensationFromRow } from "../repositories/jobs";
import { ANESL_RECIPIENT } from "./application-bundle-model";

const ANESL_BOARD = "anesl";
const MAX_PAGE_SIZE = 100;

export interface AneslPositionPage {
  hasMore: boolean;
  positions: Job[];
  total: number;
}

interface AneslPositionRow extends Record<string, unknown> {
  total_count: number;
}

export async function listAneslPositions(
  db: D1Database,
  userId: string,
  options: { limit: number; offset: number; query: string }
): Promise<AneslPositionPage> {
  const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, options.limit));
  const offset = Math.max(0, options.offset);
  const query = options.query.trim().toLowerCase().slice(0, 120);
  const rows = await db
    .prepare(
      `SELECT j.*,COALESCE(uj.status,'new') status,
              COALESCE(uj.priority,0) priority,
              mf.facts_json,mf.schema_version match_facts_schema_version,
              COUNT(*) OVER() total_count
         FROM jobs j
         JOIN application_routes ar ON ar.id=(
           SELECT candidate.id FROM application_routes candidate
            WHERE candidate.job_id=j.id AND candidate.kind='email'
              AND candidate.status='active'
              AND lower(trim(candidate.destination))=?
            ORDER BY candidate.updated_at DESC LIMIT 1
         )
         LEFT JOIN user_jobs uj ON uj.user_id=? AND uj.job_id=j.id
         LEFT JOIN job_match_facts mf ON mf.job_id=j.id
        WHERE j.inventory_status='active' AND lower(j.board)=?
          AND COALESCE(uj.status,'new') NOT IN ('applied','ignored')
          AND (?='' OR instr(lower(
            COALESCE(j.source_reference,'') || ' ' ||
            COALESCE(j.title,'') || ' ' || COALESCE(j.location,'')
          ),?)>0)
          AND NOT EXISTS (
            SELECT 1 FROM application_bundle_targets existing_target
            JOIN application_bundles existing_bundle
              ON existing_bundle.id=existing_target.bundle_id
            JOIN user_jobs existing_user_job
              ON existing_user_job.id=existing_target.user_job_id
            WHERE existing_target.user_job_id=uj.id
              AND existing_bundle.user_id=?
              AND existing_user_job.user_id=?
              AND existing_bundle.status<>'cancelled'
          )
        ORDER BY uj.priority DESC,
                 (j.compensation_amount_max IS NOT NULL) DESC,
                 j.compensation_amount_max DESC,
                 j.updated_at DESC,j.source_reference
        LIMIT ? OFFSET ?`
    )
    .bind(
      ANESL_RECIPIENT,
      userId,
      ANESL_BOARD,
      query,
      query,
      userId,
      userId,
      limit,
      offset
    )
    .all<AneslPositionRow>();
  const total = Number(rows.results[0]?.total_count ?? 0);
  return {
    hasMore: offset + rows.results.length < total,
    positions: rows.results.map(toAneslPosition),
    total,
  };
}

function toAneslPosition(row: Record<string, unknown>): Job {
  return {
    applicationRoutes: [],
    applyUrl: String(row.apply_url),
    board: String(row.board),
    company: String(row.company),
    compensation: compensationFromRow(row),
    country: String(row.country),
    description: String(row.description),
    draft: null,
    draftTask: null,
    emailAttempt: null,
    id: String(row.id),
    location: String(row.location),
    marketSegments: JSON.parse(String(row.market_segments_json)),
    matchFacts: matchFactsFromRow(row),
    messageRoute: String(row.message_route) as Job["messageRoute"],
    opportunityScope: String(row.opportunity_scope) as Job["opportunityScope"],
    positionAnalysis: null,
    sourceReference: String(row.source_reference),
    sourceUrl: String(row.source_url),
    status: String(row.status),
    title: String(row.title),
  };
}

function matchFactsFromRow(row: Record<string, unknown>): JobMatchFacts | null {
  if (
    !row.facts_json ||
    Number(row.match_facts_schema_version) !== JOB_MATCH_FACTS_SCHEMA_VERSION
  ) {
    return null;
  }
  const parsed = JobMatchFactsSchema.safeParse(
    JSON.parse(String(row.facts_json))
  );
  return parsed.success ? parsed.data : null;
}
