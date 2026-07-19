import type { CountrySweepTaskOutput } from "../../src/features/countries/schema";
import { CountryMarketError } from "./country-markets";

const WWW_PREFIX_PATTERN = /^www\./u;
// This limits transient execution retries for one durable task. It does not cap
// discovery breadth, organizations, cities, or campaign targets.
const COUNTRY_SWEEP_TASK_MAX_ATTEMPTS = 3;

interface ClaimedTaskRow {
  country_code: string;
  country_name: string;
  id: string;
  input_json: string;
  phase: "coverage_audit" | "discovery" | "verification";
  scope_key: string;
  sweep_id: string;
}

interface OwnedTaskRow extends ClaimedTaskRow {
  attempt_count: number;
  status: string;
  worker_id: string | null;
}

interface OrganizationRow {
  canonical_domain: string;
  city: string;
  evidence_url: string;
  id: string;
  market_segment: string;
  name: string;
  outreach_eligibility: string;
  region: string;
  status: string;
  website_url: string;
}

export async function claimCountrySweepTask(
  db: D1Database,
  userId: string,
  workerId: string
) {
  const timestamp = new Date().toISOString();
  const leaseExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const task = await db
    .prepare(
      `UPDATE country_sweep_tasks
          SET status='claimed',worker_id=?,claimed_at=?,lease_expires_at=?,
              attempt_count=attempt_count+1,updated_at=?
        WHERE id=(
          SELECT t.id
            FROM country_sweep_tasks t
            JOIN country_sweeps s ON s.id=t.sweep_id
           WHERE s.requested_by_user_id=?
             AND (
               t.status='queued' OR
               (t.status='claimed' AND t.lease_expires_at<?)
             )
           ORDER BY CASE t.phase
             WHEN 'discovery' THEN 0 WHEN 'verification' THEN 1 ELSE 2 END,
             t.created_at
           LIMIT 1
        )
          AND (status='queued' OR (status='claimed' AND lease_expires_at<?))
      RETURNING id,sweep_id,phase,scope_key,input_json`
    )
    .bind(
      workerId,
      timestamp,
      leaseExpiresAt,
      timestamp,
      userId,
      timestamp,
      timestamp
    )
    .first<Omit<ClaimedTaskRow, "country_code" | "country_name">>();
  if (!task) {
    return null;
  }
  const sweep = await db
    .prepare(
      `UPDATE country_sweeps
          SET status='running',started_at=COALESCE(started_at,?),updated_at=?
        WHERE id=? AND requested_by_user_id=?
      RETURNING country_code,country_name`
    )
    .bind(timestamp, timestamp, task.sweep_id, userId)
    .first<{ country_code: string; country_name: string }>();
  if (!sweep) {
    throw new Error("Claimed sweep task lost its parent sweep");
  }
  return {
    countryCode: sweep.country_code,
    countryName: sweep.country_name,
    id: task.id,
    input: JSON.parse(task.input_json) as unknown,
    leaseExpiresAt,
    phase: task.phase,
    scopeKey: task.scope_key,
    sweepId: task.sweep_id,
  };
}

export async function completeCountrySweepTask(
  db: D1Database,
  userId: string,
  taskId: string,
  workerId: string,
  output: CountrySweepTaskOutput
) {
  const task = await db
    .prepare(
      `SELECT t.id,t.sweep_id,t.phase,t.scope_key,t.input_json,t.status,
              t.worker_id,t.attempt_count,s.country_code,s.country_name
         FROM country_sweep_tasks t
         JOIN country_sweeps s ON s.id=t.sweep_id
        WHERE t.id=? AND s.requested_by_user_id=?`
    )
    .bind(taskId, userId)
    .first<OwnedTaskRow>();
  if (!task) {
    throw new CountryMarketError("Sweep task was not found", 404);
  }
  if (task.status !== "claimed" || task.worker_id !== workerId) {
    throw new CountryMarketError(
      "Sweep task is not claimed by this runner",
      409
    );
  }

  const organizationIds = await upsertOrganizations(db, task, output);
  const timestamp = new Date().toISOString();
  const completed = await db
    .prepare(
      `UPDATE country_sweep_tasks
          SET status='completed',output_json=?,completed_at=?,updated_at=?
        WHERE id=? AND status='claimed' AND worker_id=?`
    )
    .bind(JSON.stringify(output), timestamp, timestamp, taskId, workerId)
    .run();
  if ((completed.meta.changes ?? 0) !== 1) {
    throw new CountryMarketError("Sweep task changed concurrently", 409);
  }

  await materializeCampaignOrganizations(
    db,
    task.country_code,
    organizationIds,
    timestamp
  );
  await advanceSweep(
    db,
    task,
    organizationIds,
    output.coverageSummary,
    timestamp
  );
  return {
    organizationCount: organizationIds.length,
    phase: task.phase,
    sweepId: task.sweep_id,
    taskId,
  };
}

