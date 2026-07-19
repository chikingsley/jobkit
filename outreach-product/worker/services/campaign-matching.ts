import { compensationFromEconomics } from "../../src/features/jobs/economics";
import {
  type JobPositionAnalysis,
  JobPositionAnalysisSchema,
} from "../../src/features/jobs/position-variants";
import type { Job } from "../../src/features/jobs/types";
import {
  type JobMatchFacts,
  JobMatchFactsSchema,
} from "../../src/features/matching/schema";
import {
  JOB_MATCH_FACTS_SCHEMA_VERSION,
  MATCHING_ENGINE_VERSION,
} from "../../src/features/matching/version";
import type { AppEnv } from "../env";
import { readAutomationPolicy } from "../repositories/automation-policy";
import { compensationFromRow } from "../repositories/jobs";
import { evaluateJobWithContext, readMatchingContext } from "./matching-engine";

interface CampaignMatchingRow extends Record<string, unknown> {
  campaign_id: string;
  target_id: string;
  user_id: string;
}

interface MatchUpdate {
  holdReason: string;
  id: string;
  label: string;
  score: number;
  snapshot: Record<string, unknown>;
  status: "eligible" | "held";
}

const D1_MAX_ROW_BYTES = 2_000_000;
const MATCH_UPDATE_PAYLOAD_BYTES = D1_MAX_ROW_BYTES / 2;

export async function runCampaignMatchingPass(env: AppEnv) {
  const campaign = await env.DB.prepare(
    `SELECT c.id campaign_id,c.user_id
         FROM campaigns c
        WHERE c.status='preparing'
        ORDER BY c.created_at LIMIT 1`
  ).first<{ campaign_id: string; user_id: string }>();
  if (!campaign) {
    return { campaignId: null, matched: 0 };
  }
  return matchCampaignTargets(env, campaign.user_id, campaign.campaign_id);
}

export async function matchCampaignTargets(
  env: AppEnv,
  userId: string,
  campaignId: string,
  jobId?: string
) {
  const [rows, context, policy] = await Promise.all([
    readCampaignMatchingRows(env.DB, userId, campaignId, jobId),
    readMatchingContext(env, userId),
    readAutomationPolicy(env.DB, userId),
  ]);
  const updates = rows.map((row): MatchUpdate => {
    const job = matchingJobFromRow(row);
    const match = evaluateJobWithContext(job, context);
    const eligible =
      match.label === "Strong match" ||
      (match.label === "Likely match" && policy.value.minimumFit === "likely");
    return {
      holdReason: eligible ? "" : `Campaign matching result: ${match.label}`,
      id: row.target_id,
      label: match.label,
      score: match.score,
      snapshot: {
        criteria: match.criteria,
        evaluatedAt: new Date().toISOString(),
        fxUpdatedAt: context.fx.updatedAt,
        matchingEngineVersion: MATCHING_ENGINE_VERSION,
        minimumFit: policy.value.minimumFit,
      },
      status: eligible ? "eligible" : "held",
    };
  });
  const timestamp = new Date().toISOString();
  const statements = matchUpdateStatements(
    env.DB,
    campaignId,
    updates,
    timestamp
  );
  statements.push(
    env.DB.prepare(
      `UPDATE campaigns SET status='draft',updated_at=?
          WHERE id=? AND user_id=? AND status='preparing'`
    ).bind(timestamp, campaignId, userId)
  );
  await env.DB.batch(statements);
  return { campaignId, matched: updates.length };
}

export async function refreshCampaignMatchesForJob(
  env: AppEnv,
  userId: string,
  jobId: string
) {
  const campaigns = await env.DB.prepare(
    `SELECT DISTINCT c.id
         FROM campaigns c
         JOIN campaign_targets t ON t.campaign_id=c.id
        WHERE c.user_id=? AND t.job_id=?
          AND c.status NOT IN ('completed','canceled')
          AND (
            t.status='eligible'
            OR (
              t.status='held'
              AND t.hold_reason LIKE 'Campaign matching result:%'
            )
          )
        ORDER BY c.created_at`
  )
    .bind(userId, jobId)
    .all<{ id: string }>();
  const results: Array<{ campaignId: string; matched: number }> = [];
  for (const campaign of campaigns.results) {
    // biome-ignore lint/performance/noAwaitInLoops: One job update must serialize D1 batches across every campaign that owns it.
    results.push(await matchCampaignTargets(env, userId, campaign.id, jobId));
  }
  return results;
}

