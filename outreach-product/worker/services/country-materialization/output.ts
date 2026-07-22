import type { z } from "zod";
import {
  CountrySweepCanonicalChunkSchema,
  type CountrySweepChunkKind,
  type CountrySweepManifestSnapshot,
  type CountrySweepOutputFinalizeSchema,
  canonicalCountrySweepChunkJson,
  MAX_CANONICAL_CHUNK_BYTES,
  MAX_RECORDS_PER_CHUNK,
  sha256Hex,
} from "../../../src/features/countries/materialization";
import type { AppEnv } from "../../env";
import { AgentTaskError } from "../agent-tasks/contracts";
import type { CountryTaskLeaseContext } from "../agent-tasks/country-sweep-leases";
import { isConstraintError } from "../agent-tasks/run-store";

const MATERIALIZATION_TOPIC = "country_sweep_materialization";

interface UploadingOutputRow {
  chunk_count: number;
  contact_count: number;
  last_chunk_kind: CountrySweepChunkKind | null;
  next_chunk_ordinal: number;
  organization_count: number;
  output_id: string;
  rolling_sha256: string;
  scope_count: number;
  total_bytes: number;
}

export interface CountrySweepChunkUploadInput {
  byteLength: number;
  chunk: z.infer<typeof CountrySweepCanonicalChunkSchema>;
  ordinal: number;
  recordCount: number;
  sha256: string;
}

