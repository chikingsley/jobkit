import {
  type CountrySweepCanonicalChunk,
  CountrySweepCanonicalChunkSchema,
  canonicalCountrySweepChunkJson,
  MAX_CANONICAL_CHUNK_BYTES,
  MAX_RECORDS_PER_CHUNK,
  sha256Hex,
} from "../../../src/features/countries/materialization";
import type { AppEnv } from "../../env";
import { isConstraintError } from "../agent-tasks/run-store";
import { MATERIALIZATION_TOPIC } from "./output";

const MATERIALIZATION_LEASE_MINUTES = 5;
const FANOUT_PAGE_SIZE = 1000;

type MaterializationKind =
  | "organizations_chunk"
  | "contacts_chunk"
  | "scopes_chunk"
  | "campaign_fanout"
  | "verification_fanout"
  | "phase_finalize";

interface MaterializationItemRow {
  attempt_count: number;
  byte_length: number | null;
  chunk_id: string | null;
  country_code: string;
  error_code: string;
  expected_count: number;
  id: string;
  kind: MaterializationKind;
  lease_token: string;
  max_attempts: number;
  object_key: string | null;
  output_id: string;
  output_status: "accepted" | "materializing";
  phase: "coverage_audit" | "discovery" | "verification";
  record_count: number | null;
  schema_version: number;
  sequence: number;
  sha256: string | null;
  sweep_id: string;
  task_id: string;
  user_id: string;
}

interface FanoutPageResult {
  completed: boolean;
  insertedCount: number;
  nextPrimary: string;
  nextSecondary: string;
  processedCount: number;
}

export async function materializeOneCountrySweepItem(
  env: AppEnv,
  outputId: string,
  workerId = `queue:${crypto.randomUUID()}`,
  workItemId?: string
) {
  const item = await claimMaterializationItem(
    env.DB,
    outputId,
    workerId,
    workItemId
  );
  if (!item) {
    return { outcome: "duplicate_or_idle" as const, outputId };
  }
  try {
    if (item.kind.endsWith("_chunk")) {
      await materializeChunk(env, item);
    } else if (item.kind === "campaign_fanout") {
      await materializeCampaignFanout(env.DB, item);
    } else if (item.kind === "verification_fanout") {
      await materializeVerificationFanout(env.DB, item);
    } else {
      await finalizeMaterializedOutput(env.DB, item);
    }
    return { itemId: item.id, outcome: "committed" as const, outputId };
  } catch (error) {
    await recordMaterializationFailure(env.DB, item, error);
    throw error;
  }
}

export async function reapExpiredCountryMaterializationItems(
  db: D1Database,
  limit = 5
) {
  const candidates = await db
    .prepare(
      `SELECT item.attempt_count,item.chunk_id,item.error_code,
              item.expected_count,item.id,item.kind,item.lease_token,
              item.max_attempts,item.output_id,item.sequence,
              output.status output_status,output.schema_version,
              task.id task_id,task.sweep_id,task.phase,
              sweep.country_code,sweep.requested_by_user_id user_id,
              chunk.object_key,chunk.sha256,chunk.byte_length,chunk.record_count
         FROM country_sweep_materialization_items item
         JOIN country_sweep_outputs output ON output.id=item.output_id
         JOIN country_sweep_tasks task ON task.id=output.task_id
         JOIN country_sweeps sweep ON sweep.id=task.sweep_id
         LEFT JOIN country_sweep_output_chunks chunk ON chunk.id=item.chunk_id
        WHERE item.status='processing'
          AND item.lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          AND output.status IN ('accepted','materializing')
        ORDER BY item.lease_expires_at,item.id LIMIT ?`
    )
    .bind(Math.max(1, Math.min(limit, 10)))
    .all<MaterializationItemRow>();
  let reaped = 0;
  for (const item of candidates.results) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: Each expired item owns one independent atomic D1 recovery transaction.
      await recordMaterializationFailure(
        db,
        item,
        new Error("Country materialization lease expired"),
        "expired"
      );
      reaped += 1;
    } catch (error) {
      if (!isMaterializationRace(error)) {
        throw error;
      }
    }
  }
  return { reaped, selected: candidates.results.length };
}

async function claimMaterializationItem(
  db: D1Database,
  outputId: string,
  workerId: string,
  workItemId?: string
) {
  const candidate = await db
    .prepare(
      `SELECT item.id
         FROM country_sweep_materialization_items item
         JOIN country_sweep_outputs output ON output.id=item.output_id
        WHERE item.output_id=? AND item.status='queued'
          AND (? IS NULL OR item.id=?)
          AND item.attempt_count<item.max_attempts
          AND output.status IN ('accepted','materializing')
          AND ${materializationStagePrerequisitesSql("item")}
        ORDER BY item.sequence,item.id LIMIT 1`
    )
    .bind(outputId, workItemId ?? null, workItemId ?? null)
    .first<{ id: string }>();
  if (!candidate) {
    return null;
  }
  const leaseToken = crypto.randomUUID();
  let results: D1Result<unknown>[];
  try {
    results = await db.batch([
      db
        .prepare(
          `UPDATE country_sweep_materialization_items
            SET status='processing',attempt_count=attempt_count+1,
                lease_owner=?,lease_token=?,
                lease_expires_at=strftime(
                  '%Y-%m-%dT%H:%M:%fZ','now','+5 minutes'
                ),error_code='',error_detail='',
                updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=? AND output_id=? AND status='queued'
            AND attempt_count<max_attempts
            AND ${materializationStagePrerequisitesSql(
              "country_sweep_materialization_items"
            )}
        RETURNING attempt_count,chunk_id,error_code,expected_count,id,kind,
                  lease_token,max_attempts,output_id,sequence`
        )
        .bind(workerId, leaseToken, candidate.id, outputId),
      requiredChangesAssertion(db, 1),
      db
        .prepare(
          `UPDATE country_sweep_outputs
            SET status='materializing',
                updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=? AND status IN ('accepted','materializing')`
        )
        .bind(outputId),
      requiredChangesAssertion(db, 1),
    ]);
  } catch (error) {
    if (isConstraintError(error)) {
      return null;
    }
    throw error;
  }
  const claimed = results[0]?.results?.[0] as
    | Pick<
        MaterializationItemRow,
        | "attempt_count"
        | "chunk_id"
        | "error_code"
        | "expected_count"
        | "id"
        | "kind"
        | "lease_token"
        | "max_attempts"
        | "output_id"
        | "sequence"
      >
    | undefined;
  if (!claimed) {
    return null;
  }
  const row = await db
    .prepare(
      `SELECT item.attempt_count,item.chunk_id,item.error_code,
              item.expected_count,item.id,item.kind,item.lease_token,
              item.max_attempts,item.output_id,item.sequence,
              output.status output_status,output.schema_version,
              task.id task_id,task.sweep_id,task.phase,
              sweep.country_code,sweep.requested_by_user_id user_id,
              chunk.object_key,chunk.sha256,chunk.byte_length,chunk.record_count
         FROM country_sweep_materialization_items item
         JOIN country_sweep_outputs output ON output.id=item.output_id
         JOIN country_sweep_tasks task ON task.id=output.task_id
         JOIN country_sweeps sweep ON sweep.id=task.sweep_id
         LEFT JOIN country_sweep_output_chunks chunk ON chunk.id=item.chunk_id
        WHERE item.id=? AND item.output_id=? AND item.status='processing'
          AND item.lease_owner=? AND item.lease_token=?
          AND item.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')`
    )
    .bind(candidate.id, outputId, workerId, leaseToken)
    .first<MaterializationItemRow>();
  return row ?? null;
}

