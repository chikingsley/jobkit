import type { CountryTaskLeaseContext } from "../agent-tasks/country-sweep-leases";
import type { CompletionTaskRow, PreparedFollowUpTask } from "./model";
import { completionFenceSql, completionFenceValues } from "./transitions";

export function readCompletionTask(
  db: D1Database,
  context: CountryTaskLeaseContext
) {
  return db
    .prepare(
      `SELECT task.phase,task.scope_key,sweep.country_code,sweep.country_name
         FROM country_sweep_tasks task
         JOIN country_sweeps sweep ON sweep.id=task.sweep_id
         JOIN agent_task_runs run
           ON run.id=? AND run.source_task_id=task.id
          AND run.user_id=sweep.requested_by_user_id
          AND run.runner_id=task.worker_id
          AND run.task_type='country_sweep.'||task.phase
          AND run.attempt_number=task.attempt_count
          AND run.lease_token=task.lease_token
          AND run.source_hash=task.input_hash
          AND run.status='running'
         JOIN agent_runners runner
           ON runner.id=task.worker_id
          AND runner.user_id=sweep.requested_by_user_id
          AND runner.revoked_at IS NULL
        WHERE task.id=? AND task.sweep_id=?
          AND sweep.requested_by_user_id=? AND task.worker_id=?
          AND task.status='claimed' AND task.attempt_count=?
          AND task.lease_token=? AND task.input_hash=?
          AND task.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
          AND run.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')`
    )
    .bind(
      context.runId,
      context.taskId,
      context.sweepId,
      context.userId,
      context.runnerId,
      context.attemptNumber,
      context.leaseToken,
      context.sourceHash
    )
    .first<CompletionTaskRow>();
}

export function completionGuardStatement(
  db: D1Database,
  context: CountryTaskLeaseContext,
  completionGuard: string
) {
  return db
    .prepare(
      `UPDATE agent_task_runs AS run SET result_json=?
        WHERE run.id=? AND run.user_id=? AND run.runner_id=?
          AND run.task_type=? AND run.source_task_id=?
          AND run.attempt_number=? AND run.lease_token=?
          AND run.source_hash=? AND run.status='running'
          AND run.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
          AND EXISTS (
            SELECT 1 FROM country_sweep_tasks task
            JOIN country_sweeps sweep ON sweep.id=task.sweep_id
            JOIN agent_runners runner
              ON runner.id=task.worker_id
             AND runner.user_id=sweep.requested_by_user_id
             AND runner.revoked_at IS NULL
           WHERE task.id=run.source_task_id AND task.sweep_id=?
             AND sweep.requested_by_user_id=run.user_id
             AND task.worker_id=run.runner_id AND task.status='claimed'
             AND task.attempt_count=run.attempt_number
             AND task.lease_token=run.lease_token
             AND task.input_hash=run.source_hash
             AND task.lease_expires_at>
                 strftime('%Y-%m-%dT%H:%M:%fZ','now')
          )`
    )
    .bind(
      completionGuard,
      context.runId,
      context.userId,
      context.runnerId,
      context.taskType,
      context.taskId,
      context.attemptNumber,
      context.leaseToken,
      context.sourceHash,
      context.sweepId
    );
}

export function upsertOrganizationsStatement(
  db: D1Database,
  context: CountryTaskLeaseContext,
  organizationJson: string,
  completionGuard: string
) {
  return db
    .prepare(
      `INSERT INTO organizations
        (id,country_code,country_name,name,identity_key,city,region,website_url,
         canonical_domain,market_segment,status,outreach_eligibility,
         evidence_url,source_sweep_id,last_verified_at,created_at,updated_at)
       SELECT
         json_extract(item.value,'$.id'),sweep.country_code,sweep.country_name,
         json_extract(item.value,'$.name'),
         json_extract(item.value,'$.identityKey'),
         json_extract(item.value,'$.city'),json_extract(item.value,'$.region'),
         json_extract(item.value,'$.websiteUrl'),
         json_extract(item.value,'$.canonicalDomain'),
         json_extract(item.value,'$.marketSegment'),
         json_extract(item.value,'$.status'),
         json_extract(item.value,'$.outreachEligibility'),
         json_extract(item.value,'$.evidenceUrl'),?,
         json_extract(item.value,'$.lastVerifiedAt'),
         strftime('%Y-%m-%dT%H:%M:%fZ','now'),
         strftime('%Y-%m-%dT%H:%M:%fZ','now')
       FROM json_each(?) item
       JOIN country_sweeps sweep ON sweep.id=?
       WHERE ${completionFenceSql("sweep.requested_by_user_id")}
       ON CONFLICT(country_code,identity_key) DO UPDATE SET
         name=excluded.name,
         city=CASE WHEN excluded.city<>'' THEN excluded.city ELSE organizations.city END,
         region=CASE WHEN excluded.region<>'' THEN excluded.region ELSE organizations.region END,
         website_url=CASE WHEN excluded.website_url<>'' THEN excluded.website_url ELSE organizations.website_url END,
         canonical_domain=CASE WHEN excluded.canonical_domain<>'' THEN excluded.canonical_domain ELSE organizations.canonical_domain END,
         market_segment=excluded.market_segment,status=excluded.status,
         outreach_eligibility=excluded.outreach_eligibility,
         evidence_url=CASE WHEN excluded.evidence_url<>'' THEN excluded.evidence_url ELSE organizations.evidence_url END,
         source_sweep_id=excluded.source_sweep_id,
         last_verified_at=COALESCE(excluded.last_verified_at,organizations.last_verified_at),
         updated_at=excluded.updated_at`
    )
    .bind(
      context.sweepId,
      organizationJson,
      context.sweepId,
      ...completionFenceValues(context, completionGuard)
    );
}

