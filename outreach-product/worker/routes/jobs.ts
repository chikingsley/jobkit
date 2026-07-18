import { compensationFromEconomics } from "../../src/features/jobs/economics";
import {
  type JobPositionAnalysis,
  JobPositionAnalysisSchema,
} from "../../src/features/jobs/position-variants";
import {
  type JobMatchFacts,
  JobMatchFactsSchema,
} from "../../src/features/matching/schema";
import { JOB_MATCH_FACTS_SCHEMA_VERSION } from "../../src/features/matching/version";
import type { JobKitApp } from "../app-types";
import {
  readAutomationPolicy,
  writeAutomationPolicy,
} from "../repositories/automation-policy";
import { compensationFromRow } from "../repositories/jobs";
import { generateJobDraft } from "../services/application-drafts";
import { analyzeUserJobs } from "../services/job-analysis";

export function registerJobRoutes(app: JobKitApp) {
  app.post("/api/jobs/:id/generate", async (c) => {
    const draft = await generateJobDraft(
      c.env,
      c.get("user").id,
      c.req.param("id")
    );
    return c.json({
      message: `Draft generated with ${draft.provider}/${draft.modelId}`,
      ok: true,
      summary: draft.summary,
    });
  });

  app.get("/api/jobs", async (c) => {
    const rows = await c.env.DB.prepare(
      `SELECT j.*,uj.status,uj.priority,
                mf.facts_json,mf.schema_version match_facts_schema_version,
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
                  WHERE pa.job_id=j.id AND pa.schema_version=2
                ) position_analysis_json,
                d.id draft_id,d.version,d.message,d.change_summary,d.status draft_status,
                d.created_at draft_created_at,d.revision_source,
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
                    'contact',CASE WHEN c.id IS NULL THEN NULL ELSE json_object(
                      'id',c.id,
                      'displayName',c.display_name,
                      'organizationName',c.organization_name,
                      'role',c.role,
                      'relatedListingCount',(
                        SELECT COUNT(DISTINCT related_route.job_id)
                        FROM contact_channels related_channel
                        JOIN application_routes related_route
                          ON related_route.contact_channel_id=related_channel.id
                        WHERE related_channel.contact_id=c.id
                          AND related_route.status='active'
                      )
                    ) END
                  ))
                  FROM application_routes ar
                  LEFT JOIN contact_channels cc ON cc.id=ar.contact_channel_id
                  LEFT JOIN contacts c ON c.id=cc.contact_id
                  WHERE ar.job_id=j.id
                ),'[]') application_routes_json
         FROM user_jobs uj
         JOIN jobs j ON j.id=uj.job_id
         LEFT JOIN job_match_facts mf ON mf.job_id=j.id
         LEFT JOIN application_drafts d ON d.id=(
           SELECT id FROM application_drafts
           WHERE user_job_id=uj.id ORDER BY version DESC LIMIT 1
         )
         WHERE uj.user_id=?
         ORDER BY uj.priority DESC,
           CASE uj.status
             WHEN 'new' THEN 0 WHEN 'review' THEN 1 WHEN 'approved' THEN 2
             WHEN 'applied' THEN 4 ELSE 3
           END,
           uj.updated_at DESC`
    )
      .bind(c.get("user").id)
      .all();
    return c.json({ jobs: rows.results.map(toReviewJob) });
  });

  app.post("/api/jobs/analyze", async (c) => {
    const analyzed = await analyzeUserJobs(c.env, c.get("user").id);
    return c.json({
      message:
        analyzed === 0
          ? "All job analyses were current"
          : `Analyzed ${analyzed} ${analyzed === 1 ? "job" : "jobs"}`,
      ok: true,
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

function toReviewJob(row: Record<string, unknown>) {
  const matchFacts = matchFactsFromRow(row);
  return {
    applicationRoutes: JSON.parse(
      String(row.application_routes_json)
    ) as unknown,
    applyUrl: String(row.apply_url),
    board: String(row.board),
    company: String(row.company),
    compensation: matchFacts
      ? compensationFromEconomics(matchFacts.economics)
      : compensationFromRow(row),
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
    priority: Number(row.priority),
    sourceReference: String(row.source_reference),
    sourceUrl: String(row.source_url),
    status: String(row.status),
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
