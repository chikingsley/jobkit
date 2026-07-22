import {
  JOB_CONTENT_ANALYSIS_SCHEMA_VERSION,
  type JobContentAnalysis,
  JobContentAnalysisSchema,
} from "../../src/features/jobs/content-analysis";
import {
  compensationFromEconomics,
  housingLabel,
  statedHourlyValueUsd,
} from "../../src/features/jobs/economics";
import {
  JOB_POSITION_ANALYSIS_SCHEMA_VERSION,
  type JobPositionAnalysis,
  JobPositionAnalysisSchema,
} from "../../src/features/jobs/position-variants";
import type { Job, JobListItem } from "../../src/features/jobs/types";
import {
  type JobMatchFacts,
  JobMatchFactsSchema,
} from "../../src/features/matching/schema";
import {
  JOB_MATCH_FACTS_SCHEMA_VERSION,
  MATCHING_ENGINE_VERSION,
} from "../../src/features/matching/version";
import type { JobMatch } from "../../src/profile-types";
import type { JobKitApp } from "../app-types";
import {
  readAutomationPolicy,
  writeAutomationPolicy,
} from "../repositories/automation-policy";
import { compensationFromRow } from "../repositories/jobs";
import { queueJobDraftGeneration } from "../services/application-drafts";
import {
  evaluateJobWithContext,
  readMatchingContext,
} from "../services/matching-engine";