export function upsertOrganizationEvidenceStatement(
  db: D1Database,
  context: CountryTaskLeaseContext,
  task: CompletionTaskRow,
  organizationJson: string,
  completionGuard: string
) {
  return db
    .prepare(
      `INSERT INTO organization_evidence
        (id,organization_id,source_sweep_id,source_kind,evidence_kind,
         evidence_status,roles,source_label,source_url,posting_context,notes,
         observed_at,provenance_path,metadata_json,created_at)
       SELECT json_extract(item.value,'$.evidenceId'),organization.id,?,
              'country_sweep','organization_profile',
              CASE json_extract(item.value,'$.status')
                WHEN 'active' THEN 'active'
                WHEN 'stale' THEN 'stale'
                WHEN 'closed' THEN 'stale'
                ELSE 'unclear' END,
              '','country_sweep.'||?,
              CASE WHEN json_extract(item.value,'$.evidenceUrl')<>''
                THEN json_extract(item.value,'$.evidenceUrl')
                ELSE json_extract(item.value,'$.websiteUrl') END,
              ?, '',COALESCE(json_extract(item.value,'$.lastVerifiedAt'),
                strftime('%Y-%m-%dT%H:%M:%fZ','now')),
              'country_sweep:'||?||'/'||?,
              json_object('phase',?,'scopeKey',?),
              strftime('%Y-%m-%dT%H:%M:%fZ','now')
       FROM json_each(?) item
       JOIN organizations organization
         ON organization.country_code=?
        AND organization.identity_key=json_extract(item.value,'$.identityKey')
       JOIN country_sweeps sweep ON sweep.id=?
       WHERE ${completionFenceSql("sweep.requested_by_user_id")}
       ON CONFLICT(organization_id,source_kind,source_url,roles) DO UPDATE SET
         source_sweep_id=excluded.source_sweep_id,
         evidence_status=excluded.evidence_status,
         source_label=excluded.source_label,
         posting_context=excluded.posting_context,
         observed_at=excluded.observed_at,
         provenance_path=excluded.provenance_path,
         metadata_json=excluded.metadata_json`
    )
    .bind(
      context.sweepId,
      task.phase,
      task.scope_key,
      context.sweepId,
      context.taskId,
      task.phase,
      task.scope_key,
      organizationJson,
      task.country_code,
      context.sweepId,
      ...completionFenceValues(context, completionGuard)
    );
}