async function materializeChunk(env: AppEnv, item: MaterializationItemRow) {
  if (
    !(item.chunk_id && item.object_key && item.sha256) ||
    item.byte_length === null ||
    item.record_count === null
  ) {
    throw new Error("Materialization chunk metadata is incomplete");
  }
  const object = await env.SWEEP_OUTPUTS.get(item.object_key);
  if (!object) {
    throw new Error("Materialization chunk object is unavailable");
  }
  const bytes = await object.bytes();
  if (
    bytes.byteLength !== item.byte_length ||
    bytes.byteLength > MAX_CANONICAL_CHUNK_BYTES
  ) {
    throw new Error("Materialization chunk byte length changed");
  }
  if ((await sha256Hex(bytes)) !== item.sha256) {
    throw new Error("Materialization chunk SHA-256 changed");
  }
  const chunk = CountrySweepCanonicalChunkSchema.parse(
    JSON.parse(new TextDecoder().decode(bytes))
  );
  if (
    chunk.schemaVersion !== item.schema_version ||
    chunk.records.length !== item.record_count ||
    chunk.records.length > MAX_RECORDS_PER_CHUNK ||
    canonicalCountrySweepChunkJson(chunk) !== new TextDecoder().decode(bytes)
  ) {
    throw new Error("Materialization chunk canonical schema changed");
  }
  if (`${chunk.kind}_chunk` !== item.kind) {
    throw new Error("Materialization chunk kind changed");
  }
  if (chunk.kind === "organizations") {
    await materializeOrganizations(env.DB, item, chunk);
  } else if (chunk.kind === "contacts") {
    await materializeContacts(env.DB, item, chunk);
  } else {
    await materializeScopes(env.DB, item, chunk);
  }
}

async function materializeOrganizations(
  db: D1Database,
  item: MaterializationItemRow,
  chunk: Extract<CountrySweepCanonicalChunk, { kind: "organizations" }>
) {
  const records = await Promise.all(
    chunk.records.map(async (record) => ({
      ...record,
      evidenceId: await stableId(
        "country-evidence",
        item.sweep_id,
        record.identityKey
      ),
      organizationId: await stableId(
        "country-organization",
        item.country_code,
        record.identityKey
      ),
    }))
  );
  const json = JSON.stringify(records);
  const guard = materializationGuardSql("output.id");
  const values = materializationGuardValues(item);
  const outboxId = nextOutboxId(item);
  const statements = [
    db
      .prepare(
        `INSERT INTO organizations
          (id,country_code,country_name,name,identity_key,city,region,
           website_url,canonical_domain,market_segment,status,
           outreach_eligibility,evidence_url,source_sweep_id,last_verified_at,
           created_at,updated_at)
         SELECT json_extract(record.value,'$.organizationId'),sweep.country_code,
                sweep.country_name,json_extract(record.value,'$.name'),
                json_extract(record.value,'$.identityKey'),
                json_extract(record.value,'$.city'),
                json_extract(record.value,'$.region'),
                json_extract(record.value,'$.websiteUrl'),
                json_extract(record.value,'$.canonicalDomain'),
                json_extract(record.value,'$.marketSegment'),
                json_extract(record.value,'$.status'),
                json_extract(record.value,'$.outreachEligibility'),
                json_extract(record.value,'$.evidenceUrl'),output.sweep_id,
                json_extract(record.value,'$.lastVerifiedAt'),
                strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                strftime('%Y-%m-%dT%H:%M:%fZ','now')
           FROM json_each(?) record
           JOIN country_sweep_outputs output ON output.id=?
           JOIN country_sweeps sweep ON sweep.id=output.sweep_id
          WHERE ${guard}
         ON CONFLICT(country_code,identity_key) DO NOTHING`
      )
      .bind(json, item.output_id, ...values),
    captureInsertedCountStatement(db, item),
    requiredChangesAssertion(db, 1),
    db
      .prepare(
        `INSERT INTO organizations
          (id,country_code,country_name,name,identity_key,city,region,
           website_url,canonical_domain,market_segment,status,
           outreach_eligibility,evidence_url,source_sweep_id,last_verified_at,
           created_at,updated_at)
         SELECT json_extract(record.value,'$.organizationId'),sweep.country_code,
                sweep.country_name,json_extract(record.value,'$.name'),
                json_extract(record.value,'$.identityKey'),
                json_extract(record.value,'$.city'),
                json_extract(record.value,'$.region'),
                json_extract(record.value,'$.websiteUrl'),
                json_extract(record.value,'$.canonicalDomain'),
                json_extract(record.value,'$.marketSegment'),
                json_extract(record.value,'$.status'),
                json_extract(record.value,'$.outreachEligibility'),
                json_extract(record.value,'$.evidenceUrl'),output.sweep_id,
                json_extract(record.value,'$.lastVerifiedAt'),
                strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                strftime('%Y-%m-%dT%H:%M:%fZ','now')
           FROM json_each(?) record
           JOIN country_sweep_outputs output ON output.id=?
           JOIN country_sweeps sweep ON sweep.id=output.sweep_id
          WHERE ${guard}
         ON CONFLICT(country_code,identity_key) DO UPDATE SET
           name=excluded.name,city=excluded.city,region=excluded.region,
           website_url=excluded.website_url,
           canonical_domain=excluded.canonical_domain,
           market_segment=excluded.market_segment,status=excluded.status,
           outreach_eligibility=excluded.outreach_eligibility,
           evidence_url=excluded.evidence_url,
           source_sweep_id=excluded.source_sweep_id,
           last_verified_at=COALESCE(
             excluded.last_verified_at,organizations.last_verified_at
           ),updated_at=excluded.updated_at`
      )
      .bind(json, item.output_id, ...values),
    requiredChangesAssertion(db, records.length),
    db
      .prepare(
        `INSERT INTO organization_evidence
          (id,organization_id,source_sweep_id,source_kind,evidence_kind,
           evidence_status,roles,source_label,source_url,posting_context,notes,
           observed_at,provenance_path,metadata_json,created_at)
         SELECT json_extract(record.value,'$.evidenceId'),organization.id,
                output.sweep_id,'country_sweep','organization_profile',
                CASE json_extract(record.value,'$.status')
                  WHEN 'active' THEN 'active'
                  WHEN 'stale' THEN 'stale'
                  WHEN 'closed' THEN 'stale'
                  ELSE 'unclear' END,'','country_sweep.'||task.phase,
                CASE WHEN json_extract(record.value,'$.evidenceUrl')<>''
                  THEN json_extract(record.value,'$.evidenceUrl')
                  ELSE json_extract(record.value,'$.websiteUrl') END,
                task.scope_key,'',COALESCE(
                  json_extract(record.value,'$.lastVerifiedAt'),
                  strftime('%Y-%m-%dT%H:%M:%fZ','now')
                ),'country_sweep:'||output.id||'/'||?,
                json_object(
                  'outputId',output.id,'chunkId',?,'identityKey',
                  json_extract(record.value,'$.identityKey')
                ),strftime('%Y-%m-%dT%H:%M:%fZ','now')
           FROM json_each(?) record
           JOIN country_sweep_outputs output ON output.id=?
           JOIN country_sweep_tasks task ON task.id=output.task_id
           JOIN organizations organization
             ON organization.country_code=(
               SELECT country_code FROM country_sweeps WHERE id=output.sweep_id
             )
            AND organization.identity_key=json_extract(record.value,'$.identityKey')
          WHERE ${guard}
         ON CONFLICT(organization_id,source_kind,source_url,roles) DO UPDATE SET
           source_sweep_id=excluded.source_sweep_id,
           evidence_status=excluded.evidence_status,
           source_label=excluded.source_label,
           posting_context=excluded.posting_context,
           observed_at=excluded.observed_at,
           provenance_path=excluded.provenance_path,
           metadata_json=excluded.metadata_json`
      )
      .bind(item.sequence, item.chunk_id, json, item.output_id, ...values),
    requiredChangesAssertion(db, records.length),
    db
      .prepare(
        `INSERT INTO country_sweep_output_organizations
          (output_id,chunk_id,identity_key,organization_id)
         SELECT output.id,?,json_extract(record.value,'$.identityKey'),
                organization.id
           FROM json_each(?) record
           JOIN country_sweep_outputs output ON output.id=?
           JOIN country_sweeps sweep ON sweep.id=output.sweep_id
           JOIN organizations organization
             ON organization.country_code=sweep.country_code
            AND organization.identity_key=json_extract(record.value,'$.identityKey')
          WHERE ${guard}
         ON CONFLICT(output_id,identity_key) DO UPDATE SET
           chunk_id=excluded.chunk_id,organization_id=excluded.organization_id`
      )
      .bind(item.chunk_id, json, item.output_id, ...values),
    requiredChangesAssertion(db, records.length),
    completeChunkItemStatement(db, item, records.length),
    requiredChangesAssertion(db, 1),
    insertNextOutboxStatement(db, item.output_id, outboxId),
    requiredChangesAssertion(db, 1),
  ];
  await guardedBatch(db, statements);
}

