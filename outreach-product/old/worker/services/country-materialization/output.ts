import {
  CountrySweepCanonicalChunkSchema,
  canonicalCountrySweepChunkJson,
  MAX_CANONICAL_CHUNK_BYTES,
  MAX_RECORDS_PER_CHUNK,
  sha256Hex,
} from "../../../src/features/countries/materialization";
import type { AppEnv } from "../../env";
import { AgentTaskError } from "../agent-tasks/contracts";
import type { CountryTaskLeaseContext } from "../agent-tasks/country-sweep-leases";
import { isConstraintError } from "../agent-tasks/run-store";
import type { CountrySweepChunkUploadInput } from "./output/model";
import {
  assertNextChunkKind,
  countColumnForKind,
  countrySweepChunkObjectKey,
  manifestAfterChunk,
  manifestFromRow,
  readUploadingOutput,
  requiredChangesAssertion,
  stableId,
} from "./output/support";

// biome-ignore lint/performance/noBarrelFile: This behavior-owning module preserves its stable public API after internal decomposition.
export { acceptCountrySweepOutput } from "./output/accept";
export type { CountrySweepChunkUploadInput } from "./output/model";
export { MATERIALIZATION_TOPIC } from "./output/model";

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
