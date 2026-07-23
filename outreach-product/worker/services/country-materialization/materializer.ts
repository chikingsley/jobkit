import {
  CountrySweepCanonicalChunkSchema,
  canonicalCountrySweepChunkJson,
  MAX_CANONICAL_CHUNK_BYTES,
  MAX_RECORDS_PER_CHUNK,
  sha256Hex,
} from "../../../src/features/countries/materialization";
import type { AppEnv } from "../../env";
import { isConstraintError } from "../agent-tasks/run-store";
import {
  materializeCampaignFanout,
  materializeVerificationFanout,
} from "./materializer/fanout";
import {
  finalizeMaterializedOutput,
  recordMaterializationFailure,
} from "./materializer/finalization";
import type { MaterializationItemRow } from "./materializer/model";
import {
  materializeContacts,
  materializeOrganizations,
  materializeScopes,
} from "./materializer/organizations";
import {
  isMaterializationRace,
  materializationStagePrerequisitesSql,
  requiredChangesAssertion,
} from "./materializer/statements";

// biome-ignore lint/performance/noBarrelFile: This behavior-owning module preserves its stable public API after internal decomposition.
export {
  FANOUT_PAGE_SIZE,
  MATERIALIZATION_LEASE_MINUTES,
} from "./materializer/model";

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