async function materializeContacts(
  db: D1Database,
  item: MaterializationItemRow,
  chunk: Extract<CountrySweepCanonicalChunk, { kind: "contacts" }>
) {
  const records = await Promise.all(
    chunk.records.map(async (record) => ({
      ...record,
      contactId: await stableId(
        "country-contact",
        item.country_code,
        record.contactKey
      ),
    }))
  );
  const json = JSON.stringify(records);
  const guard = materializationGuardSql("output.id");
  const values = materializationGuardValues(item);
  const statements = [
    db
      .prepare(
        `INSERT INTO organization_contact_points
          (id,organization_id,kind,label,value,status,evidence_url,
           last_verified_at,created_at,updated_at)
         SELECT json_extract(record.value,'$.contactId'),organization.id,
                json_extract(record.value,'$.kind'),
                json_extract(record.value,'$.label'),
                json_extract(record.value,'$.value'),
                json_extract(record.value,'$.status'),
                json_extract(record.value,'$.evidenceUrl'),
                json_extract(record.value,'$.lastVerifiedAt'),
                strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                strftime('%Y-%m-%dT%H:%M:%fZ','now')
           FROM json_each(?) record
           JOIN country_sweep_outputs output ON output.id=?
           JOIN country_sweeps sweep ON sweep.id=output.sweep_id
           JOIN organizations organization
             ON organization.country_code=sweep.country_code
            AND organization.identity_key=
                json_extract(record.value,'$.organizationIdentityKey')
          WHERE ${guard}
         ON CONFLICT(organization_id,kind,value) DO NOTHING`
      )
      .bind(json, item.output_id, ...values),
    captureInsertedCountStatement(db, item),
    requiredChangesAssertion(db, 1),
    db
      .prepare(
        `INSERT INTO organization_contact_points
          (id,organization_id,kind,label,value,status,evidence_url,
           last_verified_at,created_at,updated_at)
         SELECT json_extract(record.value,'$.contactId'),organization.id,
                json_extract(record.value,'$.kind'),
                json_extract(record.value,'$.label'),
                json_extract(record.value,'$.value'),
                json_extract(record.value,'$.status'),
                json_extract(record.value,'$.evidenceUrl'),
                json_extract(record.value,'$.lastVerifiedAt'),
                strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                strftime('%Y-%m-%dT%H:%M:%fZ','now')
           FROM json_each(?) record
           JOIN country_sweep_outputs output ON output.id=?
           JOIN country_sweeps sweep ON sweep.id=output.sweep_id
           JOIN organizations organization
             ON organization.country_code=sweep.country_code
            AND organization.identity_key=
                json_extract(record.value,'$.organizationIdentityKey')
          WHERE ${guard}
         ON CONFLICT(organization_id,kind,value) DO UPDATE SET
           label=excluded.label,status=excluded.status,
           evidence_url=excluded.evidence_url,
           last_verified_at=COALESCE(
             excluded.last_verified_at,organization_contact_points.last_verified_at
           ),updated_at=excluded.updated_at`
      )
      .bind(json, item.output_id, ...values),
    requiredChangesAssertion(db, records.length),
    db
      .prepare(
        `INSERT INTO country_sweep_output_contacts
          (output_id,chunk_id,contact_key,contact_point_id,organization_id)
         SELECT output.id,?,json_extract(record.value,'$.contactKey'),
                contact.id,organization.id
           FROM json_each(?) record
           JOIN country_sweep_outputs output ON output.id=?
           JOIN country_sweeps sweep ON sweep.id=output.sweep_id
           JOIN organizations organization
             ON organization.country_code=sweep.country_code
            AND organization.identity_key=
                json_extract(record.value,'$.organizationIdentityKey')
           JOIN organization_contact_points contact
             ON contact.organization_id=organization.id
            AND contact.kind=json_extract(record.value,'$.kind')
            AND contact.value=json_extract(record.value,'$.value')
          WHERE ${guard}
         ON CONFLICT(output_id,contact_key) DO UPDATE SET
           chunk_id=excluded.chunk_id,
           contact_point_id=excluded.contact_point_id,
           organization_id=excluded.organization_id`
      )
      .bind(item.chunk_id, json, item.output_id, ...values),
    requiredChangesAssertion(db, records.length),
    completeChunkItemStatement(db, item, records.length),
    requiredChangesAssertion(db, 1),
    insertNextOutboxStatement(db, item.output_id, nextOutboxId(item)),
    requiredChangesAssertion(db, 1),
  ];
  await guardedBatch(db, statements);
}