export function upsertOrganizationContactsStatement(
  db: D1Database,
  context: CountryTaskLeaseContext,
  organizationJson: string,
  completionGuard: string
) {
  return db
    .prepare(
      `INSERT INTO organization_contact_points
        (id,organization_id,kind,label,value,status,evidence_url,
         last_verified_at,created_at,updated_at)
       SELECT json_extract(contact.value,'$.id'),organization.id,
              json_extract(contact.value,'$.kind'),
              json_extract(contact.value,'$.label'),
              json_extract(contact.value,'$.value'),
              json_extract(contact.value,'$.status'),
              json_extract(contact.value,'$.evidenceUrl'),
              json_extract(item.value,'$.lastVerifiedAt'),
              strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              strftime('%Y-%m-%dT%H:%M:%fZ','now')
       FROM json_each(?) item
       JOIN json_each(item.value,'$.contactPoints') contact
       JOIN organizations organization
         ON organization.country_code=(
           SELECT country_code FROM country_sweeps WHERE id=?
         )
        AND organization.identity_key=json_extract(item.value,'$.identityKey')
       JOIN country_sweeps sweep ON sweep.id=?
       WHERE ${completionFenceSql("sweep.requested_by_user_id")}
       ON CONFLICT(organization_id,kind,value) DO UPDATE SET
         label=excluded.label,status=excluded.status,
         evidence_url=CASE WHEN excluded.evidence_url<>''
           THEN excluded.evidence_url ELSE organization_contact_points.evidence_url END,
         last_verified_at=COALESCE(excluded.last_verified_at,
           organization_contact_points.last_verified_at),
         updated_at=excluded.updated_at`
    )
    .bind(
      organizationJson,
      context.sweepId,
      context.sweepId,
      ...completionFenceValues(context, completionGuard)
    );
}

export function materializeCampaignTargetsStatement(
  db: D1Database,
  context: CountryTaskLeaseContext,
  organizationJson: string,
  completionGuard: string
) {
  return db
    .prepare(
      `INSERT OR IGNORE INTO campaign_targets
        (id,campaign_id,country_code,source_kind,subject_kind,subject_id,
         organization_id,contact_point_id,channel,route_strategy,dedup_key,
         status,hold_reason,admitted_at,updated_at)
       SELECT lower(hex(randomblob(16))),campaign.id,sweep.country_code,
              'school','organization',organization.id,organization.id,
              contact.id,'email','single','email:'||lower(trim(contact.value)),
              CASE WHEN EXISTS (
                SELECT 1 FROM json_each(
                  campaign.policy_snapshot_json,'$.excludedMarketSegments'
                ) excluded
                WHERE excluded.value=organization.market_segment
              ) THEN 'held' ELSE 'eligible' END,
              CASE WHEN EXISTS (
                SELECT 1 FROM json_each(
                  campaign.policy_snapshot_json,'$.excludedMarketSegments'
                ) excluded
                WHERE excluded.value=organization.market_segment
              ) THEN 'Excluded market segment in the saved campaign policy'
                ELSE '' END,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              strftime('%Y-%m-%dT%H:%M:%fZ','now')
       FROM json_each(?) item
       JOIN country_sweeps sweep ON sweep.id=?
       JOIN organizations organization
         ON organization.country_code=sweep.country_code
        AND organization.identity_key=json_extract(item.value,'$.identityKey')
       JOIN organization_contact_points contact ON contact.id=(
         SELECT candidate.id FROM organization_contact_points candidate
          WHERE candidate.organization_id=organization.id
            AND candidate.kind='email' AND candidate.status='active'
          ORDER BY candidate.last_verified_at DESC,candidate.updated_at DESC
          LIMIT 1
       )
       JOIN campaign_markets market ON market.country_code=sweep.country_code
       JOIN campaigns campaign ON campaign.id=market.campaign_id
        AND campaign.status IN ('draft','calibrating','ready','running','paused')
       WHERE organization.status='active'
         AND organization.outreach_eligibility='eligible'
         AND ${completionFenceSql("sweep.requested_by_user_id")}`
    )
    .bind(
      organizationJson,
      context.sweepId,
      ...completionFenceValues(context, completionGuard)
    );
}

export function insertFollowUpTasksStatement(
  db: D1Database,
  context: CountryTaskLeaseContext,
  phase: "discovery" | "verification",
  tasks: PreparedFollowUpTask[],
  completionGuard: string
) {
  return db
    .prepare(
      `INSERT INTO country_sweep_tasks
        (id,sweep_id,phase,scope_key,status,input_json,input_hash,
         created_at,updated_at)
       SELECT json_extract(item.value,'$.id'),?, ?,
              json_extract(item.value,'$.scopeKey'),'queued',
              json_extract(item.value,'$.inputJson'),
              json_extract(item.value,'$.inputHash'),
              strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              strftime('%Y-%m-%dT%H:%M:%fZ','now')
       FROM json_each(?) item
       JOIN country_sweeps sweep ON sweep.id=?
       WHERE ${completionFenceSql("sweep.requested_by_user_id")}
       ON CONFLICT(sweep_id,phase,scope_key) DO NOTHING`
    )
    .bind(
      context.sweepId,
      phase,
      JSON.stringify(tasks),
      context.sweepId,
      ...completionFenceValues(context, completionGuard)
    );
}