export async function uploadCountrySweepOutputChunk(
  env: AppEnv,
  context: CountryTaskLeaseContext,
  input: CountrySweepChunkUploadInput
) {
  const chunk = CountrySweepCanonicalChunkSchema.parse(input.chunk);
  const canonicalJson = canonicalCountrySweepChunkJson(chunk);
  const bytes = new TextEncoder().encode(canonicalJson);
  if (bytes.byteLength > MAX_CANONICAL_CHUNK_BYTES) {
    throw new AgentTaskError(
      "Country output chunk exceeds 1,000,000 bytes",
      413
    );
  }
  if (chunk.records.length > MAX_RECORDS_PER_CHUNK) {
    throw new AgentTaskError("Country output chunk exceeds 1,000 records", 413);
  }
  if (
    input.byteLength !== bytes.byteLength ||
    input.recordCount !== chunk.records.length
  ) {
    throw new AgentTaskError("Country output chunk counts changed", 422);
  }
  const chunkSha256 = await sha256Hex(bytes);
  if (chunkSha256 !== input.sha256) {
    throw new AgentTaskError("Country output chunk hash changed", 422);
  }
  const active = await readUploadingOutput(env.DB, context);
  if (!active) {
    throw new AgentTaskError(
      "Country output chunk ordinal is unavailable",
      409
    );
  }
  if (input.ordinal < active.next_chunk_ordinal) {
    const existing = await env.DB.prepare(
      `SELECT id,object_key FROM country_sweep_output_chunks
        WHERE output_id=? AND ordinal=? AND kind=? AND sha256=?
          AND byte_length=? AND record_count=?`
    )
      .bind(
        context.outputId,
        input.ordinal,
        chunk.kind,
        chunkSha256,
        bytes.byteLength,
        chunk.records.length
      )
      .first<{ id: string; object_key: string }>();
    if (!existing) {
      throw new AgentTaskError("Country output chunk replay changed", 409);
    }
    return {
      chunkId: existing.id,
      manifest: manifestFromRow(active),
      objectKey: existing.object_key,
    };
  }
  if (active.next_chunk_ordinal !== input.ordinal) {
    throw new AgentTaskError(
      "Country output chunk ordinal is unavailable",
      409
    );
  }
  assertNextChunkKind(active, chunk.kind);
  const objectKey = countrySweepChunkObjectKey(
    context.outputId,
    input.ordinal,
    chunkSha256
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  await env.SWEEP_OUTPUTS.put(objectKey, bytes, {
    customMetadata: {
      outputId: context.outputId,
      sha256: chunkSha256,
    },
    httpMetadata: { contentType: "application/json" },
    sha256: digest,
  });
  const rollingSha256 = await sha256Hex(
    [
      active.rolling_sha256,
      input.ordinal.toString(),
      chunk.kind,
      chunkSha256,
      bytes.byteLength.toString(),
      chunk.records.length.toString(),
    ].join(":")
  );
  const chunkId = await stableId(
    "country-output-chunk",
    context.outputId,
    input.ordinal.toString(),
    chunkSha256
  );
  const countColumn = countColumnForKind(chunk.kind);
  const statements = [
    env.DB.prepare(
      `INSERT INTO country_sweep_output_chunks
        (id,output_id,ordinal,kind,object_key,sha256,byte_length,record_count,
         created_at)
       SELECT ?,output.id,?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')
         FROM country_sweep_outputs output
         JOIN country_sweep_tasks task
           ON task.id=output.task_id AND task.sweep_id=output.sweep_id
         JOIN country_sweeps sweep ON sweep.id=task.sweep_id
         JOIN agent_task_runs run ON run.id=output.agent_run_id
         JOIN agent_runners runner
           ON runner.id=task.worker_id
          AND runner.user_id=sweep.requested_by_user_id
          AND runner.revoked_at IS NULL
        WHERE output.id=? AND output.status='uploading'
          AND output.agent_run_id=? AND output.attempt_number=?
          AND output.next_chunk_ordinal=? AND output.rolling_sha256=?
          AND task.id=? AND task.status='claimed' AND task.worker_id=?
          AND task.attempt_count=? AND task.lease_token=? AND task.input_hash=?
          AND task.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
          AND run.user_id=? AND run.runner_id=? AND run.task_type=?
          AND run.source_task_id=task.id AND run.attempt_number=?
          AND run.lease_token=? AND run.source_hash=? AND run.status='running'
          AND run.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')`
    ).bind(
      chunkId,
      input.ordinal,
      chunk.kind,
      objectKey,
      chunkSha256,
      bytes.byteLength,
      chunk.records.length,
      context.outputId,
      context.runId,
      context.attemptNumber,
      input.ordinal,
      active.rolling_sha256,
      context.taskId,
      context.runnerId,
      context.attemptNumber,
      context.leaseToken,
      context.sourceHash,
      context.userId,
      context.runnerId,
      context.taskType,
      context.attemptNumber,
      context.leaseToken,
      context.sourceHash
    ),
    requiredChangesAssertion(env.DB, 1),
    env.DB.prepare(
      `UPDATE country_sweep_outputs
          SET next_chunk_ordinal=next_chunk_ordinal+1,
              rolling_sha256=?,chunk_count=chunk_count+1,
              total_bytes=total_bytes+?,${countColumn}=${countColumn}+?,
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND status='uploading' AND next_chunk_ordinal=?
          AND rolling_sha256=?
          AND EXISTS (
            SELECT 1 FROM country_sweep_output_chunks chunk
             WHERE chunk.id=? AND chunk.output_id=country_sweep_outputs.id
          )`
    ).bind(
      rollingSha256,
      bytes.byteLength,
      chunk.records.length,
      context.outputId,
      input.ordinal,
      active.rolling_sha256,
      chunkId
    ),
    requiredChangesAssertion(env.DB, 1),
  ];
  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (isConstraintError(error)) {
      const conflict = new AgentTaskError(
        "Country output lease changed after chunk upload",
        409
      );
      conflict.cause = error;
      throw conflict;
    }
    throw error;
  }
  return {
    chunkId,
    manifest: manifestAfterChunk(
      active,
      chunk.kind,
      bytes.byteLength,
      chunk.records.length,
      rollingSha256
    ),
    objectKey,
  };
}