async function materializeScopes(
  db: D1Database,
  item: MaterializationItemRow,
  chunk: Extract<CountrySweepCanonicalChunk, { kind: "scopes" }>
) {
  const taskContext = await db
    .prepare(
      `SELECT sweep.country_code,sweep.country_name
         FROM country_sweep_outputs output
         JOIN country_sweeps sweep ON sweep.id=output.sweep_id
        WHERE output.id=?`
    )
    .bind(item.output_id)
    .first<{ country_code: string; country_name: string }>();
  if (!taskContext) {
    throw new Error("Country sweep context is unavailable");
  }
  const records = await Promise.all(
    chunk.records.map(async (record) => {
      const inputJson = JSON.stringify({
        city: record.city,
        countryCode: taskContext.country_code,
        countryName: taskContext.country_name,
        phase: "discovery",
        query: record.query,
        source: record.source,
      });
      return {
        ...record,
        inputHash: await sha256Hex(inputJson),
        inputJson,
        taskId: await stableId(
          "country-scope-task",
          item.sweep_id,
          record.scopeKey
        ),
      };
    })
  );
  const json = JSON.stringify(records);
  const guard = materializationGuardSql("output.id");
  const directGuard = directMaterializationGuardSql();
  const values = materializationGuardValues(item);
  const statements = [
    db
      .prepare(
        `INSERT INTO country_sweep_tasks
          (id,sweep_id,phase,scope_key,status,input_json,input_hash,
           created_at,updated_at)
         SELECT json_extract(record.value,'$.taskId'),output.sweep_id,
                'discovery',json_extract(record.value,'$.scopeKey'),'queued',
                json_extract(record.value,'$.inputJson'),
                json_extract(record.value,'$.inputHash'),
                strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                strftime('%Y-%m-%dT%H:%M:%fZ','now')
           FROM json_each(?) record
           JOIN country_sweep_outputs output ON output.id=?
          WHERE ${guard}
         ON CONFLICT(sweep_id,phase,scope_key) DO NOTHING`
      )
      .bind(json, item.output_id, ...values),
    captureInsertedCountStatement(db, item),
    requiredChangesAssertion(db, 1),
    db
      .prepare(
        `INSERT INTO country_sweep_output_scopes
          (output_id,chunk_id,scope_key,task_id)
         SELECT output.id,?,json_extract(record.value,'$.scopeKey'),task.id
           FROM json_each(?) record
           JOIN country_sweep_outputs output ON output.id=?
           JOIN country_sweep_tasks task
             ON task.sweep_id=output.sweep_id AND task.phase='discovery'
            AND task.scope_key=json_extract(record.value,'$.scopeKey')
          WHERE ${guard}
         ON CONFLICT(output_id,scope_key) DO UPDATE SET
           chunk_id=excluded.chunk_id,task_id=excluded.task_id`
      )
      .bind(item.chunk_id, json, item.output_id, ...values),
    requiredChangesAssertion(db, records.length),
    db
      .prepare(
        `UPDATE country_sweeps
            SET task_total=(
                  SELECT COUNT(*) FROM country_sweep_tasks task
                   WHERE task.sweep_id=country_sweeps.id
                ),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=? AND status='running' AND ${directGuard}`
      )
      .bind(item.sweep_id, ...directMaterializationGuardValues(item)),
    requiredChangesAssertion(db, 1),
    completeChunkItemStatement(db, item, records.length),
    requiredChangesAssertion(db, 1),
    insertNextOutboxStatement(db, item.output_id, nextOutboxId(item)),
    requiredChangesAssertion(db, 1),
  ];
  await guardedBatch(db, statements);
}

async function materializeCampaignFanout(
  db: D1Database,
  item: MaterializationItemRow
) {
  const [cursorPrimary, cursorSecondary] = await Promise.all([
    readItemCursor(db, item.id, "cursor_primary"),
    readItemCursor(db, item.id, "cursor_secondary"),
  ]);
  const page = await db
    .prepare(
      `SELECT organization.id organization_id,campaign.id campaign_id,
              contact.id contact_id,contact.value contact_value,
              organization.market_segment
         FROM country_sweep_output_organizations provenance
         JOIN country_sweep_outputs output ON output.id=provenance.output_id
         JOIN organizations organization
           ON organization.id=provenance.organization_id
         JOIN campaign_markets market
           ON market.country_code=organization.country_code
         JOIN campaigns campaign ON campaign.id=market.campaign_id
          AND campaign.status IN (
            'draft','calibrating','ready','running','paused'
          )
         JOIN organization_contact_points contact ON contact.id=(
           SELECT candidate.id FROM organization_contact_points candidate
            WHERE candidate.organization_id=organization.id
              AND candidate.kind='email' AND candidate.status='active'
            ORDER BY candidate.last_verified_at DESC,candidate.updated_at DESC,
                     candidate.id
            LIMIT 1
         )
        WHERE provenance.output_id=? AND organization.status='active'
          AND organization.outreach_eligibility='eligible'
          AND (
            organization.id>? OR (
              organization.id=? AND campaign.id>?
            )
          )
        ORDER BY organization.id,campaign.id LIMIT ?`
    )
    .bind(
      item.output_id,
      cursorPrimary,
      cursorPrimary,
      cursorSecondary,
      FANOUT_PAGE_SIZE
    )
    .all<{
      campaign_id: string;
      contact_id: string;
      contact_value: string;
      market_segment: string;
      organization_id: string;
    }>();
  const rows = page.results.map((row) => ({
    ...row,
    id: `country-target:${row.campaign_id}:${row.organization_id}`,
  }));
  const last = rows.at(-1);
  const result: FanoutPageResult = {
    completed: rows.length < FANOUT_PAGE_SIZE,
    insertedCount: 0,
    nextPrimary: last?.organization_id ?? "",
    nextSecondary: last?.campaign_id ?? "",
    processedCount: rows.length,
  };
  await commitCampaignPage(db, item, rows, result);
}

