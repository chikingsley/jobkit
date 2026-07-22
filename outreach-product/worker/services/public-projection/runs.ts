import type { PublicProjectionRunRequest } from "./contracts";
import {
  canonicalProjectionScope,
  PUBLIC_PROJECTION_CONTRACT_VERSION,
  PUBLIC_PROJECTOR_VERSION,
} from "./contracts";
import { sha256Hex } from "./hash";
import {
  publicProjectionPolicyHeadsHash,
  publicProjectionSourceWatermark,
} from "./snapshots";

interface ProjectionRunRow {
  completed_at: string | null;
  error_code: string;
  error_detail: string;
  id: string;
  listing_blocked: number;
  listing_completed: number;
  listing_failed: number;
  listing_superseded: number;
  listing_total: number;
  mode: "shadow";
  position_blocked: number;
  position_completed: number;
  position_failed: number;
  position_superseded: number;
  position_total: number;
  requested_at: string;
  selection_complete: number;
  started_at: string | null;
  status:
    | "canceled"
    | "completed"
    | "completed_with_blocks"
    | "failed"
    | "queued"
    | "running";
  updated_at: string;
}

interface ProjectionRunSnapshotRow extends ProjectionRunRow {
  contract_version: number;
  policy_heads_hash: string;
  projector_version: string;
  request_key: string;
  scope_json: string;
  source_watermark_json: string;
}

interface ReasonCountRow {
  count: number;
  reason: string;
}

interface ItemCountRow {
  count: number;
  dimension: "stage" | "status";
  item_type: "listing" | "position";
  value: string;
}

export async function createPublicProjectionRun(
  db: D1Database,
  userId: string,
  input: PublicProjectionRunRequest
) {
  const scope = canonicalProjectionScope(input.scope);
  const scopeJson = JSON.stringify(scope);
  const [policyHeadsHash, sourceWatermark] = await Promise.all([
    publicProjectionPolicyHeadsHash(db),
    publicProjectionSourceWatermark(db, scope),
  ]);
  const sourceWatermarkJson = JSON.stringify(sourceWatermark);
  const requestKey = await sha256Hex(
    JSON.stringify({
      contractVersion: PUBLIC_PROJECTION_CONTRACT_VERSION,
      mode: "shadow",
      policyHeadsHash,
      projectorVersion: PUBLIC_PROJECTOR_VERSION,
      scope,
      sourceWatermark: JSON.parse(sourceWatermarkJson) as unknown,
    })
  );
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  await db
    .prepare(
      `INSERT OR IGNORE INTO public_projection_runs (
        id,requested_by_user_id,mode,request_key,scope_json,contract_version,
        projector_version,policy_heads_hash,source_watermark_json,status,
        requested_at,updated_at
      ) VALUES (?,?, 'shadow',?,?,?,?,?,?,'queued',?,?)`
    )
    .bind(
      id,
      userId,
      requestKey,
      scopeJson,
      PUBLIC_PROJECTION_CONTRACT_VERSION,
      PUBLIC_PROJECTOR_VERSION,
      policyHeadsHash,
      sourceWatermarkJson,
      timestamp,
      timestamp
    )
    .run();
  const row = await db
    .prepare(
      `SELECT ${runColumns()},request_key,scope_json,contract_version,
              projector_version,policy_heads_hash,source_watermark_json
         FROM public_projection_runs
        WHERE request_key=? LIMIT 1`
    )
    .bind(requestKey)
    .first<ProjectionRunSnapshotRow>();
  if (!row) {
    throw new Error("Shadow projection run could not be created");
  }
  assertCanonicalRequestSnapshot(row, {
    contractVersion: PUBLIC_PROJECTION_CONTRACT_VERSION,
    policyHeadsHash,
    projectorVersion: PUBLIC_PROJECTOR_VERSION,
    requestKey,
    scopeJson,
    sourceWatermarkJson,
  });
  return projectionRunSummary(db, row);
}

export async function getPublicProjectionRun(db: D1Database, runId: string) {
  const row = await db
    .prepare(
      `SELECT ${runColumns()} FROM public_projection_runs WHERE id=? LIMIT 1`
    )
    .bind(runId)
    .first<ProjectionRunRow>();
  return row ? projectionRunSummary(db, row) : null;
}

