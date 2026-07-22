import {
  COMPONENT_ROOT_CANDIDATE_PAGE_SIZE,
  type ComponentRootCandidateInput,
} from "./component-members";
import { changeAssertion, pageJson } from "./shared";

type ComponentChildState = "members" | "relations" | "roots" | "updates";

interface ComponentChildPageInput {
  ambiguous?: boolean;
  complete: boolean;
  digest?: string;
  frozenAt: string;
  lastRowCursor?: string;
  nextCursor: string;
  page: unknown[];
  priorCursor: string;
  priorDigest?: null | string;
  rootCandidates?: ComponentRootCandidateInput[];
  runId: string;
  seedMemberKey: string;
  sourceMappedWinner?: boolean;
  state: ComponentChildState;
}

const COMPONENT_CHILD_INSERT_SQL = {
  members: `INSERT INTO public_projection_final_work_component_members (
    run_id,seed_member_key,ordinal,payload_json,member_hash,
    encoded_bytes,created_at
  ) SELECT ?,?,CAST(json_extract(value,'$.ordinal') AS INTEGER),
      CAST(json_extract(value,'$.payloadJson') AS TEXT),
      CAST(json_extract(value,'$.memberHash') AS TEXT),
      CAST(json_extract(value,'$.encodedBytes') AS INTEGER),?
    FROM json_each(?)`,
  relations: `INSERT INTO public_projection_final_work_component_relations (
    run_id,seed_member_key,ordinal,relation_id,relation_hash,
    encoded_bytes,created_at
  ) SELECT ?,?,CAST(json_extract(value,'$.ordinal') AS INTEGER),
      CAST(json_extract(value,'$.relationId') AS TEXT),
      CAST(json_extract(value,'$.relationHash') AS TEXT),
      CAST(json_extract(value,'$.encodedBytes') AS INTEGER),?
    FROM json_each(?)`,
  roots: `INSERT INTO public_projection_final_work_component_roots (
    run_id,seed_member_key,ordinal,payload_json,root_hash,
    encoded_bytes,created_at
  ) SELECT ?,?,CAST(json_extract(value,'$.ordinal') AS INTEGER),
      CAST(json_extract(value,'$.payloadJson') AS TEXT),
      CAST(json_extract(value,'$.rootHash') AS TEXT),
      CAST(json_extract(value,'$.encodedBytes') AS INTEGER),?
    FROM json_each(?)`,
  updates: `INSERT INTO public_projection_final_work_position_updates (
    run_id,seed_member_key,ordinal,position_item_id,source_position_id,
    input_hash,checkpoint_json,row_hash,encoded_bytes,created_at
  ) SELECT ?,?,CAST(json_extract(value,'$.ordinal') AS INTEGER),
      CAST(json_extract(value,'$.positionItemId') AS TEXT),
      CAST(json_extract(value,'$.sourcePositionId') AS TEXT),
      CAST(json_extract(value,'$.inputHash') AS TEXT),
      CAST(json_extract(value,'$.checkpointJson') AS TEXT),
      CAST(json_extract(value,'$.rowHash') AS TEXT),
      CAST(json_extract(value,'$.encodedBytes') AS INTEGER),?
    FROM json_each(?)`,
} as const;

const COMPONENT_CHILD_STATE_CONFIG = {
  members: {
    countColumn: "member_count",
    digestColumn: "member_digest",
    lastCursorColumn: "member_last_cursor",
    nextState: "relations",
  },
  relations: {
    countColumn: "relation_count",
    digestColumn: "relation_digest",
    lastCursorColumn: "relation_last_cursor",
    nextState: "roots",
  },
  roots: {
    countColumn: "root_count",
    digestColumn: "root_digest",
    lastCursorColumn: "root_last_cursor",
    nextState: "updates",
  },
  updates: {
    countColumn: null,
    digestColumn: null,
    lastCursorColumn: "update_last_cursor",
    nextState: "sealed",
  },
} as const;

type ComponentChildConfig =
  (typeof COMPONENT_CHILD_STATE_CONFIG)[ComponentChildState];