export function registerJobRoutes(app: JobKitApp) {
  app.post("/api/jobs/:id/generate", async (c) => {
    const taskRequest = await queueJobDraftGeneration(
      c.env,
      c.get("user").id,
      c.req.param("id")
    );
    return c.json(
      {
        message: "Application queued for your Codex agent",
        ok: true,
        taskRequest,
      },
      202
    );
  });

  app.get("/api/jobs", async (c) => {
    const userId = c.get("user").id;
    const rows = await c.env.DB.prepare(
      `WITH contact_counts AS (
         SELECT cc.contact_id,COUNT(DISTINCT ar.job_id) related_listing_count
         FROM application_routes ar
         JOIN contact_channels cc ON cc.id=ar.contact_channel_id
         WHERE ar.kind='email' AND ar.status='active'
         GROUP BY cc.contact_id
       ), active_email_routes AS (
         SELECT ar.job_id,json_group_array(json_object(
           'id',ar.id,
           'kind',ar.kind,
           'destination',ar.destination,
           'status',ar.status,
           'lastVerifiedAt',ar.last_verified_at,
           'contact',CASE WHEN contact.id IS NULL THEN NULL ELSE json_object(
             'id',contact.id,
             'displayName',contact.display_name,
             'organizationName',contact.organization_name,
             'role',contact.role,
             'relatedListingCount',COALESCE(counts.related_listing_count,0)
           ) END
         )) routes_json
         FROM application_routes ar
         LEFT JOIN contact_channels channel ON channel.id=ar.contact_channel_id
         LEFT JOIN contacts contact ON contact.id=channel.contact_id
         LEFT JOIN contact_counts counts ON counts.contact_id=contact.id
         WHERE ar.kind='email' AND ar.status='active'
         GROUP BY ar.job_id
       )
       SELECT j.id,j.board,j.title,j.company,j.country,j.location,
                j.market_segments_json,j.message_route,j.opportunity_scope,
                (
                  SELECT mapping.public_job_id
                  FROM job_source_positions position
                  JOIN job_source_position_mapping_heads mapping_head
                    ON mapping_head.source_position_id=position.id
                  JOIN job_source_position_mapping_versions mapping
                    ON mapping.source_position_id=position.id
                   AND mapping.version=mapping_head.current_version
                  WHERE position.listing_id=j.id
                    AND mapping.mapping_state='mapped'
                    AND mapping.public_job_id IS NOT NULL
                  ORDER BY position.id
                  LIMIT 1
                ) public_job_id,
                j.compensation_display,j.compensation_amount_min,
                j.compensation_amount_max,j.compensation_currency,
                j.compensation_period,j.compensation_qualifier,
                j.compensation_source,j.compensation_confidence,
                j.compensation_notes_json,
                uj.status,uj.priority,
                mf.facts_json,mf.schema_version match_facts_schema_version,
                CASE
                  WHEN mf.job_id IS NULL THEN 'pending'
                  WHEN mf.schema_version<>? OR mf.updated_at<j.updated_at THEN 'stale'
                  ELSE 'current'
                END match_facts_analysis_status,
                CASE
                  WHEN pa_status.job_id IS NULL THEN 'pending'
                  WHEN pa_status.schema_version<>? OR pa_status.updated_at<j.updated_at THEN 'stale'
                  ELSE 'current'
                END position_analysis_status,
                CASE
                  WHEN content.job_id IS NULL THEN 'pending'
                  WHEN content.schema_version<>? OR content.updated_at<j.updated_at THEN 'stale'
                  ELSE 'current'
                END content_analysis_status,
                (SELECT COUNT(*) FROM job_position_variants pv_count
                  WHERE pv_count.job_id=j.id) position_count,
                (
                  SELECT json_object(
                    'scope',pa.scope,
                    'reviewNotes',json(pa.review_notes_json),
                    'positions',COALESCE((
                      SELECT json_group_array(json_object(
                        'title',pv.title,
                        'roleFamily',pv.role_family,
                        'subjects',json(pv.subjects_json),
                        'locations',json(pv.locations_json),
                        'audiences',json(pv.audiences_json),
                        'employmentTypes',json(pv.employment_types_json),
                        'requirements',json(pv.requirements_json),
                        'evidence',json(pv.evidence_json),
                        'compensationEvidence',json(pv.compensation_evidence_json),
                        'certainty',pv.certainty
                      ))
                      FROM job_position_variants pv
                      WHERE pv.job_id=j.id
                      ORDER BY pv.ordinal
                    ),'[]')
                  )
                  FROM job_position_analyses pa
                  WHERE pa.job_id=j.id
                    AND pa.schema_version=${JOB_POSITION_ANALYSIS_SCHEMA_VERSION}
                ) position_analysis_json,
                (
                  SELECT json_object(
                    'attemptId',a.id,
                    'draftId',a.draft_id,
                    'recipient',a.recipient,
                    'routeId',a.route_id,
                    'sendRequestedAt',a.send_requested_at,
                    'status',a.status,
                    'subject',a.subject,
                    'updatedAt',a.updated_at
                  )
                  FROM application_attempts a
                  WHERE a.user_job_id=uj.id
                  ORDER BY a.created_at DESC LIMIT 1
                ) email_attempt_json,
                COALESCE(routes.routes_json,'[]') application_routes_json,
                (
                  SELECT json_object(
                    'id',atr.id,
                    'status',atr.status,
                    'mode',json_extract(atr.input_json,'$.mode'),
                    'error',atr.error_detail,
                    'updatedAt',atr.updated_at
                  )
                  FROM agent_task_requests atr
                  WHERE atr.user_id=?
                    AND atr.task_type='application.message'
                    AND atr.subject_type='job'
                    AND atr.subject_id=j.id
                  ORDER BY atr.created_at DESC LIMIT 1
                ) draft_task_json
         FROM job_listings j
         LEFT JOIN user_listing_states uj ON uj.job_id=j.id AND uj.user_id=?
         LEFT JOIN job_match_facts mf ON mf.job_id=j.id
         LEFT JOIN job_position_analyses pa_status ON pa_status.job_id=j.id
         LEFT JOIN job_content_analyses content ON content.job_id=j.id
         LEFT JOIN active_email_routes routes ON routes.job_id=j.id
         WHERE j.inventory_status='active'
         ORDER BY COALESCE(uj.priority,0) DESC,
           CASE COALESCE(uj.status,'new')
             WHEN 'new' THEN 0 WHEN 'review' THEN 1 WHEN 'approved' THEN 2
             WHEN 'applied' THEN 4 ELSE 3
           END,
           COALESCE(uj.updated_at,j.updated_at) DESC`
    )
      .bind(
        JOB_MATCH_FACTS_SCHEMA_VERSION,
        JOB_POSITION_ANALYSIS_SCHEMA_VERSION,
        JOB_CONTENT_ANALYSIS_SCHEMA_VERSION,
        userId,
        userId
      )
      .all();
    const context = await readMatchingContext(c.env, userId);
    const evaluated = rows.results.map((row) => {
      const job = toListEvaluationJob(row);
      const match = evaluateJobWithContext(job, context);
      return {
        job: toListJob(job, row, context.fx),
        match: summarizeMatch(match),
      };
    });
    return c.json({
      fx: context.fx,
      jobs: evaluated.map(({ job }) => job),
      matches: Object.fromEntries(
        evaluated.map(({ job, match }) => [job.id, match])
      ),
      matchingEngineVersion: MATCHING_ENGINE_VERSION,
    });
  });

  app.get("/api/jobs/:id", async (c) => {
    const userId = c.get("user").id;
    const row = await readReviewJob(c.env.DB, userId, c.req.param("id"));
    if (!row) {
      return c.json({ error: "Job was not found" }, 404);
    }
    const job = toReviewJob(row) as Job;
    const context = await readMatchingContext(c.env, userId);
    return c.json({
      job,
      match: evaluateJobWithContext(job, context),
      matchingEngineVersion: MATCHING_ENGINE_VERSION,
    });
  });

  app.get("/api/automation-policy", async (c) => {
    const result = await readAutomationPolicy(c.env.DB, c.get("user").id);
    return c.json({ policy: result.value, updatedAt: result.updatedAt });
  });

  app.put("/api/automation-policy", async (c) => {
    const result = await writeAutomationPolicy(
      c.env.DB,
      c.get("user").id,
      await c.req.json()
    );
    return c.json({
      message: "Automation policy saved",
      ok: true,
      policy: result.value,
      updatedAt: result.updatedAt,
    });
  });
}

