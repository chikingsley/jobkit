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
import { JOB_MATCH_FACTS_SCHEMA_VERSION } from "../../src/features/matching/version";
import type { JobMatch } from "../../src/profile-types";
import { compensationFromRow } from "../repositories/jobs";

export function readReviewJob(db: D1Database, userId: string, jobId: string) {
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
              COALESCE((
                SELECT json_group_array(json(location_value))
                FROM (
                  SELECT json_object(
                    'bounds',CASE WHEN resolution.bounds_json IS NULL
                      THEN NULL ELSE json(resolution.bounds_json) END,
                    'coordinateKind',resolution.coordinate_kind,
                    'countryCode',resolution.country_code,
                    'displayName',resolution.display_name,
                    'latitude',resolution.latitude,
                    'longitude',resolution.longitude,
                    'provider','mapbox',
                    'providerPlaceId',resolution.selected_provider_place_id
                  ) location_value
                  FROM public_projection_location_resolutions resolution
                  JOIN public_projection_position_items position
                    ON position.id=resolution.position_item_id
                   AND position.run_id=resolution.run_id
                  JOIN public_projection_listing_items listing
                    ON listing.id=position.listing_item_id
                   AND listing.run_id=position.run_id
                  WHERE listing.listing_id=j.id
                    AND resolution.state='resolved'
                    AND resolution.provider='mapbox-geocoding-v6'
                    AND resolution.run_id=(
                      SELECT latest.run_id
                      FROM public_projection_location_resolutions latest
                      JOIN public_projection_position_items latest_position
                        ON latest_position.id=latest.position_item_id
                       AND latest_position.run_id=latest.run_id
                      JOIN public_projection_listing_items latest_listing
                        ON latest_listing.id=latest_position.listing_item_id
                       AND latest_listing.run_id=latest_position.run_id
                      JOIN public_projection_runs latest_run
                        ON latest_run.id=latest.run_id
                      WHERE latest_listing.listing_id=j.id
                        AND latest.state='resolved'
                      ORDER BY latest_run.requested_at DESC,latest.run_id DESC
                      LIMIT 1
                    )
                  ORDER BY position.id,resolution.ordinal
                )
              ),'[]') resolved_locations_json,
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

export function toListEvaluationJob(row: Record<string, unknown>): Job {
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
    resolvedLocations: [],
    sourceReference: "",
    sourceUrl: "",
    status: String(row.status ?? "new"),
    title: String(row.title),
  };
}

export function toListJob(
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

export function toReviewJob(row: Record<string, unknown>) {
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
    resolvedLocations: JSON.parse(
      String(row.resolved_locations_json)
    ) as unknown,
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

export function summarizeMatch(match: JobMatch) {
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