export async function acceptCountrySweepOutput(
  env: AppEnv,
  context: CountryTaskLeaseContext,
  acceptance: z.infer<typeof CountrySweepOutputFinalizeSchema>
) {
  const active = await readUploadingOutput(env.DB, context);
  if (!(active && manifestMatchesRow(acceptance.manifest, active))) {
    throw new AgentTaskError(
      "Country output manifest changed before acceptance",
      409
    );
  }
  const chunks = await env.DB.prepare(
    `SELECT id,ordinal,kind,sha256,byte_length,record_count
       FROM country_sweep_output_chunks
      WHERE output_id=? ORDER BY ordinal`
  )
    .bind(context.outputId)
    .all<{
      byte_length: number;
      id: string;
      kind: CountrySweepChunkKind;
      ordinal: number;
      record_count: number;
      sha256: string;
    }>();
  if (
    chunks.results.length !== active.chunk_count ||
    chunks.results.some((chunk, index) => chunk.ordinal !== index) ||
    !chunkKindsAreInMaterializationOrder(chunks.results.map(({ kind }) => kind))
  ) {
    throw new AgentTaskError(
      "Country output chunk manifest is incomplete",
      409
    );
  }
  const coverageSummaryJson = JSON.stringify(acceptance.coverageSummary);
  const manifestSha256 = await sha256Hex(
    JSON.stringify({
      chunks: chunks.results,
      counts: acceptance.manifest,
      coverageSummary: acceptance.coverageSummary,
      notes: acceptance.notes,
      outputId: context.outputId,
      schemaVersion: 1,
    })
  );
  const items: Array<{
    chunkId: string | null;
    expectedCount: number;
    id: string;
    kind: string;
    sequence: number;
  }> = chunks.results.map((chunk) => ({
    chunkId: chunk.id,
    expectedCount: chunk.record_count,
    id: materializationItemId(
      context.outputId,
      chunk.ordinal,
      `${chunk.kind}_chunk`
    ),
    kind: `${chunk.kind}_chunk`,
    sequence: chunk.ordinal,
  }));
  const nextSequence = chunks.results.length;
  items.push(
    {
      chunkId: null,
      expectedCount: 0,
      id: materializationItemId(
        context.outputId,
        nextSequence,
        "campaign_fanout"
      ),
      kind: "campaign_fanout",
      sequence: nextSequence,
    },
    {
      chunkId: null,
      expectedCount: 0,
      id: materializationItemId(
        context.outputId,
        nextSequence + 1,
        "verification_fanout"
      ),
      kind: "verification_fanout",
      sequence: nextSequence + 1,
    },
    {
      chunkId: null,
      expectedCount: 0,
      id: materializationItemId(
        context.outputId,
        nextSequence + 2,
        "phase_finalize"
      ),
      kind: "phase_finalize",
      sequence: nextSequence + 2,
    }
  );
  const resultJson = JSON.stringify({
    chunkCount: active.chunk_count,
    contactCount: active.contact_count,
    manifestSha256,
    organizationCount: active.organization_count,
    outputId: context.outputId,
    scopeCount: active.scope_count,
    totalBytes: active.total_bytes,
  });
  const outboxId = `country-materialization:${context.outputId}:accepted`;
  const firstWorkItemId = items[0]?.id;
  if (!firstWorkItemId) {
    throw new AgentTaskError("Country output has no materialization work", 409);
  }
  const statements = [
    env.DB.prepare(
      `UPDATE country_sweep_outputs
          SET status='accepted',manifest_sha256=?,coverage_summary_json=?,
              accepted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND status='uploading' AND agent_run_id=?
          AND attempt_number=? AND chunk_count=? AND total_bytes=?
          AND organization_count=? AND contact_count=? AND scope_count=?
          AND rolling_sha256=?
          AND EXISTS (
            SELECT 1 FROM country_sweep_tasks task
            JOIN country_sweeps sweep ON sweep.id=task.sweep_id
            JOIN agent_task_runs run ON run.id=country_sweep_outputs.agent_run_id
            JOIN agent_runners runner
              ON runner.id=task.worker_id
             AND runner.user_id=sweep.requested_by_user_id
             AND runner.revoked_at IS NULL
           WHERE task.id=country_sweep_outputs.task_id
             AND task.sweep_id=country_sweep_outputs.sweep_id
             AND sweep.requested_by_user_id=? AND task.status='claimed'
             AND task.worker_id=? AND task.attempt_count=?
             AND task.lease_token=? AND task.input_hash=?
             AND task.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
             AND run.user_id=? AND run.runner_id=? AND run.task_type=?
             AND run.source_task_id=task.id
             AND run.attempt_number=task.attempt_count
             AND run.lease_token=task.lease_token
             AND run.source_hash=task.input_hash AND run.status='running'
             AND run.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
          )`
    ).bind(
      manifestSha256,
      coverageSummaryJson,
      context.outputId,
      context.runId,
      context.attemptNumber,
      active.chunk_count,
      active.total_bytes,
      active.organization_count,
      active.contact_count,
      active.scope_count,
      active.rolling_sha256,
      context.userId,
      context.runnerId,
      context.attemptNumber,
      context.leaseToken,
      context.sourceHash,
      context.userId,
      context.runnerId,
      context.taskType
    ),
    requiredChangesAssertion(env.DB, 1),
    env.DB.prepare(
      `UPDATE country_sweep_tasks
          SET status='materializing',accepted_output_id=?,output_json=?,
              worker_id=NULL,claimed_at=NULL,lease_token=NULL,
              lease_expires_at=NULL,error_code='',error_detail='',
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND sweep_id=? AND status='claimed' AND worker_id=?
          AND attempt_count=? AND lease_token=? AND input_hash=?
          AND EXISTS (
            SELECT 1 FROM country_sweep_outputs output
             WHERE output.id=? AND output.task_id=country_sweep_tasks.id
               AND output.status='accepted' AND output.manifest_sha256=?
          )`
    ).bind(
      context.outputId,
      resultJson,
      context.taskId,
      context.sweepId,
      context.runnerId,
      context.attemptNumber,
      context.leaseToken,
      context.sourceHash,
      context.outputId,
      manifestSha256
    ),
    requiredChangesAssertion(env.DB, 1),
    env.DB.prepare(
      `UPDATE agent_task_runs
          SET status='completed',result_json=?,error_code='',error_detail='',
              completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND user_id=? AND runner_id=? AND task_type=?
          AND source_task_id=? AND attempt_number=? AND lease_token=?
          AND source_hash=? AND status='running'
          AND EXISTS (
            SELECT 1 FROM country_sweep_tasks task
             WHERE task.id=agent_task_runs.source_task_id
               AND task.sweep_id=? AND task.status='materializing'
               AND task.accepted_output_id=?
          )`
    ).bind(
      resultJson,
      context.runId,
      context.userId,
      context.runnerId,
      context.taskType,
      context.taskId,
      context.attemptNumber,
      context.leaseToken,
      context.sourceHash,
      context.sweepId,
      context.outputId
    ),
    requiredChangesAssertion(env.DB, 1),
    env.DB.prepare(
      `INSERT INTO country_sweep_materialization_items
        (id,output_id,kind,chunk_id,sequence,status,expected_count,
         created_at,updated_at)
       SELECT json_extract(item.value,'$.id'),?,
              json_extract(item.value,'$.kind'),
              json_extract(item.value,'$.chunkId'),
              json_extract(item.value,'$.sequence'),'queued',
              json_extract(item.value,'$.expectedCount'),
              strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              strftime('%Y-%m-%dT%H:%M:%fZ','now')
         FROM json_each(?) item
        WHERE EXISTS (
          SELECT 1 FROM country_sweep_outputs output
           WHERE output.id=? AND output.status='accepted'
        )`
    ).bind(context.outputId, JSON.stringify(items), context.outputId),
    requiredChangesAssertion(env.DB, items.length),
    env.DB.prepare(
      `INSERT INTO work_outbox
        (id,topic,aggregate_id,work_item_id,available_at,created_at)
       SELECT ?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE EXISTS (
          SELECT 1 FROM country_sweep_outputs output
           WHERE output.id=? AND output.status='accepted'
        )`
    ).bind(
      outboxId,
      MATERIALIZATION_TOPIC,
      context.outputId,
      firstWorkItemId,
      context.outputId
    ),
    requiredChangesAssertion(env.DB, 1),
  ];
  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (isConstraintError(error)) {
      const conflict = new AgentTaskError(
        "Country output lease changed before acceptance",
        409
      );
      conflict.cause = error;
      throw conflict;
    }
    throw error;
  }
  return {
    manifestSha256,
    outputId: context.outputId,
    status: "accepted" as const,
  };
}