function readReviewJob(db: D1Database, userId: string, jobId: string) {
  return db
    .prepare(
      `SELECT j.*,uj.status,uj.priority,
              (
                SELECT mapping.public_job_id
                FROM job_source_positions position
                JOIN job_source_position_mapping_heads mapping_head
                  ON mapping_head.source_position_id=position.id
                JOIN job_source_position_mapping_versions mapping
                  ON mapping.source_position_id=position.id
                 AND mapping.version=mapping_head.current_version
                WHERE position.listing_id=j.id
                  AND mapping.mapping_state='mapped'
                  AND mapping.public_job_id IS NOT NULL
                ORDER BY position.id
                LIMIT 1
              ) public_job_id,
              mf.facts_json,mf.schema_version match_facts_schema_version,
              CASE
                WHEN mf.job_id IS NULL THEN 'pending'
                WHEN mf.schema_version<>? OR mf.updated_at<j.updated_at THEN 'stale'
                ELSE 'current'
              END match_facts_analysis_status,
              CASE
                WHEN pa_status.job_id IS NULL THEN 'pending'
                WHEN pa_status.schema_version<>? OR pa_status.updated_at<j.updated_at THEN 'stale'
                ELSE 'current'
              END position_analysis_status,
              CASE
                WHEN content.job_id IS NULL THEN 'pending'
                WHEN content.schema_version<>? OR content.updated_at<j.updated_at THEN 'stale'
                ELSE 'current'
              END content_analysis_status,
              content.content_json,content.schema_version content_analysis_schema_version,
              (
                SELECT json_object(
                  'scope',pa.scope,
                  'reviewNotes',json(pa.review_notes_json),
                  'positions',COALESCE((
                    SELECT json_group_array(json_object(
                      'title',pv.title,
                      'roleFamily',pv.role_family,
                      'subjects',json(pv.subjects_json),
                      'locations',json(pv.locations_json),
                      'audiences',json(pv.audiences_json),
                      'employmentTypes',json(pv.employment_types_json),
                      'requirements',json(pv.requirements_json),
                      'evidence',json(pv.evidence_json),
                      'compensationEvidence',json(pv.compensation_evidence_json),
                      'certainty',pv.certainty
                    ))
                    FROM job_position_variants pv
                    WHERE pv.job_id=j.id
                    ORDER BY pv.ordinal
                  ),'[]')
                )
                FROM job_position_analyses pa
                WHERE pa.job_id=j.id
                  AND pa.schema_version=${JOB_POSITION_ANALYSIS_SCHEMA_VERSION}
              ) position_analysis_json,
              d.id draft_id,d.version,d.message,d.change_summary,
              d.status draft_status,d.created_at draft_created_at,
              d.revision_source,
              COALESCE((
                SELECT previous.message FROM application_drafts previous
                WHERE previous.user_job_id=uj.id AND previous.version<d.version
                ORDER BY previous.version DESC LIMIT 1
              ),'') previous_message,
              COALESCE((
                SELECT json_group_array(json_object(
                  'category',da.category,
                  'filename',da.filename,
                  'sizeBytes',da.size_bytes
                ))
                FROM application_draft_attachments da
                WHERE da.draft_id=d.id
              ),'[]') draft_attachments_json,
              (
                SELECT json_object(
                  'attemptId',a.id,
                  'draftId',a.draft_id,
                  'recipient',a.recipient,
                  'routeId',a.route_id,
                  'sendRequestedAt',a.send_requested_at,
                  'status',a.status,
                  'subject',a.subject,
                  'updatedAt',a.updated_at
                )
                FROM application_attempts a
                WHERE a.user_job_id=uj.id AND a.draft_id=d.id
                ORDER BY a.created_at DESC LIMIT 1
              ) email_attempt_json,
              COALESCE((
                SELECT json_group_array(json_object(
                  'id',ar.id,
                  'kind',ar.kind,
                  'destination',ar.destination,
                  'status',ar.status,
                  'lastVerifiedAt',ar.last_verified_at,
                  'contact',CASE WHEN contact.id IS NULL THEN NULL ELSE json_object(
                    'id',contact.id,
                    'displayName',contact.display_name,
                    'organizationName',contact.organization_name,
                    'role',contact.role,
                    'relatedListingCount',(
                      SELECT COUNT(DISTINCT related_route.job_id)
                      FROM contact_channels related_channel
                      JOIN application_routes related_route
                        ON related_route.contact_channel_id=related_channel.id
                      WHERE related_channel.contact_id=contact.id
                        AND related_route.status='active'
                    )
                  ) END
                ))
                FROM application_routes ar
                LEFT JOIN contact_channels channel
                  ON channel.id=ar.contact_channel_id
                LEFT JOIN contacts contact ON contact.id=channel.contact_id
                WHERE ar.job_id=j.id
              ),'[]') application_routes_json,
              (
                SELECT json_object(
                  'id',atr.id,
                  'status',atr.status,
                  'mode',json_extract(atr.input_json,'$.mode'),
                  'error',atr.error_detail,
                  'updatedAt',atr.updated_at
                )
                FROM agent_task_requests atr
                WHERE atr.user_id=?
                  AND atr.task_type='application.message'
                  AND atr.subject_type='job'
                  AND atr.subject_id=j.id
                ORDER BY atr.created_at DESC LIMIT 1
              ) draft_task_json
       FROM job_listings j
       LEFT JOIN user_listing_states uj ON uj.job_id=j.id AND uj.user_id=?
       LEFT JOIN job_match_facts mf ON mf.job_id=j.id
       LEFT JOIN job_position_analyses pa_status ON pa_status.job_id=j.id
       LEFT JOIN job_content_analyses content ON content.job_id=j.id
       LEFT JOIN application_drafts d ON d.id=(
         SELECT id FROM application_drafts
         WHERE user_job_id=uj.id ORDER BY version DESC LIMIT 1
       )
       WHERE j.inventory_status='active' AND j.id=?`
    )
    .bind(
      JOB_MATCH_FACTS_SCHEMA_VERSION,
      JOB_POSITION_ANALYSIS_SCHEMA_VERSION,
      JOB_CONTENT_ANALYSIS_SCHEMA_VERSION,
      userId,
      userId,
      jobId
    )
    .first<Record<string, unknown>>();
}

