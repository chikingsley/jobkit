import { finalizeCanonicalDuplicateGraph } from "../../../../../worker/services/public-projection/final-graph";
import {
  canonicalJson,
  canonicalSha256,
} from "../../../../../worker/services/public-projection/hash";
import { testEnv, timestamp } from "./model";

export async function finishFinalGraph(
  db: D1Database,
  runId: string,
  frozenAt: string
) {
  for (let invocation = 0; invocation < 512; invocation += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: This helper deliberately drives one durable D3 page per invocation.
    const result = await finalizeCanonicalDuplicateGraph(db, runId, frozenAt);
    if (result.state === "complete") {
      return result;
    }
  }
  throw new Error(`Durable D3 did not finish ${runId}`);
}

export async function advanceFinalGraphToReady(
  db: D1Database,
  runId: string,
  frozenAt: string,
  remainingInvocations = 512
) {
  if (remainingInvocations <= 0) {
    throw new Error(`Durable D3 did not reach ready ${runId}`);
  }
  const work = await db
    .prepare(
      `SELECT phase,status FROM public_projection_final_work
        WHERE run_id=? LIMIT 1`
    )
    .bind(runId)
    .first<{ phase: string; status: string }>();
  if (work?.phase === "ready" && work.status === "queued") {
    return;
  }
  const result = await finalizeCanonicalDuplicateGraph(db, runId, frozenAt);
  if (result.state === "complete") {
    throw new Error(`Durable D3 sealed before the ready checkpoint ${runId}`);
  }
  return advanceFinalGraphToReady(
    db,
    runId,
    frozenAt,
    remainingInvocations - 1
  );
}

export async function advanceFinalGraphToComponentState(
  runId: string,
  state: "relations" | "sealed"
) {
  for (let invocation = 0; invocation < 512; invocation += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: This helper stops at an exact durable component checkpoint.
    const component = await componentWorkSnapshot(runId);
    if (component?.state === state) {
      return component;
    }
    const result = await finalizeCanonicalDuplicateGraph(
      testEnv.DB,
      runId,
      timestamp
    );
    if (result.state === "complete") {
      throw new Error(`D3 sealed before component state ${state} for ${runId}`);
    }
  }
  throw new Error(`D3 did not reach component state ${state} for ${runId}`);
}

export function componentWorkSnapshot(runId: string) {
  return testEnv.DB.prepare(
    `SELECT seed_member_key,state,child_cursor,member_count,relation_count,
            root_count,member_digest,member_last_cursor,relation_digest,
            relation_last_cursor,root_digest,root_last_cursor,
            root_expected_count,root_summary_ready,update_last_cursor,
            allocation_id,allocation_hash,artifact_hash,
            founding_source_position_id,proposed_public_job_id,
            winning_public_job_id,losing_root_count,allocation_state,
            reason_code,encoded_bytes
       FROM public_projection_final_component_work
      WHERE run_id=? ORDER BY seed_member_key LIMIT 1`
  )
    .bind(runId)
    .first<Record<string, null | number | string>>();
}

export function makeHostileRelations(
  leftMember: Record<string, unknown>,
  count: number
) {
  return Array.from({ length: count }, (_, index) => {
    const suffix = index.toString().padStart(4, "0");
    return {
      conflictingSignals: [],
      d2ComparisonId: null,
      id: `hostile-relation-${suffix}`,
      left: leftMember,
      matchingSignals: [],
      operatorDecisionId: null,
      padding: "x".repeat(8192),
      reasonCode: "canonical_signal_mismatch",
      relation: "different" as const,
      relationHash: (index + 1).toString(16).padStart(64, "0"),
      right: {
        eligibilityDecisionVersion: 1,
        kind: "public" as const,
        memberHash: (index + 1001).toString(16).padStart(64, "0"),
        memberKey: `zz-hostile-public-${suffix}`,
        publicJobId: `hostile-public-${suffix}`,
        publicJobVersion: 1,
      },
    };
  });
}

export async function insertHostileWorkRelations(input: {
  relations: ReturnType<typeof makeHostileRelations>;
  runId: string;
}) {
  for (let offset = 0; offset < input.relations.length; offset += 24) {
    const statements = input.relations
      .slice(offset, offset + 24)
      .map((relation, pageIndex) => {
        const payloadJson = canonicalJson(relation);
        return testEnv.DB.prepare(
          `INSERT INTO public_projection_final_work_relations (
            run_id,ordinal,id,left_member_key,right_member_key,payload_json,
            operator_decision_id,operator_decision_hash,operator_terminal,
            relation,relation_hash,encoded_bytes,created_at
          ) VALUES (?,?,?,?,?,?,NULL,NULL,1,'different',?,?,?)`
        ).bind(
          input.runId,
          offset + pageIndex,
          relation.id,
          String(relation.left.memberKey),
          relation.right.memberKey,
          payloadJson,
          relation.relationHash,
          new TextEncoder().encode(payloadJson).byteLength,
          timestamp
        );
      });
    // biome-ignore lint/performance/noAwaitInLoops: The hostile fixture itself obeys the 24-row durable page boundary.
    await testEnv.DB.batch(statements);
  }
}

export async function reductionDigestByPageSize(
  domain: string,
  records: unknown[],
  pageSize: number
) {
  let digest = await canonicalSha256({ domain, state: "empty" });
  for (let offset = 0; offset < records.length; offset += pageSize) {
    for (const record of records.slice(offset, offset + pageSize)) {
      // biome-ignore lint/performance/noAwaitInLoops: The test independently reproduces the specified row-wise fold.
      digest = await canonicalSha256({
        domain,
        previousDigest: digest,
        record,
      });
    }
  }
  return digest;
}

export function componentArtifactBounds(runId: string) {
  return testEnv.DB.prepare(
    `SELECT
      (SELECT COUNT(*)
         FROM pragma_table_info('public_projection_final_component_work')
        WHERE name='component_json') component_json_columns,
      (SELECT COUNT(*)
         FROM public_projection_final_work_component_relations
        WHERE run_id=?) component_relation_count,
      (SELECT MAX(encoded_bytes) FROM (
         SELECT encoded_bytes FROM public_projection_final_work_component_members
          WHERE run_id=?
         UNION ALL
         SELECT encoded_bytes FROM public_projection_final_work_component_roots
          WHERE run_id=?
         UNION ALL
         SELECT encoded_bytes FROM public_projection_final_work_component_relations
          WHERE run_id=?
         UNION ALL
         SELECT encoded_bytes FROM public_projection_final_work_position_updates
          WHERE run_id=?
      )) max_child_bytes,
      (SELECT MAX(encoded_bytes)
         FROM public_projection_final_work_relations
        WHERE run_id=?) max_work_relation_bytes`
  )
    .bind(runId, runId, runId, runId, runId, runId)
    .first<{
      component_json_columns: number;
      component_relation_count: number;
      max_child_bytes: number;
      max_work_relation_bytes: number;
    }>();
}