function readUploadingOutput(db: D1Database, context: CountryTaskLeaseContext) {
  return db
    .prepare(
      `SELECT output.id output_id,output.next_chunk_ordinal,
              output.rolling_sha256,output.chunk_count,output.total_bytes,
              output.organization_count,output.contact_count,output.scope_count,
              (SELECT chunk.kind FROM country_sweep_output_chunks chunk
                WHERE chunk.output_id=output.id
                ORDER BY chunk.ordinal DESC LIMIT 1) last_chunk_kind
         FROM country_sweep_outputs output
         JOIN country_sweep_tasks task
           ON task.id=output.task_id AND task.sweep_id=output.sweep_id
         JOIN country_sweeps sweep ON sweep.id=task.sweep_id
         JOIN agent_task_runs run ON run.id=output.agent_run_id
         JOIN agent_runners runner
           ON runner.id=task.worker_id
          AND runner.user_id=sweep.requested_by_user_id
          AND runner.revoked_at IS NULL
        WHERE output.id=? AND output.status='uploading'
          AND output.agent_run_id=? AND output.attempt_number=?
          AND task.id=? AND task.status='claimed' AND task.worker_id=?
          AND task.attempt_count=? AND task.lease_token=? AND task.input_hash=?
          AND task.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
          AND sweep.requested_by_user_id=?
          AND run.user_id=? AND run.runner_id=? AND run.task_type=?
          AND run.source_task_id=task.id AND run.attempt_number=?
          AND run.lease_token=? AND run.source_hash=? AND run.status='running'
          AND run.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')`
    )
    .bind(
      context.outputId,
      context.runId,
      context.attemptNumber,
      context.taskId,
      context.runnerId,
      context.attemptNumber,
      context.leaseToken,
      context.sourceHash,
      context.userId,
      context.userId,
      context.runnerId,
      context.taskType,
      context.attemptNumber,
      context.leaseToken,
      context.sourceHash
    )
    .first<UploadingOutputRow>();
}