async function commitCampaignPage(
  db: D1Database,
  item: MaterializationItemRow,
  rows: Array<{
    campaign_id: string;
    contact_id: string;
    contact_value: string;
    id: string;
    market_segment: string;
    organization_id: string;
  }>,
  result: FanoutPageResult
) {
  const guard = materializationGuardSql("output.id");
  const values = materializationGuardValues(item);
  const statements: D1PreparedStatement[] = [];
  if (rows.length > 0) {
    statements.push(
      db
        .prepare(
          `INSERT INTO campaign_targets
            (id,campaign_id,country_code,source_kind,subject_kind,subject_id,
             organization_id,contact_point_id,channel,route_strategy,dedup_key,
             status,hold_reason,admitted_at,updated_at)
           SELECT json_extract(record.value,'$.id'),campaign.id,sweep.country_code,
                  'school','organization',organization.id,organization.id,
                  json_extract(record.value,'$.contact_id'),'email','single',
                  'email:'||lower(trim(json_extract(record.value,'$.contact_value'))),
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
             FROM json_each(?) record
             JOIN country_sweep_outputs output ON output.id=?
             JOIN country_sweeps sweep ON sweep.id=output.sweep_id
             JOIN campaigns campaign
               ON campaign.id=json_extract(record.value,'$.campaign_id')
             JOIN organizations organization
               ON organization.id=json_extract(record.value,'$.organization_id')
            WHERE ${guard}
           ON CONFLICT(campaign_id,subject_kind,subject_id) DO NOTHING`
        )
        .bind(JSON.stringify(rows), item.output_id, ...values),
      accumulateInsertedCountStatement(db, item),
      requiredChangesAssertion(db, 1)
    );
  }
  statements.push(
    completeFanoutPageStatement(db, item, result),
    requiredChangesAssertion(db, 1),
    insertNextOutboxStatement(
      db,
      item.output_id,
      pageOutboxId(item),
      result.completed ? undefined : item.id
    ),
    requiredChangesAssertion(db, 1)
  );
  await guardedBatch(db, statements);
}

async function materializeVerificationFanout(
  db: D1Database,
  item: MaterializationItemRow
) {
  if (item.phase !== "discovery") {
    await commitVerificationPage(db, item, [], {
      completed: true,
      insertedCount: 0,
      nextPrimary: "",
      nextSecondary: "",
      processedCount: 0,
    });
    return;
  }
  const cursor = await readItemCursor(db, item.id, "cursor_primary");
  const context = await db
    .prepare(
      `SELECT sweep.country_code,sweep.country_name
         FROM country_sweep_outputs output
         JOIN country_sweeps sweep ON sweep.id=output.sweep_id
        WHERE output.id=?`
    )
    .bind(item.output_id)
    .first<{ country_code: string; country_name: string }>();
  if (!context) {
    throw new Error("Country sweep context is unavailable");
  }
  const page = await db
    .prepare(
      `SELECT organization.id organization_id,organization.identity_key,
              organization.name,organization.city,organization.region,
              organization.website_url,organization.canonical_domain,
              organization.market_segment,organization.status,
              organization.outreach_eligibility,organization.evidence_url
         FROM country_sweep_output_organizations provenance
         JOIN organizations organization
           ON organization.id=provenance.organization_id
        WHERE provenance.output_id=? AND organization.id>?
        ORDER BY organization.id LIMIT ?`
    )
    .bind(item.output_id, cursor, FANOUT_PAGE_SIZE)
    .all<{
      canonical_domain: string;
      city: string;
      evidence_url: string;
      identity_key: string;
      market_segment: string;
      name: string;
      organization_id: string;
      outreach_eligibility: string;
      region: string;
      status: string;
      website_url: string;
    }>();
  const rows = await Promise.all(
    page.results.map(async (row) => {
      const inputJson = JSON.stringify({
        countryCode: context.country_code,
        countryName: context.country_name,
        organization: {
          canonicalDomain: row.canonical_domain,
          city: row.city,
          evidenceUrl: row.evidence_url,
          identityKey: row.identity_key,
          marketSegment: row.market_segment,
          name: row.name,
          outreachEligibility: row.outreach_eligibility,
          region: row.region,
          status: row.status,
          websiteUrl: row.website_url,
        },
        phase: "verification",
      });
      return {
        ...row,
        inputHash: await sha256Hex(inputJson),
        inputJson,
        taskId: await stableId(
          "country-verification-task",
          item.sweep_id,
          row.identity_key
        ),
      };
    })
  );
  const last = rows.at(-1);
  await commitVerificationPage(db, item, rows, {
    completed: rows.length < FANOUT_PAGE_SIZE,
    insertedCount: 0,
    nextPrimary: last?.organization_id ?? "",
    nextSecondary: "",
    processedCount: rows.length,
  });
}

async function commitVerificationPage(
  db: D1Database,
  item: MaterializationItemRow,
  rows: Array<{
    identity_key: string;
    inputHash: string;
    inputJson: string;
    taskId: string;
  }>,
  result: FanoutPageResult
) {
  const guard = materializationGuardSql("output.id");
  const directGuard = directMaterializationGuardSql();
  const values = materializationGuardValues(item);
  const statements: D1PreparedStatement[] = [];
  if (rows.length > 0) {
    statements.push(
      db
        .prepare(
          `INSERT INTO country_sweep_tasks
            (id,sweep_id,phase,scope_key,status,input_json,input_hash,
             created_at,updated_at)
           SELECT json_extract(record.value,'$.taskId'),output.sweep_id,
                  'verification',json_extract(record.value,'$.identity_key'),
                  'queued',json_extract(record.value,'$.inputJson'),
                  json_extract(record.value,'$.inputHash'),
                  strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                  strftime('%Y-%m-%dT%H:%M:%fZ','now')
             FROM json_each(?) record
             JOIN country_sweep_outputs output ON output.id=?
            WHERE ${guard}
           ON CONFLICT(sweep_id,phase,scope_key) DO NOTHING`
        )
        .bind(JSON.stringify(rows), item.output_id, ...values),
      accumulateInsertedCountStatement(db, item),
      requiredChangesAssertion(db, 1)
    );
  }
  statements.push(
    db
      .prepare(
        `UPDATE country_sweeps
            SET task_total=(
                  SELECT COUNT(*) FROM country_sweep_tasks task
                   WHERE task.sweep_id=country_sweeps.id
                ),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=? AND status='running' AND ${directGuard}`
      )
      .bind(item.sweep_id, ...directMaterializationGuardValues(item)),
    requiredChangesAssertion(db, 1),
    completeFanoutPageStatement(db, item, result),
    requiredChangesAssertion(db, 1),
    insertNextOutboxStatement(
      db,
      item.output_id,
      pageOutboxId(item),
      result.completed ? undefined : item.id
    ),
    requiredChangesAssertion(db, 1)
  );
  await guardedBatch(db, statements);
}