async function projectionRunSummary(db: D1Database, row: ProjectionRunRow) {
  const [reasons, itemCounts] = await Promise.all([
    db
      .prepare(
        `WITH reasons(reason) AS (
         SELECT error_code FROM public_projection_listing_items
          WHERE run_id=? AND trim(error_code)<>''
         UNION ALL
         SELECT error_code FROM public_projection_position_items
          WHERE run_id=? AND trim(error_code)<>''
         UNION ALL
         SELECT CAST(value AS TEXT)
           FROM public_projection_position_items,json_each(reason_codes_json)
          WHERE run_id=?
       )
       SELECT reason,COUNT(*) count FROM reasons
        WHERE trim(reason)<>'' GROUP BY reason ORDER BY reason`
      )
      .bind(row.id, row.id, row.id)
      .all<ReasonCountRow>(),
    db
      .prepare(
        `SELECT 'listing' item_type,'stage' dimension,stage value,
                COUNT(*) count
           FROM public_projection_listing_items WHERE run_id=? GROUP BY stage
         UNION ALL
         SELECT 'listing','status',status,COUNT(*)
           FROM public_projection_listing_items WHERE run_id=? GROUP BY status
         UNION ALL
         SELECT 'position','stage',stage,COUNT(*)
           FROM public_projection_position_items WHERE run_id=? GROUP BY stage
         UNION ALL
         SELECT 'position','status',status,COUNT(*)
           FROM public_projection_position_items WHERE run_id=? GROUP BY status
         ORDER BY item_type,dimension,value`
      )
      .bind(row.id, row.id, row.id, row.id)
      .all<ItemCountRow>(),
  ]);
  return {
    completedAt: row.completed_at,
    counters: {
      listings: {
        blocked: row.listing_blocked,
        completed: row.listing_completed,
        failed: row.listing_failed,
        superseded: row.listing_superseded,
        total: row.listing_total,
      },
      positions: {
        blocked: row.position_blocked,
        completed: row.position_completed,
        failed: row.position_failed,
        superseded: row.position_superseded,
        total: row.position_total,
      },
    },
    error: row.error_code
      ? { code: row.error_code, detail: row.error_detail }
      : null,
    id: row.id,
    items: {
      listings: {
        byStage: countMap(itemCounts.results, "listing", "stage"),
        byStatus: countMap(itemCounts.results, "listing", "status"),
      },
      positions: {
        byStage: countMap(itemCounts.results, "position", "stage"),
        byStatus: countMap(itemCounts.results, "position", "status"),
      },
    },
    mode: row.mode,
    reasonCounts: Object.fromEntries(
      reasons.results.map((reason) => [reason.reason, reason.count])
    ),
    requestedAt: row.requested_at,
    selectionComplete: row.selection_complete === 1,
    startedAt: row.started_at,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

function countMap(
  rows: ItemCountRow[],
  itemType: ItemCountRow["item_type"],
  dimension: ItemCountRow["dimension"]
) {
  return Object.fromEntries(
    rows
      .filter(
        (row) => row.item_type === itemType && row.dimension === dimension
      )
      .map((row) => [row.value, row.count])
  );
}

function runColumns() {
  return `id,mode,status,listing_total,listing_completed,listing_blocked,
    listing_failed,listing_superseded,position_total,position_completed,
    position_blocked,position_failed,position_superseded,selection_complete,
    error_code,error_detail,requested_at,started_at,completed_at,updated_at`;
}

function assertCanonicalRequestSnapshot(
  row: ProjectionRunSnapshotRow,
  expected: {
    contractVersion: number;
    policyHeadsHash: string;
    projectorVersion: string;
    requestKey: string;
    scopeJson: string;
    sourceWatermarkJson: string;
  }
) {
  if (
    row.mode !== "shadow" ||
    row.request_key !== expected.requestKey ||
    row.scope_json !== expected.scopeJson ||
    row.contract_version !== expected.contractVersion ||
    row.projector_version !== expected.projectorVersion ||
    row.policy_heads_hash !== expected.policyHeadsHash ||
    row.source_watermark_json !== expected.sourceWatermarkJson
  ) {
    throw new PublicProjectionRunError(
      "Projection request key resolved to a different request snapshot",
      409
    );
  }
}

export class PublicProjectionRunError extends Error {
  readonly status: 400 | 403 | 404 | 409;

  constructor(message: string, status: 400 | 403 | 404 | 409) {
    super(message);
    this.name = "PublicProjectionRunError";
    this.status = status;
  }
}