function toListEvaluationJob(row: Record<string, unknown>): Job {
  const matchFacts = matchFactsFromRow(row);
  return {
    analysisStatus: analysisStatusFromRow(row),
    applicationRoutes: JSON.parse(String(row.application_routes_json)),
    applyUrl: "",
    board: String(row.board),
    company: String(row.company),
    compensation: matchFacts
      ? compensationFromEconomics(matchFacts.economics)
      : compensationFromRow(row),
    contentAnalysis: null,
    country: String(row.country),
    description: "",
    draft: null,
    draftTask: row.draft_task_json
      ? JSON.parse(String(row.draft_task_json))
      : null,
    emailAttempt: row.email_attempt_json
      ? JSON.parse(String(row.email_attempt_json))
      : null,
    id: String(row.id),
    location: String(row.location),
    marketSegments: JSON.parse(String(row.market_segments_json)),
    matchFacts,
    messageRoute: String(row.message_route) as Job["messageRoute"],
    opportunityScope: String(row.opportunity_scope) as Job["opportunityScope"],
    positionAnalysis: positionAnalysisFromRow(row),
    publicJobId: row.public_job_id ? String(row.public_job_id) : null,
    sourceReference: "",
    sourceUrl: "",
    status: String(row.status ?? "new"),
    title: String(row.title),
  };
}

