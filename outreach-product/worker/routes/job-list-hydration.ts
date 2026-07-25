import { JOB_CONTENT_ANALYSIS_SCHEMA_VERSION } from "../../src/features/jobs/content-analysis";
import { JOB_POSITION_ANALYSIS_SCHEMA_VERSION } from "../../src/features/jobs/position-variants";
import { JOB_MATCH_FACTS_SCHEMA_VERSION } from "../../src/pipeline/03_match/version";

export async function readJobListRows(
  db: D1Database,
  userId: string,
  ids: string[]
): Promise<Record<string, unknown>[]> {
  if (ids.length === 0) {
    return [];
  }
  const rows = await db
    .prepare(
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
           AND j.id IN (SELECT value FROM json_each(?))`
    )
    .bind(
      JOB_MATCH_FACTS_SCHEMA_VERSION,
      JOB_POSITION_ANALYSIS_SCHEMA_VERSION,
      JOB_CONTENT_ANALYSIS_SCHEMA_VERSION,
      userId,
      userId,
      JSON.stringify(ids)
    )
    .all();
  const byId = new Map(
    rows.results.map((row) => [String(row.id), row] as const)
  );
  const ordered: Record<string, unknown>[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (row) {
      ordered.push(row);
    }
  }
  return ordered;
}
