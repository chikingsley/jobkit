import {
  type CountrySweepCanonicalChunk,
  sha256Hex,
} from "../../../../src/features/countries/materialization";
import type { MaterializationItemRow } from "./model";
import {
  captureInsertedCountStatement,
  completeChunkItemStatement,
  directMaterializationGuardSql,
  directMaterializationGuardValues,
  guardedBatch,
  insertNextOutboxStatement,
  materializationGuardSql,
  materializationGuardValues,
  nextOutboxId,
  requiredChangesAssertion,
  stableId,
} from "./statements";

export async function materializeOrganizations(
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

export async function materializeContacts(
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

export async function materializeScopes(
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