function toListJob(
  evaluationJob: Job,
  row: Record<string, unknown>,
  fx: Parameters<typeof statedHourlyValueUsd>[1]
): JobListItem {
  return {
    analysisStatus: evaluationJob.analysisStatus,
    applicationRoutes: evaluationJob.applicationRoutes,
    board: evaluationJob.board,
    company: evaluationJob.company,
    compensation: evaluationJob.compensation,
    country: evaluationJob.country,
    draftTask: evaluationJob.draftTask,
    emailAttempt: evaluationJob.emailAttempt,
    housing: housingLabel(
      evaluationJob.matchFacts?.benefits ?? [],
      evaluationJob.matchFacts?.economics
    ),
    id: evaluationJob.id,
    location: evaluationJob.location,
    marketSegments: evaluationJob.marketSegments,
    messageRoute: evaluationJob.messageRoute,
    opportunityScope: evaluationJob.opportunityScope,
    positionCount: Number(row.position_count ?? 0),
    publicJobId: row.public_job_id ? String(row.public_job_id) : null,
    statedHourly: evaluationJob.matchFacts
      ? statedHourlyValueUsd(evaluationJob.matchFacts.economics, fx)
      : null,
    status: String(row.status ?? "new"),
    title: evaluationJob.title,
  };
}

function toReviewJob(row: Record<string, unknown>) {
  const matchFacts = matchFactsFromRow(row);
  return {
    analysisStatus: analysisStatusFromRow(row),
    applicationRoutes: JSON.parse(
      String(row.application_routes_json)
    ) as unknown,
    applyUrl: String(row.apply_url),
    board: String(row.board),
    company: String(row.company),
    compensation: matchFacts
      ? compensationFromEconomics(matchFacts.economics)
      : compensationFromRow(row),
    contentAnalysis: contentAnalysisFromRow(row),
    country: String(row.country),
    description: String(row.description),
    draft: row.draft_id
      ? {
          attachments: JSON.parse(
            String(row.draft_attachments_json)
          ) as unknown,
          changeSummary: String(row.change_summary),
          createdAt: String(row.draft_created_at),
          id: String(row.draft_id),
          message: String(row.message),
          previousMessage: String(row.previous_message),
          revisionSource: String(row.revision_source),
          status: String(row.draft_status),
          version: Number(row.version),
        }
      : null,
    draftTask: row.draft_task_json
      ? (JSON.parse(String(row.draft_task_json)) as unknown)
      : null,
    emailAttempt: row.email_attempt_json
      ? (JSON.parse(String(row.email_attempt_json)) as unknown)
      : null,
    id: String(row.id),
    location: String(row.location),
    marketSegments: JSON.parse(String(row.market_segments_json)) as unknown,
    matchFacts,
    messageRoute: String(row.message_route),
    opportunityScope: String(row.opportunity_scope),
    positionAnalysis: positionAnalysisFromRow(row),
    priority: Number(row.priority ?? 0),
    publicJobId: row.public_job_id ? String(row.public_job_id) : null,
    sourceReference: String(row.source_reference),
    sourceUrl: String(row.source_url),
    status: String(row.status ?? "new"),
    title: String(row.title),
  };
}

function positionAnalysisFromRow(
  row: Record<string, unknown>
): JobPositionAnalysis | null {
  if (!row.position_analysis_json) {
    return null;
  }
  const parsed = JobPositionAnalysisSchema.safeParse(
    JSON.parse(String(row.position_analysis_json)) as unknown
  );
  return parsed.success ? parsed.data : null;
}

function matchFactsFromRow(row: Record<string, unknown>): JobMatchFacts | null {
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

function contentAnalysisFromRow(
  row: Record<string, unknown>
): JobContentAnalysis | null {
  if (
    !row.content_json ||
    Number(row.content_analysis_schema_version) !==
      JOB_CONTENT_ANALYSIS_SCHEMA_VERSION
  ) {
    return null;
  }
  const parsed = JobContentAnalysisSchema.safeParse(
    JSON.parse(String(row.content_json)) as unknown
  );
  return parsed.success ? parsed.data : null;
}

function analysisStatusFromRow(
  row: Record<string, unknown>
): Job["analysisStatus"] {
  return {
    content: String(
      row.content_analysis_status
    ) as Job["analysisStatus"]["content"],
    matchFacts: String(
      row.match_facts_analysis_status
    ) as Job["analysisStatus"]["matchFacts"],
    positions: String(
      row.position_analysis_status
    ) as Job["analysisStatus"]["positions"],
  };
}

function summarizeMatch(match: JobMatch) {
  const visible = match.criteria.filter(
    (criterion) => criterion.visibility !== "internal"
  );
  const requirements = visible.filter(
    (criterion) => criterion.importance !== undefined
  );
  return {
    confirmedRequirements: requirements.filter(
      (criterion) => criterion.state === "match"
    ).length,
    conflicts: visible.filter((criterion) => criterion.state === "conflict")
      .length,
    label: match.label,
    score: match.score,
    tone: match.tone,
    totalRequirements: requirements.length,
    unknowns: visible.filter((criterion) => criterion.state === "unknown")
      .length,
  };
}
