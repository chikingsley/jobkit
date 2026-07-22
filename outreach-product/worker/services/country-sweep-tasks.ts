import type { CountrySweepTaskOutput } from "../../src/features/countries/schema";
import { AgentTaskError } from "./agent-tasks/contracts";
import type { CountryTaskLeaseContext } from "./agent-tasks/country-sweep-leases";
import { isConstraintError, sha256 } from "./agent-tasks/run-store";

const MAX_LEGACY_OUTPUT_BYTES = 1_000_000;
const MAX_LEGACY_OUTPUT_RECORDS = 1000;
const WWW_PREFIX_PATTERN = /^www\./u;

interface CompletionTaskRow {
  country_code: string;
  country_name: string;
  phase: "coverage_audit" | "discovery" | "verification";
  scope_key: string;
}

interface NormalizedContact {
  evidenceUrl: string;
  id: string;
  kind: string;
  label: string;
  status: string;
  value: string;
}

interface NormalizedOrganization {
  canonicalDomain: string;
  city: string;
  contactPoints: NormalizedContact[];
  evidenceId: string;
  evidenceUrl: string;
  id: string;
  identityKey: string;
  lastVerifiedAt: string | null;
  marketSegment: string;
  name: string;
  outreachEligibility: string;
  region: string;
  status: string;
  websiteUrl: string;
}

interface PreparedFollowUpTask {
  id: string;
  inputHash: string;
  inputJson: string;
  scopeKey: string;
}

export async function completeCountrySweepTask(
  db: D1Database,
  context: CountryTaskLeaseContext,
  output: CountrySweepTaskOutput
) {
  const task = await readCompletionTask(db, context);
  if (!task) {
    throw new AgentTaskError(
      "Country task lease changed before completion",
      409
    );
  }
  const outputJson = JSON.stringify(output);
  if (
    new TextEncoder().encode(outputJson).byteLength > MAX_LEGACY_OUTPUT_BYTES
  ) {
    throw new AgentTaskError(
      "Country task output requires chunked materialization",
      409
    );
  }
  const organizations = normalizeOrganizations(output.organizations);
  const contactCount = organizations.reduce(
    (count, organization) => count + organization.contactPoints.length,
    0
  );
  if (
    organizations.length > MAX_LEGACY_OUTPUT_RECORDS ||
    contactCount > MAX_LEGACY_OUTPUT_RECORDS
  ) {
    throw new AgentTaskError(
      "Country task output requires chunked materialization",
      409
    );
  }
  const organizationJson = JSON.stringify(organizations);
  const verificationTasks = await prepareVerificationTasks(task, organizations);
  const discoveryTasks =
    task.phase === "coverage_audit"
      ? await prepareDiscoveryTasks(task, output.coverageSummary.nextScopes)
      : [];
  const auditTask = await prepareAuditTask(task, context);
  const completionGuard = JSON.stringify({
    completionGuard: crypto.randomUUID(),
  });
  const statements: D1PreparedStatement[] = [
    completionGuardStatement(db, context, completionGuard),
    requiredChangesAssertionStatement(db, 1),
  ];
  if (organizations.length > 0) {
    statements.push(
      upsertOrganizationsStatement(
        db,
        context,
        organizationJson,
        completionGuard
      ),
      requiredChangesAssertionStatement(db, organizations.length),
      upsertOrganizationEvidenceStatement(
        db,
        context,
        task,
        organizationJson,
        completionGuard
      ),
      requiredChangesAssertionStatement(db, organizations.length)
    );
  }
  if (contactCount > 0) {
    statements.push(
      upsertOrganizationContactsStatement(
        db,
        context,
        organizationJson,
        completionGuard
      ),
      requiredChangesAssertionStatement(db, contactCount)
    );
  }
  if (organizations.length > 0) {
    statements.push(
      materializeCampaignTargetsStatement(
        db,
        context,
        organizationJson,
        completionGuard
      )
    );
  }
  if (verificationTasks.length > 0) {
    statements.push(
      insertFollowUpTasksStatement(
        db,
        context,
        "verification",
        verificationTasks,
        completionGuard
      )
    );
  }
  if (discoveryTasks.length > 0) {
    statements.push(
      insertFollowUpTasksStatement(
        db,
        context,
        "discovery",
        discoveryTasks,
        completionGuard
      )
    );
  }
  statements.push(
    completeCountryTaskStatement(db, context, outputJson, completionGuard),
    requiredChangesAssertionStatement(db, 1)
  );
  if (task.phase !== "coverage_audit") {
    statements.push(
      insertCoverageAuditStatement(db, context, auditTask, completionGuard)
    );
  }
  statements.push(
    advanceCountrySweepStatement(db, context, task, output, completionGuard),
    requiredChangesAssertionStatement(db, 1),
    completeCountryRunStatement(db, context, outputJson, completionGuard),
    requiredChangesAssertionStatement(db, 1)
  );
  try {
    await db.batch(statements);
  } catch (error) {
    if (isConstraintError(error)) {
      const completionError = new AgentTaskError(
        "Country task state changed before completion",
        409
      );
      completionError.cause = error;
      throw completionError;
    }
    throw error;
  }
  return {
    organizationCount: organizations.length,
    phase: task.phase,
    sweepId: context.sweepId,
    taskId: context.taskId,
  };
}