export function stageComponentChildPageStatements(
  db: D1Database,
  input: ComponentChildPageInput
) {
  const payload = pageJson(input.page, `component ${input.state}`);
  const statements: D1PreparedStatement[] = [];
  if (input.page.length > 0) {
    statements.push(
      db
        .prepare(COMPONENT_CHILD_INSERT_SQL[input.state])
        .bind(input.runId, input.seedMemberKey, input.frozenAt, payload),
      changeAssertion(db, input.page.length)
    );
  }
  if (input.rootCandidates && input.rootCandidates.length > 0) {
    const rootCandidatePayload = pageJson(
      input.rootCandidates,
      "component root candidates",
      COMPONENT_ROOT_CANDIDATE_PAGE_SIZE
    );
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO public_projection_final_component_root_candidates (
            run_id,seed_member_key,member_key,originating_public_job_id,
            served_publicly,published_missing_rank,first_published_sort,
            public_job_created_at,redirect_root_id,created_at
          ) SELECT ?,?,CAST(json_extract(value,'$.memberKey') AS TEXT),
              CAST(json_extract(value,'$.originatingPublicJobId') AS TEXT),
              CAST(json_extract(value,'$.servedPublicly') AS INTEGER),
              CAST(json_extract(value,'$.publishedMissingRank') AS INTEGER),
              CAST(json_extract(value,'$.firstPublishedSort') AS TEXT),
              CAST(json_extract(value,'$.publicJobCreatedAt') AS TEXT),
              CAST(json_extract(value,'$.redirectRootId') AS TEXT),?
            FROM json_each(?)`
        )
        .bind(
          input.runId,
          input.seedMemberKey,
          input.frozenAt,
          rootCandidatePayload
        )
    );
  }
  statements.push(componentChildUpdateStatement(db, input));
  statements.push(changeAssertion(db, 1));
  return statements;
}

function componentChildUpdateStatement(
  db: D1Database,
  input: ComponentChildPageInput
) {
  const config = COMPONENT_CHILD_STATE_CONFIG[input.state];
  const nextState = input.complete ? config.nextState : input.state;
  const pageBytes = input.page.reduce<number>(
    (sum, value) =>
      sum + ((value as { encodedBytes?: number }).encodedBytes ?? 0),
    0
  );
  const assignments = componentChildAssignments(input, config);
  const bindings = componentChildBindings(input, config, nextState, pageBytes);
  const digestGuard = config.digestColumn
    ? `AND ${config.digestColumn} IS ?`
    : "";
  return db
    .prepare(
      `UPDATE public_projection_final_component_work
            SET state=?,child_cursor=?,${config.lastCursorColumn}=?
                ${assignments.digest}${assignments.count}${assignments.evidence}
                ${assignments.oversized},encoded_bytes=encoded_bytes+?,updated_at=?
          WHERE run_id=? AND seed_member_key=? AND state=? AND child_cursor=?
            ${digestGuard}`
    )
    .bind(...bindings);
}

function componentChildAssignments(
  input: ComponentChildPageInput,
  config: ComponentChildConfig
) {
  return {
    count: config.countColumn
      ? `,${config.countColumn}=${config.countColumn}+?`
      : "",
    digest: config.digestColumn ? `,${config.digestColumn}=?` : "",
    evidence:
      input.state === "relations"
        ? ",ambiguous=MAX(ambiguous,?),source_mapped_winner=MAX(source_mapped_winner,?)"
        : "",
    oversized:
      input.state === "members"
        ? ",oversized=MAX(oversized,(member_count+?)>25)"
        : "",
  };
}

function componentChildBindings(
  input: ComponentChildPageInput,
  config: ComponentChildConfig,
  nextState: string,
  pageBytes: number
) {
  const bindings: unknown[] = [
    nextState,
    input.complete ? "" : input.nextCursor,
    input.lastRowCursor ?? input.nextCursor,
  ];
  if (config.digestColumn) {
    bindings.push(input.digest);
  }
  if (config.countColumn) {
    bindings.push(input.page.length);
  }
  if (input.state === "members") {
    bindings.push(input.page.length);
  }
  if (input.state === "relations") {
    bindings.push(input.ambiguous ? 1 : 0, input.sourceMappedWinner ? 1 : 0);
  }
  bindings.push(pageBytes);
  bindings.push(
    input.frozenAt,
    input.runId,
    input.seedMemberKey,
    input.state,
    input.priorCursor
  );
  if (config.digestColumn) {
    bindings.push(input.priorDigest);
  }
  return bindings;
}

export function finalizeComponentArtifactStatements(
  db: D1Database,
  input: {
    allocationHash: string;
    allocationId: string;
    allocationState: "blocked" | "promotable";
    artifactHash: string;
    encodedBytes: number;
    foundingSourcePositionId: string;
    frozenAt: string;
    losingRootCount: number;
    proposedPublicJobId: null | string;
    reasonCode: string;
    rootCount: number;
    runId: string;
    seedMemberKey: string;
    winningPublicJobId: null | string;
  }
) {
  return [
    db
      .prepare(
        `UPDATE public_projection_final_component_work
            SET allocation_id=?,allocation_hash=?,artifact_hash=?,
                founding_source_position_id=?,proposed_public_job_id=?,
                winning_public_job_id=?,losing_root_count=?,
                allocation_state=?,reason_code=?,encoded_bytes=encoded_bytes+?,
                updated_at=?
          WHERE run_id=? AND seed_member_key=? AND state='updates'
            AND member_digest IS NOT NULL AND relation_digest IS NOT NULL
            AND root_digest IS NOT NULL AND root_count=?`
      )
      .bind(
        input.allocationId,
        input.allocationHash,
        input.artifactHash,
        input.foundingSourcePositionId,
        input.proposedPublicJobId,
        input.winningPublicJobId,
        input.losingRootCount,
        input.allocationState,
        input.reasonCode,
        input.encodedBytes,
        input.frozenAt,
        input.runId,
        input.seedMemberKey,
        input.rootCount
      ),
    changeAssertion(db, 1),
  ];
}

export function initializeComponentRootSummaryStatements(
  db: D1Database,
  input: {
    allocationState: "blocked" | "promotable";
    foundingSourcePositionId: string;
    frozenAt: string;
    proposedPublicJobId: null | string;
    reasonCode: string;
    rootExpectedCount: number;
    runId: string;
    seedMemberKey: string;
    winningPublicJobId: null | string;
  }
) {
  return [
    db
      .prepare(
        `UPDATE public_projection_final_component_work
            SET root_summary_ready=1,root_expected_count=?,
                founding_source_position_id=?,proposed_public_job_id=?,
                winning_public_job_id=?,losing_root_count=?,
                allocation_state=?,reason_code=?,updated_at=?
          WHERE run_id=? AND seed_member_key=? AND state='roots'
            AND root_summary_ready=0 AND root_count=0 AND child_cursor=''`
      )
      .bind(
        input.rootExpectedCount,
        input.foundingSourcePositionId,
        input.proposedPublicJobId,
        input.winningPublicJobId,
        input.winningPublicJobId === null
          ? input.rootExpectedCount
          : Math.max(0, input.rootExpectedCount - 1),
        input.allocationState,
        input.reasonCode,
        input.frozenAt,
        input.runId,
        input.seedMemberKey
      ),
    changeAssertion(db, 1),
  ];
}