async function finalizeMaterializedOutput(
  db: D1Database,
  item: MaterializationItemRow
) {
  const counts = await db
    .prepare(
      `SELECT output.organization_count,output.contact_count,output.scope_count,
              (SELECT COALESCE(SUM(processed_count),0)
                 FROM country_sweep_materialization_items counted
                WHERE counted.output_id=output.id
                  AND counted.kind='organizations_chunk') processed_organizations,
              (SELECT COALESCE(SUM(processed_count),0)
                 FROM country_sweep_materialization_items counted
                WHERE counted.output_id=output.id
                  AND counted.kind='contacts_chunk') processed_contacts,
              (SELECT COALESCE(SUM(processed_count),0)
                 FROM country_sweep_materialization_items counted
                WHERE counted.output_id=output.id
                  AND counted.kind='scopes_chunk') processed_scopes,
              (SELECT COUNT(*) FROM country_sweep_output_organizations p
                WHERE p.output_id=output.id) provenance_organizations,
              (SELECT COUNT(*) FROM country_sweep_output_contacts p
                WHERE p.output_id=output.id) provenance_contacts,
              (SELECT COUNT(*) FROM country_sweep_output_scopes p
                WHERE p.output_id=output.id) provenance_scopes,
              (SELECT COALESCE(SUM(inserted_count),0)
                 FROM country_sweep_materialization_items counted
                WHERE counted.output_id=output.id
                  AND counted.kind='scopes_chunk') inserted_scopes,
              (SELECT COUNT(*) FROM country_sweep_materialization_items sibling
                WHERE sibling.output_id=output.id AND sibling.id<>?
                  AND sibling.status<>'completed') unfinished
         FROM country_sweep_outputs output WHERE output.id=?`
    )
    .bind(item.id, item.output_id)
    .first<Record<string, number>>();
  if (
    counts?.unfinished !== 0 ||
    counts.processed_organizations !== counts.organization_count ||
    counts.processed_contacts !== counts.contact_count ||
    counts.processed_scopes !== counts.scope_count ||
    counts.provenance_organizations !== counts.organization_count ||
    counts.provenance_contacts !== counts.contact_count ||
    counts.provenance_scopes !== counts.scope_count
  ) {
    throw new Error("Country output materialization counts are incomplete");
  }
  const auditInput = JSON.stringify({
    countryCode: await readSweepValue(db, item.sweep_id, "country_code"),
    countryName: await readSweepValue(db, item.sweep_id, "country_name"),
    phase: "coverage_audit",
    progress: { completedTaskId: item.task_id },
  });
  const audit = {
    id: await stableId("country-coverage-task", item.sweep_id, item.task_id),
    inputHash: await sha256Hex(auditInput),
    inputJson: auditInput,
    scopeKey: `coverage:after:${item.task_id}`,
  };
  const terminalAudit =
    item.phase === "coverage_audit" && counts.inserted_scopes === 0;
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE country_sweep_outputs
            SET status='materialized',
                materialized_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=? AND status='materializing' AND ${materializationGuardSql(
            "country_sweep_outputs.id"
          )}`
      )
      .bind(item.output_id, ...materializationGuardValues(item)),
    requiredChangesAssertion(db, 1),
    db
      .prepare(
        `UPDATE country_sweep_tasks
            SET status='completed',error_code='',error_detail='',
                completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=? AND sweep_id=? AND status='materializing'
            AND accepted_output_id=?`
      )
      .bind(item.task_id, item.sweep_id, item.output_id),
    requiredChangesAssertion(db, 1),
  ];
  if (item.phase !== "coverage_audit") {
    statements.push(
      db
        .prepare(
          `INSERT INTO country_sweep_tasks
            (id,sweep_id,phase,scope_key,status,input_json,input_hash,
             created_at,updated_at)
           SELECT ?,?,'coverage_audit',?,'queued',?,?,
                  strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                  strftime('%Y-%m-%dT%H:%M:%fZ','now')
            WHERE NOT EXISTS (
              SELECT 1 FROM country_sweep_tasks active
               WHERE active.sweep_id=? AND active.id<>?
                 AND active.phase IN ('discovery','verification')
                 AND active.status IN ('queued','claimed','materializing')
            )
              AND NOT EXISTS (
                SELECT 1 FROM country_sweep_tasks audit
                 WHERE audit.sweep_id=? AND audit.phase='coverage_audit'
                   AND audit.status IN ('queued','claimed','materializing')
              )
           ON CONFLICT(sweep_id,phase,scope_key) DO NOTHING`
        )
        .bind(
          audit.id,
          item.sweep_id,
          audit.scopeKey,
          audit.inputJson,
          audit.inputHash,
          item.sweep_id,
          item.task_id,
          item.sweep_id
        )
    );
  }
  statements.push(
    db
      .prepare(
        `UPDATE country_sweeps
            SET status=CASE
                  WHEN ?=1 AND NOT EXISTS (
                    SELECT 1 FROM country_sweep_tasks active
                     WHERE active.sweep_id=country_sweeps.id
                       AND active.status IN ('queued','claimed','materializing')
                  ) THEN CASE WHEN EXISTS (
                    SELECT 1 FROM country_sweep_tasks failed
                     WHERE failed.sweep_id=country_sweeps.id
                       AND failed.status='failed'
                       AND failed.phase IN ('discovery','verification')
                  ) THEN 'completed_with_gaps' ELSE 'completed' END
                  ELSE 'running' END,
                task_total=(SELECT COUNT(*) FROM country_sweep_tasks counted
                  WHERE counted.sweep_id=country_sweeps.id),
                task_completed=(SELECT COUNT(*) FROM country_sweep_tasks counted
                  WHERE counted.sweep_id=country_sweeps.id
                    AND counted.status='completed'),
                task_failed=(SELECT COUNT(*) FROM country_sweep_tasks counted
                  WHERE counted.sweep_id=country_sweeps.id
                    AND counted.status='failed'),
                missing_scope_count=(SELECT COUNT(*)
                  FROM country_sweep_tasks counted
                  WHERE counted.sweep_id=country_sweeps.id
                    AND counted.status='failed'
                    AND counted.phase IN ('discovery','verification')),
                completed_at=CASE WHEN ?=1 AND NOT EXISTS (
                  SELECT 1 FROM country_sweep_tasks active
                   WHERE active.sweep_id=country_sweeps.id
                     AND active.status IN ('queued','claimed','materializing')
                ) THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END,
                updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=? AND status='running'`
      )
      .bind(terminalAudit ? 1 : 0, terminalAudit ? 1 : 0, item.sweep_id),
    requiredChangesAssertion(db, 1),
    completeFinalizerItemStatement(db, item),
    requiredChangesAssertion(db, 1)
  );
  await guardedBatch(db, statements);
}

async function recordMaterializationFailure(
  db: D1Database,
  item: MaterializationItemRow,
  error: unknown,
  mode: "expired" | "runtime" = "runtime"
) {
  const detail = error instanceof Error ? error.message : String(error);
  const retry = item.attempt_count < item.max_attempts;
  const auditInput = JSON.stringify({
    countryCode: item.country_code,
    countryName: await readSweepValue(db, item.sweep_id, "country_name"),
    phase: "coverage_audit",
    progress: { failedTaskId: item.task_id },
  });
  const audit = {
    id: await stableId("country-coverage-task", item.sweep_id, item.task_id),
    inputHash: await sha256Hex(auditInput),
    inputJson: auditInput,
    scopeKey: `coverage:after:${item.task_id}`,
  };
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE country_sweep_materialization_items
            SET status=?,lease_owner=NULL,lease_token=NULL,
                lease_expires_at=NULL,error_code='materialization_failed',
                error_detail=?,completed_at=CASE WHEN ?=1 THEN NULL ELSE
                  strftime('%Y-%m-%dT%H:%M:%fZ','now') END,
                updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=? AND output_id=? AND status='processing'
            AND attempt_count=? AND lease_token=?
            ${
              mode === "expired"
                ? "AND lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')"
                : ""
            }`
      )
      .bind(
        retry ? "queued" : "failed",
        detail.slice(0, 4000),
        retry ? 1 : 0,
        item.id,
        item.output_id,
        item.attempt_count,
        item.lease_token
      ),
    requiredChangesAssertion(db, 1),
  ];
  if (retry) {
    statements.push(
      insertNextOutboxStatement(
        db,
        item.output_id,
        mode === "expired" ? expiredLeaseOutboxId(item) : pageOutboxId(item),
        item.id
      ),
      requiredChangesAssertion(db, 1)
    );
  } else {
    statements.push(
      db
        .prepare(
          `UPDATE country_sweep_outputs
              SET status='failed',error_code='materialization_failed',
                  error_detail=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
            WHERE id=? AND status IN ('accepted','materializing')`
        )
        .bind(detail.slice(0, 4000), item.output_id),
      requiredChangesAssertion(db, 1)
    );
    statements.push(
      db
        .prepare(
          `UPDATE country_sweep_tasks
              SET status='failed',error_code='materialization_failed',
                  error_detail=?,completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
            WHERE id=? AND sweep_id=? AND status='materializing'
              AND accepted_output_id=?`
        )
        .bind(
          detail.slice(0, 4000),
          item.task_id,
          item.sweep_id,
          item.output_id
        ),
      requiredChangesAssertion(db, 1)
    );
    if (item.phase !== "coverage_audit") {
      statements.push(
        db
          .prepare(
            `INSERT INTO country_sweep_tasks
              (id,sweep_id,phase,scope_key,status,input_json,input_hash,
               created_at,updated_at)
             SELECT ?,?,'coverage_audit',?,'queued',?,?,
                    strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                    strftime('%Y-%m-%dT%H:%M:%fZ','now')
              WHERE NOT EXISTS (
                SELECT 1 FROM country_sweep_tasks active
                 WHERE active.sweep_id=?
                   AND active.phase IN ('discovery','verification')
                   AND active.status IN ('queued','claimed','materializing')
              )
                AND NOT EXISTS (
                  SELECT 1 FROM country_sweep_tasks active_audit
                   WHERE active_audit.sweep_id=?
                     AND active_audit.phase='coverage_audit'
                     AND active_audit.status IN (
                       'queued','claimed','materializing'
                     )
                )
             ON CONFLICT(sweep_id,phase,scope_key) DO NOTHING`
          )
          .bind(
            audit.id,
            item.sweep_id,
            audit.scopeKey,
            audit.inputJson,
            audit.inputHash,
            item.sweep_id,
            item.sweep_id
          )
      );
    }
    statements.push(
      db
        .prepare(
          `UPDATE country_sweeps
              SET status=CASE WHEN ?='coverage_audit' THEN 'failed'
                    ELSE 'running' END,
                  task_total=(SELECT COUNT(*) FROM country_sweep_tasks counted
                    WHERE counted.sweep_id=country_sweeps.id),
                  task_completed=(SELECT COUNT(*) FROM country_sweep_tasks counted
                    WHERE counted.sweep_id=country_sweeps.id
                      AND counted.status='completed'),
                  task_failed=(SELECT COUNT(*) FROM country_sweep_tasks counted
                    WHERE counted.sweep_id=country_sweeps.id
                      AND counted.status='failed'),
                  missing_scope_count=(SELECT COUNT(*)
                    FROM country_sweep_tasks counted
                    WHERE counted.sweep_id=country_sweeps.id
                      AND counted.status='failed'
                      AND counted.phase IN ('discovery','verification')),
                  error_detail=CASE WHEN ?='coverage_audit' THEN ?
                    ELSE error_detail END,
                  completed_at=CASE WHEN ?='coverage_audit' THEN
                    strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END,
                  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
            WHERE id=? AND status='running'`
        )
        .bind(
          item.phase,
          item.phase,
          detail.slice(0, 4000),
          item.phase,
          item.sweep_id
        ),
      requiredChangesAssertion(db, 1)
    );
  }
  await guardedBatch(db, statements);
}

