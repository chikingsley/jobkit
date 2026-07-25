import {
  type CountrySweepChunkKind,
  type CountrySweepManifestSnapshot,
  sha256Hex,
} from "../../../../src/features/countries/materialization";
import { AgentTaskError } from "../../agent-tasks/contracts";
import type { CountryTaskLeaseContext } from "../../agent-tasks/country-sweep-leases";
import type { UploadingOutputRow } from "./model";

export function readUploadingOutput(
  db: D1Database,
  context: CountryTaskLeaseContext
) {
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

export function manifestAfterChunk(
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

export function manifestFromRow(
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

export function manifestMatchesRow(
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

export function countColumnForKind(kind: CountrySweepChunkKind) {
  if (kind === "organizations") {
    return "organization_count";
  }
  if (kind === "contacts") {
    return "contact_count";
  }
  return "scope_count";
}

export function assertNextChunkKind(
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

export function chunkKindsAreInMaterializationOrder(
  kinds: CountrySweepChunkKind[]
) {
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

export function countrySweepChunkObjectKey(
  outputId: string,
  ordinal: number,
  sha256: string
) {
  return `country-sweeps/${outputId}/${ordinal.toString().padStart(6, "0")}-${sha256}.json`;
}

export function materializationItemId(
  outputId: string,
  sequence: number,
  kind: string
) {
  return `country-materialization:${outputId}:${sequence.toString()}:${kind}`;
}

export async function stableId(namespace: string, ...parts: string[]) {
  return `${namespace}:${await sha256Hex(parts.join("\u001f"))}`;
}

export function requiredChangesAssertion(
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