export async function failCountrySweepTask(
  db: D1Database,
  userId: string,
  taskId: string,
  workerId: string,
  error: string
) {
  const timestamp = new Date().toISOString();
  const task = await db
    .prepare(
      `SELECT t.id,t.sweep_id,t.phase,t.scope_key,t.input_json,t.status,
              t.worker_id,t.attempt_count,s.country_code,s.country_name
         FROM country_sweep_tasks t
         JOIN country_sweeps s ON s.id=t.sweep_id
        WHERE t.id=? AND s.requested_by_user_id=?`
    )
    .bind(taskId, userId)
    .first<OwnedTaskRow>();
  if (task?.status !== "claimed" || task.worker_id !== workerId) {
    throw new CountryMarketError(
      "Sweep task is not claimed by this runner",
      409
    );
  }
  const requeued = task.attempt_count < COUNTRY_SWEEP_TASK_MAX_ATTEMPTS;
  const result = await db
    .prepare(
      `UPDATE country_sweep_tasks
          SET status=?,error_detail=?,worker_id=NULL,claimed_at=NULL,
              lease_expires_at=NULL,completed_at=?,updated_at=?
        WHERE id=? AND status='claimed' AND worker_id=?`
    )
    .bind(
      requeued ? "queued" : "failed",
      error,
      requeued ? null : timestamp,
      timestamp,
      taskId,
      workerId
    )
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new CountryMarketError(
      "Sweep task is not claimed by this runner",
      409
    );
  }
  if (requeued) {
    return { requeued: true, taskId };
  }
  if (task.phase === "coverage_audit") {
    await db
      .prepare(
        `UPDATE country_sweeps
            SET status='failed',error_detail=?,completed_at=?,updated_at=?
          WHERE id=?`
      )
      .bind(error, timestamp, timestamp, task.sweep_id)
      .run();
  } else {
    await advanceSweep(db, task, [], emptyCoverageSummary(), timestamp);
  }
  return { requeued: false, taskId };
}

