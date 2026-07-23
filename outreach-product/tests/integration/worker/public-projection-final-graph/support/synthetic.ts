import {
  canonicalJson,
  compareUtf8Bytes,
} from "../../../../../worker/services/public-projection/hash";
import { fixtureHash } from "./fixtures";
import { testEnv, timestamp } from "./model";

export function beforeFirstBatch(db: D1Database, hook: () => Promise<void>) {
  let pending = true;
  return new Proxy(db, {
    get(target, property) {
      if (property === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          if (pending) {
            pending = false;
            await hook();
          }
          return target.batch(statements);
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as D1Database;
}

export function countingDatabase(db: D1Database) {
  let count = 0;
  return {
    db: new Proxy(db, {
      get(target, property) {
        if (property === "prepare") {
          return (query: string) => {
            count += 1;
            return target.prepare(query);
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as D1Database,
    prepareCount: () => count,
  };
}

export function syntheticMemberKey(index: number) {
  return `synthetic-member-${index.toString().padStart(6, "0")}`;
}

export function syntheticPositionItemId(index: number) {
  return `synthetic-position-${index.toString().padStart(6, "0")}`;
}

export async function seedFinalWorkPublicMember(input: {
  publicMemberKey: string;
  runId: string;
  signalHash: string;
}) {
  const publicJobId = "live-query-plan-root";
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO public_projection_final_work_public_roots (
        run_id,ordinal,originating_public_job_id,redirect_root_id,
        public_member_key,redirect_path_json,public_job_version,
        eligibility_decision_version,public_job_created_at,served_publicly,
        first_published_at,founding_source_position_id,allocation_hash,
        content_head_hash,redirect_path_hash,history_hash,
        allocation_input_hash,row_hash,encoded_bytes,created_at
      ) VALUES (?,0,?,?,?, ?,1,1,?,0,NULL,NULL,NULL,?,?,?,?,?,2,?)`
    ).bind(
      input.runId,
      publicJobId,
      publicJobId,
      input.publicMemberKey,
      canonicalJson([publicJobId]),
      timestamp,
      "1".repeat(64),
      "2".repeat(64),
      "3".repeat(64),
      "4".repeat(64),
      "5".repeat(64),
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO public_projection_final_work_canonical_members (
        run_id,public_member_key,signal_hash,created_at
      ) VALUES (?,?,?,?)`
    ).bind(input.runId, input.publicMemberKey, input.signalHash, timestamp),
  ]);
}

export async function insertSyntheticSameRelations(input: {
  count: number;
  memberKey: string;
  runId: string;
  start: number;
}) {
  const statement = (side: "left" | "right") => {
    const neighbor = `${side === "left" ? "z" : "a"}-frontier-`;
    const left = side === "left" ? "?" : `printf('${neighbor}%06d',value)`;
    const right = side === "left" ? `printf('${neighbor}%06d',value)` : "?";
    return testEnv.DB.prepare(
      `WITH RECURSIVE sequence(value) AS (
         SELECT ? UNION ALL SELECT value+1 FROM sequence WHERE value+1<?
       )
       INSERT INTO public_projection_final_work_relations (
         run_id,ordinal,id,left_member_key,right_member_key,payload_json,
         operator_decision_id,operator_decision_hash,operator_terminal,
         relation,relation_hash,encoded_bytes,created_at
       )
       SELECT ?,value*2+${side === "left" ? 0 : 1},
              printf('relation-${side}-%06d',value),${left},${right},'{}',
              NULL,NULL,1,'same',printf('%064x',value+${
                side === "left" ? 400_000 : 500_000
              }),2,?
         FROM sequence`
    ).bind(
      input.start,
      input.start + input.count,
      input.runId,
      input.memberKey,
      timestamp
    );
  };
  await testEnv.DB.batch([statement("left"), statement("right")]);
}

export async function insertSyntheticResolvedCohort(input: {
  count: number;
  runId: string;
  signalHash: string;
  start: number;
}) {
  await testEnv.DB.prepare(
    `WITH RECURSIVE sequence(value) AS (
       SELECT ?
       UNION ALL
       SELECT value+1 FROM sequence WHERE value+1<?
     )
     INSERT INTO public_projection_final_work_resolution_inputs (
       run_id,ordinal,position_item_id,source_position_id,input_hash,
       checkpoint_json,resolution_state,resolution_reason_code,
       resolution_seal_hash,canonical_signal_hash,member_key,member_hash,
       row_hash,encoded_bytes,created_at
     )
     SELECT ?,value,
            printf('synthetic-position-%06d',value),
            printf('synthetic-source-%06d',value),
            printf('%064x',value+1),'{}','resolved','synthetic',
            printf('%064x',value+100001),?,
            printf('synthetic-member-%06d',value),
            printf('%064x',value+200001),
            printf('%064x',value+300001),2,?
       FROM sequence`
  )
    .bind(
      input.start,
      input.start + input.count,
      input.runId,
      input.signalHash,
      timestamp
    )
    .run();
}

export function commitThenLoseFirstBatch(db: D1Database) {
  let pending = true;
  return new Proxy(db, {
    get(target, property) {
      if (property === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          const result = await target.batch(statements);
          if (pending) {
            pending = false;
            throw new Error("simulated committed response loss");
          }
          return result;
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as D1Database;
}

export function seedSameOperatorDecision(first: string, second: string) {
  return seedOperatorDecision(first, second, "same");
}

export async function ensureFixtureOperator() {
  await testEnv.DB.prepare(
    `INSERT OR IGNORE INTO users (
      id,name,email,email_verified,created_at,updated_at,role
    ) VALUES ('fixture-operator','Fixture Operator','operator@example.test',
      1,?,?, 'operator')`
  )
    .bind(timestamp, timestamp)
    .run();
}

export async function insertOperatorDecision(input: {
  decision: "deferred" | "different" | "same";
  left: string;
  right: string;
  supersedesDecisionId: null | string;
}) {
  let reasonCode = "operator_deferred";
  if (input.decision === "same") {
    reasonCode = "operator_confirmed_same";
  } else if (input.decision === "different") {
    reasonCode = "operator_confirmed_different";
  }
  const identity = `${input.decision}:${input.left}:${input.right}:${input.supersedesDecisionId ?? "first"}`;
  const decisionId = `pfdec_v1_${await fixtureHash(`id:${identity}`)}`;
  await testEnv.DB.prepare(
    `INSERT INTO public_projection_duplicate_operator_decisions (
      id,left_member_key,right_member_key,decision,reason_code,evidence_hash,
      supersedes_decision_id,operator_user_id,decided_at,decision_hash,
      created_at
    ) VALUES (?,?,?,?,?,?,?,'fixture-operator',?,?,?)`
  )
    .bind(
      decisionId,
      input.left,
      input.right,
      input.decision,
      reasonCode,
      await fixtureHash(`evidence:${identity}`),
      input.supersedesDecisionId,
      timestamp,
      await fixtureHash(`decision:${identity}`),
      timestamp
    )
    .run();
  return decisionId;
}

export async function seedOperatorDecision(
  first: string,
  second: string,
  decision: "different" | "same"
) {
  const [left, right] =
    compareUtf8Bytes(first, second) <= 0 ? [first, second] : [second, first];
  const reasonCode =
    decision === "same"
      ? "operator_confirmed_same"
      : "operator_confirmed_different";
  const evidenceHash = await fixtureHash(
    `operator-evidence:${decision}:${left}:${right}`
  );
  const decisionHash = await fixtureHash(
    `operator-decision:${decision}:${left}:${right}`
  );
  const decisionId = `pfdec_v1_${await fixtureHash(
    `id:${decision}:${left}:${right}`
  )}`;
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT OR IGNORE INTO users (
        id,name,email,email_verified,created_at,updated_at,role
      ) VALUES ('fixture-operator','Fixture Operator','operator@example.test',
        1,?,?, 'operator')`
    ).bind(timestamp, timestamp),
    testEnv.DB.prepare(
      `INSERT INTO public_projection_duplicate_operator_decisions (
        id,left_member_key,right_member_key,decision,reason_code,evidence_hash,
        supersedes_decision_id,operator_user_id,decided_at,decision_hash,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?,NULL,'fixture-operator',?,?,?)`
    ).bind(
      decisionId,
      left,
      right,
      decision,
      reasonCode,
      evidenceHash,
      timestamp,
      decisionHash,
      timestamp
    ),
  ]);
}