function readCampaignMatchingRows(
  db: D1Database,
  userId: string,
  campaignId: string,
  jobId?: string
) {
  const targetedFilter = jobId
    ? `AND t.job_id=?
       AND (
         t.status='eligible'
         OR (
           t.status='held'
           AND t.hold_reason LIKE 'Campaign matching result:%'
         )
       )`
    : `AND t.status='eligible' AND t.match_label=''`;
  const query = db.prepare(
    `SELECT t.id target_id,t.campaign_id,c.user_id,j.*,
              mf.facts_json,mf.schema_version match_facts_schema_version,
              (
                SELECT json_object(
                  'scope',analysis.scope,
                  'reviewNotes',json(analysis.review_notes_json),
                  'positions',COALESCE((
                    SELECT json_group_array(json_object(
                      'title',variant.title,
                      'roleFamily',variant.role_family,
                      'subjects',json(variant.subjects_json),
                      'locations',json(variant.locations_json),
                      'audiences',json(variant.audiences_json),
                      'employmentTypes',json(variant.employment_types_json),
                      'requirements',json(variant.requirements_json),
                      'evidence',json(variant.evidence_json),
                      'compensationEvidence',
                        json(variant.compensation_evidence_json),
                      'certainty',variant.certainty
                    ))
                    FROM job_position_variants variant
                    WHERE variant.job_id=j.id ORDER BY variant.ordinal
                  ),'[]')
                )
                FROM job_position_analyses analysis
                WHERE analysis.job_id=j.id AND analysis.schema_version=2
              ) position_analysis_json
         FROM campaign_targets t
         JOIN campaigns c ON c.id=t.campaign_id
         JOIN jobs j ON j.id=t.job_id
         LEFT JOIN job_match_facts mf ON mf.job_id=j.id
        WHERE t.campaign_id=? AND c.user_id=?
          AND t.source_kind='advertised'
          ${targetedFilter}`
  );
  return (
    jobId
      ? query.bind(campaignId, userId, jobId)
      : query.bind(campaignId, userId)
  )
    .all<CampaignMatchingRow>()
    .then((result) => result.results);
}

function matchingJobFromRow(row: CampaignMatchingRow): Job {
  const matchFacts = matchFactsFromRow(row);
  const compensation = matchFacts
    ? compensationFromEconomics(matchFacts.economics)
    : compensationFromRow(row);
  return {
    applicationRoutes: [],
    applyUrl: String(row.apply_url),
    board: String(row.board),
    company: String(row.company),
    compensation,
    country: String(row.country),
    description: String(row.description),
    draft: null,
    draftTask: null,
    emailAttempt: null,
    id: String(row.id),
    location: String(row.location),
    marketSegments: JSON.parse(
      String(row.market_segments_json)
    ) as Job["marketSegments"],
    matchFacts,
    messageRoute: String(row.message_route) as Job["messageRoute"],
    opportunityScope: String(row.opportunity_scope) as Job["opportunityScope"],
    positionAnalysis: positionAnalysisFromRow(row),
    sourceReference: String(row.source_reference),
    sourceUrl: String(row.source_url),
    status: "new",
    title: String(row.title),
  };
}

function matchFactsFromRow(row: CampaignMatchingRow): JobMatchFacts | null {
  if (
    !row.facts_json ||
    Number(row.match_facts_schema_version) !== JOB_MATCH_FACTS_SCHEMA_VERSION
  ) {
    return null;
  }
  const parsed = JobMatchFactsSchema.safeParse(
    JSON.parse(String(row.facts_json)) as unknown
  );
  return parsed.success ? parsed.data : null;
}

function positionAnalysisFromRow(
  row: CampaignMatchingRow
): JobPositionAnalysis | null {
  if (!row.position_analysis_json) {
    return null;
  }
  const parsed = JobPositionAnalysisSchema.safeParse(
    JSON.parse(String(row.position_analysis_json)) as unknown
  );
  return parsed.success ? parsed.data : null;
}

function matchUpdateStatements(
  db: D1Database,
  campaignId: string,
  updates: MatchUpdate[],
  timestamp: string
) {
  return splitMatchUpdates(updates).map((batch) =>
    db
      .prepare(
        `WITH updates AS (
          SELECT
            json_extract(value,'$.id') id,
            json_extract(value,'$.status') status,
            json_extract(value,'$.holdReason') hold_reason,
            json_extract(value,'$.label') match_label,
            json_extract(value,'$.score') match_score,
            json_extract(value,'$.snapshot') match_snapshot_json
          FROM json_each(?)
        )
        UPDATE campaign_targets
           SET status=(SELECT status FROM updates WHERE id=campaign_targets.id),
               hold_reason=(
                 SELECT hold_reason FROM updates WHERE id=campaign_targets.id
               ),
               match_label=(
                 SELECT match_label FROM updates WHERE id=campaign_targets.id
               ),
               match_score=(
                 SELECT match_score FROM updates WHERE id=campaign_targets.id
               ),
               match_snapshot_json=(
                 SELECT match_snapshot_json FROM updates
                  WHERE id=campaign_targets.id
               ),
               updated_at=?
         WHERE campaign_id=? AND id IN (SELECT id FROM updates)`
      )
      .bind(JSON.stringify(batch), timestamp, campaignId)
  );
}

function splitMatchUpdates(updates: MatchUpdate[]) {
  const batches: MatchUpdate[][] = [];
  let current: MatchUpdate[] = [];
  let bytes = 2;
  for (const update of updates) {
    const updateBytes = new TextEncoder().encode(JSON.stringify(update)).length;
    if (
      current.length > 0 &&
      bytes + updateBytes > MATCH_UPDATE_PAYLOAD_BYTES
    ) {
      batches.push(current);
      current = [];
      bytes = 2;
    }
    current.push(update);
    bytes += updateBytes + 1;
  }
  if (current.length > 0) {
    batches.push(current);
  }
  return batches;
}