function completeChunkItemStatement(
  db: D1Database,
  item: MaterializationItemRow,
  count: number
) {
  return db
    .prepare(
      `UPDATE country_sweep_materialization_items
          SET status='completed',processed_count=?,
              lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,
              completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND output_id=? AND status='processing'
          AND attempt_count=? AND lease_token=? AND expected_count=?`
    )
    .bind(
      count,
      item.id,
      item.output_id,
      item.attempt_count,
      item.lease_token,
      item.expected_count
    );
}

function captureInsertedCountStatement(
  db: D1Database,
  item: MaterializationItemRow
) {
  return db
    .prepare(
      `UPDATE country_sweep_materialization_items
          SET inserted_count=changes(),
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND output_id=? AND status='processing'
          AND attempt_count=? AND lease_token=?
          AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
          AND EXISTS (
            SELECT 1 FROM country_sweep_outputs output
             WHERE output.id=country_sweep_materialization_items.output_id
               AND output.status='materializing'
          )`
    )
    .bind(item.id, item.output_id, item.attempt_count, item.lease_token);
}

function accumulateInsertedCountStatement(
  db: D1Database,
  item: MaterializationItemRow
) {
  return db
    .prepare(
      `UPDATE country_sweep_materialization_items
          SET inserted_count=inserted_count+changes(),
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND output_id=? AND status='processing'
          AND attempt_count=? AND lease_token=?
          AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
          AND EXISTS (
            SELECT 1 FROM country_sweep_outputs output
             WHERE output.id=country_sweep_materialization_items.output_id
               AND output.status='materializing'
          )`
    )
    .bind(item.id, item.output_id, item.attempt_count, item.lease_token);
}