async function upsertOrganizations(
  db: D1Database,
  task: OwnedTaskRow,
  output: CountrySweepTaskOutput
) {
  if (output.organizations.length === 0) {
    return [];
  }
  const timestamp = new Date().toISOString();
  const normalized = output.organizations.map((organization) => {
    const canonicalDomain = normalizeDomain(
      organization.canonicalDomain || organization.websiteUrl
    );
    const identityKey = canonicalDomain
      ? `domain:${canonicalDomain}`
      : `name:${normalizeIdentity(organization.name)}|city:${normalizeIdentity(
          organization.city
        )}`;
    return { ...organization, canonicalDomain, identityKey };
  });
  const results = await db.batch<{ id: string }>(
    normalized.map((organization) =>
      db
        .prepare(
          `INSERT INTO organizations
            (id,country_code,country_name,name,identity_key,city,region,
             website_url,canonical_domain,market_segment,status,
             outreach_eligibility,evidence_url,source_sweep_id,last_verified_at,
             created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(country_code,identity_key) DO UPDATE SET
             name=excluded.name,
             city=CASE WHEN excluded.city<>'' THEN excluded.city ELSE organizations.city END,
             region=CASE WHEN excluded.region<>'' THEN excluded.region ELSE organizations.region END,
             website_url=CASE WHEN excluded.website_url<>'' THEN excluded.website_url ELSE organizations.website_url END,
             canonical_domain=CASE WHEN excluded.canonical_domain<>'' THEN excluded.canonical_domain ELSE organizations.canonical_domain END,
             market_segment=excluded.market_segment,
             status=excluded.status,
             outreach_eligibility=excluded.outreach_eligibility,
             evidence_url=CASE WHEN excluded.evidence_url<>'' THEN excluded.evidence_url ELSE organizations.evidence_url END,
             source_sweep_id=excluded.source_sweep_id,
             last_verified_at=COALESCE(excluded.last_verified_at,organizations.last_verified_at),
             updated_at=excluded.updated_at
           RETURNING id`
        )
        .bind(
          crypto.randomUUID(),
          task.country_code,
          task.country_name,
          organization.name.trim(),
          organization.identityKey,
          organization.city.trim(),
          organization.region.trim(),
          organization.websiteUrl.trim(),
          organization.canonicalDomain,
          organization.marketSegment,
          organization.status,
          organization.outreachEligibility,
          organization.evidenceUrl.trim(),
          task.sweep_id,
          organization.lastVerifiedAt,
          timestamp,
          timestamp
        )
    )
  );
  const ids = results.map((result) => {
    const id = result.results.at(0)?.id;
    if (!id) {
      throw new Error("Sweep organization could not be read back");
    }
    return id;
  });

  const evidenceAndContactStatements: D1PreparedStatement[] = [];
  for (const [index, organization] of normalized.entries()) {
    const organizationId = ids[index];
    const evidenceUrl =
      organization.evidenceUrl.trim() || organization.websiteUrl.trim();
    evidenceAndContactStatements.push(
      db
        .prepare(
          `INSERT INTO organization_evidence
            (id,organization_id,source_sweep_id,source_kind,evidence_kind,
             evidence_status,roles,source_label,source_url,posting_context,
             notes,observed_at,provenance_path,metadata_json,created_at)
           VALUES (?,?,?,'country_sweep','organization_profile',?,'',?,?,?,
                   '',?,?,?,?)
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
          crypto.randomUUID(),
          organizationId,
          task.sweep_id,
          organizationEvidenceStatus(organization.status),
          `country_sweep.${task.phase}`,
          evidenceUrl,
          task.scope_key,
          organization.lastVerifiedAt ?? timestamp,
          `country_sweep:${task.sweep_id}/${task.id}`,
          JSON.stringify({ phase: task.phase, scopeKey: task.scope_key }),
          timestamp
        )
    );
    for (const contact of organization.contactPoints) {
      const value =
        contact.kind === "email"
          ? contact.value.trim().toLowerCase()
          : contact.value.trim();
      evidenceAndContactStatements.push(
        db
          .prepare(
            `INSERT INTO organization_contact_points
              (id,organization_id,kind,label,value,status,evidence_url,
               last_verified_at,created_at,updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT(organization_id,kind,value) DO UPDATE SET
               label=excluded.label,
               status=excluded.status,
               evidence_url=CASE WHEN excluded.evidence_url<>'' THEN excluded.evidence_url ELSE organization_contact_points.evidence_url END,
               last_verified_at=COALESCE(excluded.last_verified_at,organization_contact_points.last_verified_at),
               updated_at=excluded.updated_at`
          )
          .bind(
            crypto.randomUUID(),
            organizationId,
            contact.kind,
            contact.label.trim(),
            value,
            contact.status,
            contact.evidenceUrl.trim(),
            organization.lastVerifiedAt,
            timestamp,
            timestamp
          )
      );
    }
  }
  if (evidenceAndContactStatements.length > 0) {
    await db.batch(evidenceAndContactStatements);
  }
  return [...new Set(ids)];
}

function organizationEvidenceStatus(status: string) {
  if (status === "active") {
    return "active";
  }
  if (status === "stale" || status === "closed") {
    return "stale";
  }
  return "unclear";
}

async function advanceSweep(
  db: D1Database,
  task: OwnedTaskRow,
  organizationIds: string[],
  coverageSummary: CountrySweepTaskOutput["coverageSummary"],
  timestamp: string
) {
  if (task.phase === "coverage_audit") {
    const verificationCount = await createVerificationTasks(
      db,
      task,
      timestamp,
      organizationIds
    );
    if (verificationCount > 0) {
      return;
    }
    const discoveryCount = await createDiscoveryTasks(
      db,
      task,
      coverageSummary.nextScopes,
      timestamp
    );
    if (discoveryCount > 0) {
      return;
    }
    await db
      .prepare(
        `UPDATE country_sweeps
            SET status='completed',coverage_summary_json=?,completed_at=?,
                updated_at=?
          WHERE id=?`
      )
      .bind(
        JSON.stringify(coverageSummary),
        timestamp,
        timestamp,
        task.sweep_id
      )
      .run();
    return;
  }

  const remaining = await db
    .prepare(
      `SELECT COUNT(*) count FROM country_sweep_tasks
        WHERE sweep_id=? AND phase=? AND status NOT IN ('completed','failed')`
    )
    .bind(task.sweep_id, task.phase)
    .first<number>("count");
  if (Number(remaining ?? 0) > 0) {
    return;
  }

  if (task.phase === "discovery") {
    const verificationCount = await createVerificationTasks(
      db,
      task,
      timestamp
    );
    if (verificationCount > 0) {
      return;
    }
  }

  await createCoverageAuditTask(db, task, timestamp);
}

async function createCoverageAuditTask(
  db: D1Database,
  task: OwnedTaskRow,
  timestamp: string
) {
  const progress = await countSweepProgress(db, task.sweep_id);
  return db
    .prepare(
      `INSERT INTO country_sweep_tasks
        (id,sweep_id,phase,scope_key,status,input_json,created_at,updated_at)
       VALUES (?,?,'coverage_audit',?,'queued',?,?,?)
       ON CONFLICT(sweep_id,phase,scope_key) DO NOTHING`
    )
    .bind(
      crypto.randomUUID(),
      task.sweep_id,
      `coverage:${progress.discoveryCount}:${progress.coverageCount}`,
      JSON.stringify({
        countryCode: task.country_code,
        countryName: task.country_name,
        phase: "coverage_audit",
        progress,
      }),
      timestamp,
      timestamp
    )
    .run();
}

async function createVerificationTasks(
  db: D1Database,
  task: OwnedTaskRow,
  timestamp: string,
  organizationIds: string[] = []
) {
  const idFilter =
    organizationIds.length > 0
      ? ` AND id IN (${organizationIds.map(() => "?").join(",")})`
      : "";
  const organizations = await db
    .prepare(
      `SELECT id,name,city,region,website_url,canonical_domain,market_segment,
              status,outreach_eligibility,evidence_url
         FROM organizations WHERE source_sweep_id=?${idFilter}
         ORDER BY name`
    )
    .bind(task.sweep_id, ...organizationIds)
    .all<OrganizationRow>();
  if (organizations.results.length === 0) {
    return 0;
  }
  const results = await db.batch(
    organizations.results.map((organization) =>
      db
        .prepare(
          `INSERT INTO country_sweep_tasks
            (id,sweep_id,phase,scope_key,status,input_json,created_at,updated_at)
           VALUES (?,?,'verification',?,'queued',?,?,?)
           ON CONFLICT(sweep_id,phase,scope_key) DO NOTHING`
        )
        .bind(
          crypto.randomUUID(),
          task.sweep_id,
          organization.id,
          JSON.stringify({
            countryCode: task.country_code,
            countryName: task.country_name,
            organization: {
              canonicalDomain: organization.canonical_domain,
              city: organization.city,
              evidenceUrl: organization.evidence_url,
              id: organization.id,
              marketSegment: organization.market_segment,
              name: organization.name,
              outreachEligibility: organization.outreach_eligibility,
              region: organization.region,
              status: organization.status,
              websiteUrl: organization.website_url,
            },
            phase: "verification",
          }),
          timestamp,
          timestamp
        )
    )
  );
  return results.reduce(
    (count, result) => count + Number(result.meta.changes ?? 0),
    0
  );
}

async function createDiscoveryTasks(
  db: D1Database,
  task: OwnedTaskRow,
  scopes: CountrySweepTaskOutput["coverageSummary"]["nextScopes"],
  timestamp: string
) {
  if (scopes.length === 0) {
    return 0;
  }
  const uniqueScopes = new Map(
    scopes.map((scope) => [discoveryScopeKey(scope), scope])
  );
  const results = await db.batch(
    [...uniqueScopes].map(([scopeKey, scope]) =>
      db
        .prepare(
          `INSERT INTO country_sweep_tasks
            (id,sweep_id,phase,scope_key,status,input_json,created_at,updated_at)
           VALUES (?,?,'discovery',?,'queued',?,?,?)
           ON CONFLICT(sweep_id,phase,scope_key) DO NOTHING`
        )
        .bind(
          crypto.randomUUID(),
          task.sweep_id,
          scopeKey,
          JSON.stringify({
            city: scope.city,
            countryCode: task.country_code,
            countryName: task.country_name,
            phase: "discovery",
            query: scope.query,
            source: scope.source,
          }),
          timestamp,
          timestamp
        )
    )
  );
  return results.reduce(
    (count, result) => count + Number(result.meta.changes ?? 0),
    0
  );
}

async function countSweepProgress(db: D1Database, sweepId: string) {
  const counts = await db
    .prepare(
      `SELECT
         SUM(phase='discovery' AND status='completed') discovery_count,
         SUM(phase='coverage_audit' AND status='completed') coverage_count
       FROM country_sweep_tasks WHERE sweep_id=?`
    )
    .bind(sweepId)
    .first<{ coverage_count: number; discovery_count: number }>();
  return {
    coverageCount: Number(counts?.coverage_count ?? 0),
    discoveryCount: Number(counts?.discovery_count ?? 0),
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

function emptyCoverageSummary(): CountrySweepTaskOutput["coverageSummary"] {
  return {
    citiesChecked: [],
    gaps: [],
    needsAnotherPass: false,
    nextScopes: [],
    queriesChecked: [],
    resultCount: 0,
    sourcesChecked: [],
  };
}

async function materializeCampaignOrganizations(
  db: D1Database,
  countryCode: string,
  organizationIds: string[],
  timestamp: string
) {
  if (organizationIds.length === 0) {
    return;
  }
  const placeholders = organizationIds.map(() => "?").join(",");
  const rows = await db
    .prepare(
      `SELECT c.id campaign_id,o.id organization_id,cp.id contact_point_id,
              cp.value contact_value,o.market_segment,c.policy_snapshot_json
         FROM campaigns c
         JOIN campaign_markets cm ON cm.campaign_id=c.id
         JOIN organizations o ON o.country_code=cm.country_code
         JOIN organization_contact_points cp ON cp.id=(
           SELECT candidate.id FROM organization_contact_points candidate
            WHERE candidate.organization_id=o.id
              AND candidate.kind='email' AND candidate.status='active'
            ORDER BY candidate.last_verified_at DESC,candidate.updated_at DESC
            LIMIT 1
         )
        WHERE cm.country_code=?
          AND c.status IN ('draft','calibrating','ready','running','paused')
          AND o.status='active' AND o.outreach_eligibility='eligible'
          AND o.id IN (${placeholders})`
    )
    .bind(countryCode, ...organizationIds)
    .all<{
      campaign_id: string;
      contact_point_id: string;
      contact_value: string;
      market_segment: string;
      organization_id: string;
      policy_snapshot_json: string;
    }>();
  if (rows.results.length === 0) {
    return;
  }
  await db.batch(
    rows.results.map((row) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO campaign_targets
            (id,campaign_id,country_code,source_kind,subject_kind,subject_id,
             organization_id,contact_point_id,channel,route_strategy,dedup_key,
             status,hold_reason,admitted_at,updated_at)
           VALUES (?,?,?,'school','organization',?,?,?,'email','single',?,?,?,?,?)`
        )
        .bind(
          crypto.randomUUID(),
          row.campaign_id,
          countryCode,
          row.organization_id,
          row.organization_id,
          row.contact_point_id,
          `email:${row.contact_value.trim().toLowerCase()}`,
          excludedByCampaignPolicy(row) ? "held" : "eligible",
          excludedByCampaignPolicy(row)
            ? "Excluded market segment in the saved campaign policy"
            : "",
          timestamp,
          timestamp
        )
    )
  );
}

function excludedByCampaignPolicy(row: {
  market_segment: string;
  policy_snapshot_json: string;
}) {
  const policy = JSON.parse(row.policy_snapshot_json) as {
    excludedMarketSegments?: string[];
  };
  return (policy.excludedMarketSegments ?? []).includes(row.market_segment);
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
