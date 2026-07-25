import { sha256Hex } from "../../../../src/features/countries/materialization";
import {
  FANOUT_PAGE_SIZE,
  type FanoutPageResult,
  type MaterializationItemRow,
} from "./model";
import {
  accumulateInsertedCountStatement,
  completeFanoutPageStatement,
  directMaterializationGuardSql,
  directMaterializationGuardValues,
  guardedBatch,
  insertNextOutboxStatement,
  materializationGuardSql,
  materializationGuardValues,
  pageOutboxId,
  readItemCursor,
  requiredChangesAssertion,
  stableId,
} from "./statements";

export async function materializeCampaignFanout(
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

export async function materializeVerificationFanout(
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