function readCompletionTask(db: D1Database, context: CountryTaskLeaseContext) {
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

function completionGuardStatement(
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

function upsertOrganizationsStatement(
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

function upsertOrganizationEvidenceStatement(
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

function upsertOrganizationContactsStatement(
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

function materializeCampaignTargetsStatement(
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

function insertFollowUpTasksStatement(
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

function completeCountryTaskStatement(
  db: D1Database,
  context: CountryTaskLeaseContext,
  outputJson: string,
  completionGuard: string
) {
  return db
    .prepare(
      `UPDATE country_sweep_tasks
          SET status='completed',output_json=?,worker_id=NULL,lease_token=NULL,
              lease_expires_at=NULL,error_code='',error_detail='',
              completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND sweep_id=? AND worker_id=? AND status='claimed'
          AND attempt_count=? AND lease_token=? AND input_hash=?
          AND ${completionFenceSql("(SELECT requested_by_user_id FROM country_sweeps WHERE id=country_sweep_tasks.sweep_id)")}`
    )
    .bind(
      outputJson,
      context.taskId,
      context.sweepId,
      context.runnerId,
      context.attemptNumber,
      context.leaseToken,
      context.sourceHash,
      ...completionFenceValues(context, completionGuard)
    );
}

function insertCoverageAuditStatement(
  db: D1Database,
  context: CountryTaskLeaseContext,
  task: PreparedFollowUpTask,
  completionGuard: string
) {
  return db
    .prepare(
      `INSERT INTO country_sweep_tasks
        (id,sweep_id,phase,scope_key,status,input_json,input_hash,
         created_at,updated_at)
       SELECT ?,?,'coverage_audit',?,'queued',?,?,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              strftime('%Y-%m-%dT%H:%M:%fZ','now')
       FROM country_sweeps sweep WHERE sweep.id=?
         AND NOT EXISTS (
           SELECT 1 FROM country_sweep_tasks active_task
            WHERE active_task.sweep_id=sweep.id
              AND active_task.phase IN ('discovery','verification')
              AND active_task.status IN ('queued','claimed','materializing')
         )
         AND NOT EXISTS (
           SELECT 1 FROM country_sweep_tasks active_audit
            WHERE active_audit.sweep_id=sweep.id
              AND active_audit.phase='coverage_audit'
              AND active_audit.status IN ('queued','claimed','materializing')
         )
         AND ${completionFenceSql("sweep.requested_by_user_id")}
       ON CONFLICT(sweep_id,phase,scope_key) DO NOTHING`
    )
    .bind(
      task.id,
      context.sweepId,
      task.scopeKey,
      task.inputJson,
      task.inputHash,
      context.sweepId,
      ...completionFenceValues(context, completionGuard)
    );
}

function advanceCountrySweepStatement(
  db: D1Database,
  context: CountryTaskLeaseContext,
  task: CompletionTaskRow,
  output: CountrySweepTaskOutput,
  completionGuard: string
) {
  const isCoverageAudit = task.phase === "coverage_audit";
  const coverageSummaryJson = JSON.stringify(output.coverageSummary);
  return db
    .prepare(
      `UPDATE country_sweeps
          SET status=CASE
                WHEN ?=1 AND NOT EXISTS (
                  SELECT 1 FROM country_sweep_tasks active_task
                   WHERE active_task.sweep_id=country_sweeps.id
                     AND active_task.status IN ('queued','claimed','materializing')
                ) THEN CASE WHEN EXISTS (
                  SELECT 1 FROM country_sweep_tasks failed_task
                   WHERE failed_task.sweep_id=country_sweeps.id
                     AND failed_task.status='failed'
                     AND failed_task.phase IN ('discovery','verification')
                ) THEN 'completed_with_gaps' ELSE 'completed' END
                ELSE 'running' END,
              coverage_summary_json=CASE WHEN ?=1 THEN ?
                ELSE coverage_summary_json END,
              task_total=(
                SELECT COUNT(*) FROM country_sweep_tasks counted
                 WHERE counted.sweep_id=country_sweeps.id
              ),
              task_completed=(
                SELECT COUNT(*) FROM country_sweep_tasks counted
                 WHERE counted.sweep_id=country_sweeps.id
                   AND counted.status='completed'
              ),
              task_failed=(
                SELECT COUNT(*) FROM country_sweep_tasks counted
                 WHERE counted.sweep_id=country_sweeps.id
                   AND counted.status='failed'
              ),
              missing_scope_count=(
                SELECT COUNT(*) FROM country_sweep_tasks counted
                 WHERE counted.sweep_id=country_sweeps.id
                   AND counted.status='failed'
                   AND counted.phase IN ('discovery','verification')
              ),
              completed_at=CASE WHEN ?=1 AND NOT EXISTS (
                SELECT 1 FROM country_sweep_tasks active_task
                 WHERE active_task.sweep_id=country_sweeps.id
                   AND active_task.status IN ('queued','claimed','materializing')
              ) THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END,
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND requested_by_user_id=? AND status='running'
          AND ${completionFenceSql("country_sweeps.requested_by_user_id")}`
    )
    .bind(
      isCoverageAudit ? 1 : 0,
      isCoverageAudit ? 1 : 0,
      coverageSummaryJson,
      isCoverageAudit ? 1 : 0,
      context.sweepId,
      context.userId,
      ...completionFenceValues(context, completionGuard)
    );
}

function completeCountryRunStatement(
  db: D1Database,
  context: CountryTaskLeaseContext,
  outputJson: string,
  completionGuard: string
) {
  return db
    .prepare(
      `UPDATE agent_task_runs
          SET status='completed',result_json=?,error_code='',error_detail='',
              completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND user_id=? AND runner_id=? AND task_type=?
          AND source_task_id=? AND attempt_number=? AND lease_token=?
          AND source_hash=? AND status='running' AND result_json=?
          AND EXISTS (
            SELECT 1 FROM country_sweep_tasks completed_task
             WHERE completed_task.id=agent_task_runs.source_task_id
               AND completed_task.sweep_id=?
               AND completed_task.status='completed'
               AND completed_task.attempt_count=agent_task_runs.attempt_number
          )`
    )
    .bind(
      outputJson,
      context.runId,
      context.userId,
      context.runnerId,
      context.taskType,
      context.taskId,
      context.attemptNumber,
      context.leaseToken,
      context.sourceHash,
      completionGuard,
      context.sweepId
    );
}

function completionFenceSql(userExpression: string) {
  return `EXISTS (
    SELECT 1 FROM agent_task_runs completion_run
     WHERE completion_run.id=? AND completion_run.user_id=${userExpression}
       AND completion_run.runner_id=? AND completion_run.task_type=?
       AND completion_run.source_task_id=?
       AND completion_run.attempt_number=? AND completion_run.lease_token=?
       AND completion_run.source_hash=? AND completion_run.status='running'
       AND completion_run.result_json=?
  )`;
}

function completionFenceValues(
  context: CountryTaskLeaseContext,
  completionGuard: string
) {
  return [
    context.runId,
    context.runnerId,
    context.taskType,
    context.taskId,
    context.attemptNumber,
    context.leaseToken,
    context.sourceHash,
    completionGuard,
  ] as const;
}

function normalizeOrganizations(
  organizations: CountrySweepTaskOutput["organizations"]
) {
  const unique = new Map<string, NormalizedOrganization>();
  for (const organization of organizations) {
    const canonicalDomain = normalizeDomain(
      organization.canonicalDomain || organization.websiteUrl
    );
    const identityKey = canonicalDomain
      ? `domain:${canonicalDomain}`
      : `name:${normalizeIdentity(organization.name)}|city:${normalizeIdentity(
          organization.city
        )}`;
    const contacts = new Map<string, NormalizedContact>();
    for (const contact of organization.contactPoints) {
      const value =
        contact.kind === "email"
          ? contact.value.trim().toLowerCase()
          : contact.value.trim();
      contacts.set(`${contact.kind}:${value}`, {
        evidenceUrl: contact.evidenceUrl.trim(),
        id: crypto.randomUUID(),
        kind: contact.kind,
        label: contact.label.trim(),
        status: contact.status,
        value,
      });
    }
    unique.set(identityKey, {
      canonicalDomain,
      city: organization.city.trim(),
      contactPoints: [...contacts.values()],
      evidenceId: crypto.randomUUID(),
      evidenceUrl: organization.evidenceUrl.trim(),
      id: crypto.randomUUID(),
      identityKey,
      lastVerifiedAt: organization.lastVerifiedAt,
      marketSegment: organization.marketSegment,
      name: organization.name.trim(),
      outreachEligibility: organization.outreachEligibility,
      region: organization.region.trim(),
      status: organization.status,
      websiteUrl: organization.websiteUrl.trim(),
    });
  }
  return [...unique.values()];
}

function prepareVerificationTasks(
  task: CompletionTaskRow,
  organizations: NormalizedOrganization[]
) {
  return Promise.all(
    organizations.map(async (organization) => {
      const inputJson = JSON.stringify({
        countryCode: task.country_code,
        countryName: task.country_name,
        organization: {
          canonicalDomain: organization.canonicalDomain,
          city: organization.city,
          evidenceUrl: organization.evidenceUrl,
          identityKey: organization.identityKey,
          marketSegment: organization.marketSegment,
          name: organization.name,
          outreachEligibility: organization.outreachEligibility,
          region: organization.region,
          status: organization.status,
          websiteUrl: organization.websiteUrl,
        },
        phase: "verification",
      });
      return {
        id: crypto.randomUUID(),
        inputHash: await sha256(inputJson),
        inputJson,
        scopeKey: organization.identityKey,
      };
    })
  );
}

function prepareDiscoveryTasks(
  task: CompletionTaskRow,
  scopes: CountrySweepTaskOutput["coverageSummary"]["nextScopes"]
) {
  const uniqueScopes = new Map(
    scopes.map((scope) => [discoveryScopeKey(scope), scope])
  );
  return Promise.all(
    [...uniqueScopes].map(async ([scopeKey, scope]) => {
      const inputJson = JSON.stringify({
        city: scope.city,
        countryCode: task.country_code,
        countryName: task.country_name,
        phase: "discovery",
        query: scope.query,
        source: scope.source,
      });
      return {
        id: crypto.randomUUID(),
        inputHash: await sha256(inputJson),
        inputJson,
        scopeKey,
      };
    })
  );
}

async function prepareAuditTask(
  task: CompletionTaskRow,
  context: CountryTaskLeaseContext
) {
  const inputJson = JSON.stringify({
    countryCode: task.country_code,
    countryName: task.country_name,
    phase: "coverage_audit",
    progress: { completedTaskId: context.taskId },
  });
  return {
    id: crypto.randomUUID(),
    inputHash: await sha256(inputJson),
    inputJson,
    scopeKey: `coverage:after:${context.taskId}`,
  };
}

function discoveryScopeKey(
  scope: CountrySweepTaskOutput["coverageSummary"]["nextScopes"][number]
) {
  return [
    scope.source,
    normalizeIdentity(scope.city),
    normalizeIdentity(scope.query),
  ]
    .filter(Boolean)
    .join(":");
}

function normalizeDomain(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }
  try {
    const url = new URL(
      trimmed.includes("://") ? trimmed : `https://${trimmed}`
    );
    return url.hostname.replace(WWW_PREFIX_PATTERN, "");
  } catch {
    return "";
  }
}

function normalizeIdentity(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replaceAll(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replaceAll(/^-|-$/gu, "");
}

function requiredChangesAssertionStatement(
  db: D1Database,
  expectedChanges: number
) {
  return db
    .prepare(
      `INSERT INTO transaction_assertions(must_equal_one)
       SELECT 0 WHERE changes()<>?`
    )
    .bind(expectedChanges);
}