function completeFanoutPageStatement(
  db: D1Database,
  item: MaterializationItemRow,
  result: FanoutPageResult
) {
  return db
    .prepare(
      `UPDATE country_sweep_materialization_items
          SET status=?,cursor_primary=CASE WHEN ?<>'' THEN ? ELSE cursor_primary END,
              cursor_secondary=CASE WHEN ?<>'' THEN ? ELSE cursor_secondary END,
              processed_count=processed_count+?,inserted_count=inserted_count+?,
              lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,
              completed_at=CASE WHEN ?=1 THEN
                strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END,
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND output_id=? AND status='processing'
          AND attempt_count=? AND lease_token=?`
    )
    .bind(
      result.completed ? "completed" : "queued",
      result.nextPrimary,
      result.nextPrimary,
      result.nextSecondary,
      result.nextSecondary,
      result.processedCount,
      result.insertedCount,
      result.completed ? 1 : 0,
      item.id,
      item.output_id,
      item.attempt_count,
      item.lease_token
    );
}

function completeFinalizerItemStatement(
  db: D1Database,
  item: MaterializationItemRow
) {
  return db
    .prepare(
      `UPDATE country_sweep_materialization_items
          SET status='completed',processed_count=expected_count,
              lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,
              completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND output_id=? AND status='processing'
          AND attempt_count=? AND lease_token=?`
    )
    .bind(item.id, item.output_id, item.attempt_count, item.lease_token);
}

function insertNextOutboxStatement(
  db: D1Database,
  outputId: string,
  outboxId: string,
  workItemId?: string
) {
  return db
    .prepare(
      `INSERT INTO work_outbox
        (id,topic,aggregate_id,work_item_id,available_at,created_at)
       SELECT ?,?,?,next.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              strftime('%Y-%m-%dT%H:%M:%fZ','now')
         FROM country_sweep_materialization_items next
        WHERE next.output_id=? AND next.status='queued'
          AND (? IS NULL OR next.id=?)
          AND ${materializationStagePrerequisitesSql("next")}
        ORDER BY next.sequence,next.id LIMIT 1`
    )
    .bind(
      outboxId,
      MATERIALIZATION_TOPIC,
      outputId,
      outputId,
      workItemId ?? null,
      workItemId ?? null
    );
}

function materializationStagePrerequisitesSql(itemExpression: string) {
  const itemRank = materializationStageRankSql(`${itemExpression}.kind`);
  const predecessorRank = materializationStageRankSql("predecessor.kind");
  return `NOT EXISTS (
    SELECT 1 FROM country_sweep_materialization_items predecessor
     WHERE predecessor.output_id=${itemExpression}.output_id
       AND predecessor.id<>${itemExpression}.id
       AND predecessor.status<>'completed'
       AND (
         ${predecessorRank}<${itemRank}
         OR (
           ${predecessorRank}=${itemRank}
           AND predecessor.sequence<${itemExpression}.sequence
         )
       )
  )`;
}

function materializationStageRankSql(kindExpression: string) {
  return `CASE ${kindExpression}
    WHEN 'organizations_chunk' THEN 0
    WHEN 'contacts_chunk' THEN 1
    WHEN 'phase_finalize' THEN 3
    ELSE 2 END`;
}

function materializationGuardSql(outputExpression: string) {
  return `EXISTS (
    SELECT 1 FROM country_sweep_materialization_items active_item
     WHERE active_item.id=? AND active_item.output_id=${outputExpression}
       AND active_item.status='processing' AND active_item.attempt_count=?
       AND active_item.lease_token=?
       AND active_item.lease_expires_at>
           strftime('%Y-%m-%dT%H:%M:%fZ','now')
       AND EXISTS (
         SELECT 1 FROM country_sweep_outputs active_output
          WHERE active_output.id=active_item.output_id
            AND active_output.status='materializing'
       )
  )`;
}

function materializationGuardValues(item: MaterializationItemRow) {
  return [item.id, item.attempt_count, item.lease_token] as const;
}

function directMaterializationGuardSql() {
  return `EXISTS (
    SELECT 1 FROM country_sweep_materialization_items active_item
     JOIN country_sweep_outputs active_output
       ON active_output.id=active_item.output_id
      AND active_output.status='materializing'
    WHERE active_item.id=? AND active_item.output_id=?
      AND active_item.status='processing' AND active_item.attempt_count=?
      AND active_item.lease_token=?
      AND active_item.lease_expires_at>
          strftime('%Y-%m-%dT%H:%M:%fZ','now')
  )`;
}

function directMaterializationGuardValues(item: MaterializationItemRow) {
  return [
    item.id,
    item.output_id,
    item.attempt_count,
    item.lease_token,
  ] as const;
}

function nextOutboxId(item: MaterializationItemRow) {
  return `country-materialization:${item.output_id}:after:${item.id}:${item.attempt_count.toString()}`;
}

function pageOutboxId(item: MaterializationItemRow) {
  return `country-materialization:${item.output_id}:page:${item.id}:${item.attempt_count.toString()}`;
}

function expiredLeaseOutboxId(item: MaterializationItemRow) {
  return `country-materialization:${item.output_id}:expired:${item.id}:${item.attempt_count.toString()}`;
}

function isMaterializationRace(error: unknown) {
  return (
    error instanceof Error &&
    (error.message === "Country materialization lease changed" ||
      isConstraintError(error.cause))
  );
}

async function readItemCursor(
  db: D1Database,
  itemId: string,
  column: "cursor_primary" | "cursor_secondary"
) {
  return (
    (await db
      .prepare(
        `SELECT ${column} value FROM country_sweep_materialization_items WHERE id=?`
      )
      .bind(itemId)
      .first<string>("value")) ?? ""
  );
}

async function readSweepValue(
  db: D1Database,
  sweepId: string,
  column: "country_code" | "country_name"
) {
  return (
    (await db
      .prepare(`SELECT ${column} value FROM country_sweeps WHERE id=?`)
      .bind(sweepId)
      .first<string>("value")) ?? ""
  );
}

async function stableId(namespace: string, ...parts: string[]) {
  return `${namespace}:${await sha256Hex(parts.join("\u001f"))}`;
}

function requiredChangesAssertion(db: D1Database, expectedChanges: number) {
  return db
    .prepare(
      `INSERT INTO transaction_assertions(must_equal_one)
       SELECT 0 WHERE changes()<>?`
    )
    .bind(expectedChanges);
}

async function guardedBatch(db: D1Database, statements: D1PreparedStatement[]) {
  try {
    await db.batch(statements);
  } catch (error) {
    if (isConstraintError(error)) {
      const conflict = new Error("Country materialization lease changed");
      conflict.cause = error;
      throw conflict;
    }
    throw error;
  }
}

export { FANOUT_PAGE_SIZE, MATERIALIZATION_LEASE_MINUTES };