function manifestAfterChunk(
  active: UploadingOutputRow,
  kind: CountrySweepChunkKind,
  byteLength: number,
  recordCount: number,
  rollingSha256: string
): CountrySweepManifestSnapshot {
  return {
    chunkCount: active.chunk_count + 1,
    contactCount:
      active.contact_count + (kind === "contacts" ? recordCount : 0),
    organizationCount:
      active.organization_count + (kind === "organizations" ? recordCount : 0),
    rollingSha256,
    scopeCount: active.scope_count + (kind === "scopes" ? recordCount : 0),
    totalBytes: active.total_bytes + byteLength,
  };
}

function manifestFromRow(
  row: UploadingOutputRow
): CountrySweepManifestSnapshot {
  return {
    chunkCount: row.chunk_count,
    contactCount: row.contact_count,
    organizationCount: row.organization_count,
    rollingSha256: row.rolling_sha256,
    scopeCount: row.scope_count,
    totalBytes: row.total_bytes,
  };
}

function manifestMatchesRow(
  manifest: CountrySweepManifestSnapshot,
  row: UploadingOutputRow
) {
  return (
    manifest.chunkCount === row.chunk_count &&
    manifest.contactCount === row.contact_count &&
    manifest.organizationCount === row.organization_count &&
    manifest.rollingSha256 === row.rolling_sha256 &&
    manifest.scopeCount === row.scope_count &&
    manifest.totalBytes === row.total_bytes
  );
}

function countColumnForKind(kind: CountrySweepChunkKind) {
  if (kind === "organizations") {
    return "organization_count";
  }
  if (kind === "contacts") {
    return "contact_count";
  }
  return "scope_count";
}

function assertNextChunkKind(
  active: UploadingOutputRow,
  kind: CountrySweepChunkKind
) {
  if (
    active.last_chunk_kind &&
    chunkKindRank(kind) < chunkKindRank(active.last_chunk_kind)
  ) {
    throw new AgentTaskError(
      "Country output chunk kinds must be uploaded in organization, contact, then scope order",
      409
    );
  }
  if (kind === "contacts" && active.organization_count === 0) {
    throw new AgentTaskError(
      "Country output contacts require an earlier organization chunk",
      409
    );
  }
}

function chunkKindsAreInMaterializationOrder(kinds: CountrySweepChunkKind[]) {
  let previousRank = -1;
  for (const kind of kinds) {
    const rank = chunkKindRank(kind);
    if (rank < previousRank) {
      return false;
    }
    previousRank = rank;
  }
  return true;
}

function chunkKindRank(kind: CountrySweepChunkKind) {
  if (kind === "organizations") {
    return 0;
  }
  if (kind === "contacts") {
    return 1;
  }
  return 2;
}

function countrySweepChunkObjectKey(
  outputId: string,
  ordinal: number,
  sha256: string
) {
  return `country-sweeps/${outputId}/${ordinal.toString().padStart(6, "0")}-${sha256}.json`;
}

function materializationItemId(
  outputId: string,
  sequence: number,
  kind: string
) {
  return `country-materialization:${outputId}:${sequence.toString()}:${kind}`;
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

export { MATERIALIZATION_TOPIC };
