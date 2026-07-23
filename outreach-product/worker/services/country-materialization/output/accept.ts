import type { z } from "zod";
import {
  type CountrySweepChunkKind,
  type CountrySweepOutputFinalizeSchema,
  sha256Hex,
} from "../../../../src/features/countries/materialization";
import type { AppEnv } from "../../../env";
import { AgentTaskError } from "../../agent-tasks/contracts";
import type { CountryTaskLeaseContext } from "../../agent-tasks/country-sweep-leases";
import { isConstraintError } from "../../agent-tasks/run-store";
import { MATERIALIZATION_TOPIC } from "./model";
import {
  chunkKindsAreInMaterializationOrder,
  manifestMatchesRow,
  materializationItemId,
  readUploadingOutput,
  requiredChangesAssertion,
} from "./support";

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
