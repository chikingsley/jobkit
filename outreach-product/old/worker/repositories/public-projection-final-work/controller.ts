import { changeAssertion, leaseAssertion } from "./shared";
import {
  type FinalWorkClaim,
  type FinalWorkController,
  type FinalWorkPhase,
  PUBLIC_FINAL_WORK_MAX_PAGE_BYTES,
  PUBLIC_FINAL_WORK_PAGE_SIZE,
} from "./types";

interface ControllerRow {
  active_component_seed: null | string;
  allocation_bytes: number;
  allocation_digest: null | string;
  canonical_match_bytes: number;
  canonical_match_count: number;
  canonical_match_digest: null | string;
  canonical_match_last_cursor: string;
  canonical_request_bytes: number;
  canonical_request_count: number;
  canonical_request_digest: null | string;
  canonical_request_last_cursor: string;
  component_bytes: number;
  component_count: number;
  component_digest: null | string;
  component_last_cursor: string;
  frozen_at: string;
  input_digest: string;
  last_error_code: null | string;
  mapping_bytes: number;
  mapping_count: number;
  mapping_digest: null | string;
  mapping_last_cursor: string;
  phase: FinalWorkPhase;
  phase_cursor: string;
  phase_ordinal: number;
  public_root_bytes: number;
  public_root_count: number;
  public_root_digest: null | string;
  public_root_last_cursor: string;
  relation_bytes: number;
  relation_count: number;
  relation_digest: null | string;
  relation_last_cursor: string;
  resolution_bytes: number;
  resolution_count: number;
  resolution_digest: null | string;
  resolution_last_cursor: string;
  run_id: string;
  source_mapping_count: number;
  source_mapping_digest: null | string;
  source_mapping_last_cursor: string;
  status: FinalWorkController["status"];
}

const CONTROLLER_SELECT = `SELECT run_id,input_digest,phase,status,
  phase_cursor,phase_ordinal,active_component_seed,resolution_count,
  resolution_bytes,resolution_digest,resolution_last_cursor,
  mapping_count,mapping_bytes,mapping_digest,mapping_last_cursor,
  canonical_request_count,canonical_request_bytes,canonical_request_digest,
  canonical_request_last_cursor,canonical_match_count,canonical_match_bytes,
  canonical_match_digest,canonical_match_last_cursor,public_root_count,
  public_root_bytes,public_root_digest,public_root_last_cursor,relation_count,
  relation_bytes,relation_digest,relation_last_cursor,component_count,
  component_bytes,component_digest,component_last_cursor,allocation_bytes,
  allocation_digest,source_mapping_count,source_mapping_digest,
  source_mapping_last_cursor,
  last_error_code,frozen_at
 FROM public_projection_final_work`;

export async function ensureFinalWork(
  db: D1Database,
  input: { frozenAt: string; inputDigest: string; runId: string }
) {
  await db
    .prepare(
      `INSERT OR IGNORE INTO public_projection_final_work (
        run_id,input_digest,phase,status,frozen_at,created_at,updated_at
      ) VALUES (?,?,'resolution_inputs','queued',?,?,?)`
    )
    .bind(
      input.runId,
      input.inputDigest,
      input.frozenAt,
      input.frozenAt,
      input.frozenAt
    )
    .run();
  const controller = await readFinalWork(db, input.runId);
  if (!controller || controller.inputDigest !== input.inputDigest) {
    throw new Error("The durable final duplicate boundary changed");
  }
  return controller;
}

export async function readFinalWork(db: D1Database, runId: string) {
  const row = await db
    .prepare(`${CONTROLLER_SELECT} WHERE run_id=? LIMIT 1`)
    .bind(runId)
    .first<ControllerRow>();
  return row ? controllerFromRow(row) : null;
}

export async function claimFinalWork(
  db: D1Database,
  runId: string
): Promise<FinalWorkClaim | null> {
  await db
    .prepare(
      `UPDATE public_projection_final_work
          SET status='queued',lease_token=NULL,lease_expires_at=NULL,
              last_error_code='lease_expired',
              last_error_message='The previous D3 page lease expired',
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE run_id=? AND status='processing'
          AND lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')`
    )
    .bind(runId)
    .run();
  const leaseToken = crypto.randomUUID();
  const row = await db
    .prepare(
      `UPDATE public_projection_final_work
          SET status='processing',lease_token=?,
              lease_expires_at=strftime(
                '%Y-%m-%dT%H:%M:%fZ','now','+5 minutes'
              ),
              lease_epoch=lease_epoch+1,attempt_count=attempt_count+1,
              last_error_code=NULL,last_error_message=NULL,
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE run_id=? AND status='queued'
          AND phase NOT IN ('ready','sealed')
      RETURNING run_id,phase,phase_cursor,phase_ordinal,
                active_component_seed,component_bytes,component_digest,
                source_mapping_count,source_mapping_digest,
                source_mapping_last_cursor,lease_epoch,frozen_at,
                CASE phase
                  WHEN 'resolution_inputs' THEN resolution_count
                  WHEN 'mapping_inputs' THEN mapping_count
                  WHEN 'canonical_requests' THEN canonical_request_count
                  WHEN 'canonical_matches' THEN canonical_match_count
                  WHEN 'public_roots' THEN public_root_count
                  WHEN 'relations' THEN relation_count
                  ELSE component_count
                END counter_count,
                CASE phase
                  WHEN 'resolution_inputs' THEN resolution_bytes
                  WHEN 'mapping_inputs' THEN mapping_bytes
                  WHEN 'canonical_requests' THEN canonical_request_bytes
                  WHEN 'canonical_matches' THEN canonical_match_bytes
                  WHEN 'public_roots' THEN public_root_bytes
                  WHEN 'relations' THEN relation_bytes
                  ELSE component_bytes
                END counter_bytes,
                CASE phase
                  WHEN 'resolution_inputs' THEN resolution_digest
                  WHEN 'mapping_inputs' THEN mapping_digest
                  WHEN 'canonical_requests' THEN canonical_request_digest
                  WHEN 'canonical_matches' THEN canonical_match_digest
                  WHEN 'public_roots' THEN public_root_digest
                  WHEN 'relations' THEN relation_digest
                  ELSE component_digest
                END counter_digest,
                CASE phase
                  WHEN 'resolution_inputs' THEN resolution_last_cursor
                  WHEN 'mapping_inputs' THEN mapping_last_cursor
                  WHEN 'canonical_requests' THEN canonical_request_last_cursor
                  WHEN 'canonical_matches' THEN canonical_match_last_cursor
                  WHEN 'public_roots' THEN public_root_last_cursor
                  WHEN 'relations' THEN relation_last_cursor
                  ELSE component_last_cursor
                END counter_last_cursor`
    )
    .bind(leaseToken, runId)
    .first<{
      active_component_seed: null | string;
      component_bytes: number;
      component_digest: null | string;
      counter_bytes: number;
      counter_count: number;
      counter_digest: null | string;
      counter_last_cursor: string;
      frozen_at: string;
      lease_epoch: number;
      phase: FinalWorkPhase;
      phase_cursor: string;
      phase_ordinal: number;
      run_id: string;
      source_mapping_count: number;
      source_mapping_digest: null | string;
      source_mapping_last_cursor: string;
    }>();
  return row
    ? {
        activeComponentSeed: row.active_component_seed,
        componentBytes: row.component_bytes,
        componentDigest: row.component_digest,
        counterBytes: row.counter_bytes,
        counterCount: row.counter_count,
        counterDigest: row.counter_digest,
        counterLastCursor: row.counter_last_cursor,
        frozenAt: row.frozen_at,
        leaseEpoch: row.lease_epoch,
        leaseToken,
        phase: row.phase,
        phaseCursor: row.phase_cursor,
        phaseOrdinal: row.phase_ordinal,
        runId: row.run_id,
        sourceMappingCount: row.source_mapping_count,
        sourceMappingDigest: row.source_mapping_digest,
        sourceMappingLastCursor: row.source_mapping_last_cursor,
      }
    : null;
}

type CounterName =
  | "canonical_match"
  | "canonical_request"
  | "component"
  | "mapping"
  | "public_root"
  | "relation"
  | "resolution";

const COUNTER_COLUMNS: Record<
  CounterName,
  { bytes: string; count: string; digest: string; lastCursor: string }
> = {
  canonical_match: {
    bytes: "canonical_match_bytes",
    count: "canonical_match_count",
    digest: "canonical_match_digest",
    lastCursor: "canonical_match_last_cursor",
  },
  canonical_request: {
    bytes: "canonical_request_bytes",
    count: "canonical_request_count",
    digest: "canonical_request_digest",
    lastCursor: "canonical_request_last_cursor",
  },
  component: {
    bytes: "component_bytes",
    count: "component_count",
    digest: "component_digest",
    lastCursor: "component_last_cursor",
  },
  mapping: {
    bytes: "mapping_bytes",
    count: "mapping_count",
    digest: "mapping_digest",
    lastCursor: "mapping_last_cursor",
  },
  public_root: {
    bytes: "public_root_bytes",
    count: "public_root_count",
    digest: "public_root_digest",
    lastCursor: "public_root_last_cursor",
  },
  relation: {
    bytes: "relation_bytes",
    count: "relation_count",
    digest: "relation_digest",
    lastCursor: "relation_last_cursor",
  },
  resolution: {
    bytes: "resolution_bytes",
    count: "resolution_count",
    digest: "resolution_digest",
    lastCursor: "resolution_last_cursor",
  },
};

interface CommitFinalWorkPageInput {
  activeComponentSeed?: null | string;
  bytesAdded: number;
  claim: FinalWorkClaim;
  counter: CounterName;
  digest?: string;
  lastRowCursor?: string;
  nextCursor: string;
  nextOrdinal: number;
  nextPhase: FinalWorkPhase;
  rowsAdded: number;
  sourceMappingDigest?: string;
  sourceMappingLastCursor?: string;
  sourceMappingRowsAdded?: number;
  statements: D1PreparedStatement[];
  terminalFence?: { expectedCount: number; expectedLastCursor: string };
}

export async function commitFinalWorkPage(
  db: D1Database,
  input: CommitFinalWorkPageInput
) {
  const columns = COUNTER_COLUMNS[input.counter];
  const activeAssignment =
    input.activeComponentSeed === undefined ? "" : ",active_component_seed=?";
  const nextDigest = input.digest ?? input.claim.counterDigest;
  const nextLastCursor = input.lastRowCursor ?? input.claim.counterLastCursor;
  const sourceMappingRowsAdded = input.sourceMappingRowsAdded ?? 0;
  const nextSourceMappingDigest =
    input.sourceMappingDigest ?? input.claim.sourceMappingDigest;
  const nextSourceMappingLastCursor =
    input.sourceMappingLastCursor ?? input.claim.sourceMappingLastCursor;
  assertFinalWorkPage(input, nextLastCursor, sourceMappingRowsAdded);
  const terminalFence = input.terminalFence ?? {
    expectedCount: 0,
    expectedLastCursor: "",
  };
  const bindings: unknown[] = [
    input.nextPhase,
    input.nextPhase === input.claim.phase ? input.nextCursor : "",
    input.nextPhase === input.claim.phase ? input.nextOrdinal : 0,
    input.rowsAdded,
    input.bytesAdded,
    nextDigest,
    nextLastCursor,
    sourceMappingRowsAdded,
    nextSourceMappingDigest,
    nextSourceMappingLastCursor,
  ];
  if (input.activeComponentSeed !== undefined) {
    bindings.push(input.activeComponentSeed);
  }
  bindings.push(
    input.claim.runId,
    input.claim.phase,
    input.claim.leaseToken,
    input.claim.leaseEpoch,
    input.claim.phaseCursor,
    input.claim.phaseOrdinal,
    input.claim.counterCount,
    input.claim.counterBytes,
    input.claim.counterDigest,
    input.claim.counterLastCursor,
    input.claim.sourceMappingCount,
    input.claim.sourceMappingDigest,
    input.claim.sourceMappingLastCursor,
    input.terminalFence ? 1 : 0,
    input.rowsAdded,
    terminalFence.expectedCount,
    nextLastCursor,
    terminalFence.expectedLastCursor
  );
  const results = await db.batch([
    leaseAssertion(db, input.claim),
    ...input.statements,
    db
      .prepare(
        `UPDATE public_projection_final_work
            SET phase=?,status='queued',phase_cursor=?,phase_ordinal=?,
                ${columns.count}=${columns.count}+?,
                ${columns.bytes}=${columns.bytes}+?,
                ${columns.digest}=?,${columns.lastCursor}=?,
                source_mapping_count=source_mapping_count+?,
                source_mapping_digest=?,source_mapping_last_cursor=?
                ${activeAssignment},
                lease_token=NULL,lease_expires_at=NULL,
                updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE run_id=? AND phase=? AND status='processing'
            AND lease_token=? AND lease_epoch=?
            AND phase_cursor=? AND phase_ordinal=?
            AND ${columns.count}=? AND ${columns.bytes}=?
            AND ${columns.digest} IS ? AND ${columns.lastCursor}=?
            AND source_mapping_count=? AND source_mapping_digest IS ?
            AND source_mapping_last_cursor=?
            AND (?=0 OR (${columns.count}+?=? AND ?=?))`
      )
      .bind(...bindings),
    changeAssertion(db, 1),
  ]);
  const updateResult = results.at(-2);
  if (updateResult?.meta.changes !== 1) {
    throw new Error("The D3 work page lost its lease fence");
  }
}

function assertFinalWorkPage(
  input: CommitFinalWorkPageInput,
  nextLastCursor: string,
  sourceMappingRowsAdded: number
) {
  if (input.rowsAdded > PUBLIC_FINAL_WORK_PAGE_SIZE) {
    throw new Error("The D3 work page exceeded its row budget");
  }
  if (input.bytesAdded > PUBLIC_FINAL_WORK_MAX_PAGE_BYTES) {
    throw new Error("The D3 work page exceeded its encoded byte budget");
  }
  if (
    sourceMappingRowsAdded > 0 &&
    !(input.sourceMappingDigest && input.sourceMappingLastCursor)
  ) {
    throw new Error("The mapped source page requires its digest and cursor");
  }
  if (
    input.terminalFence &&
    (input.claim.counterCount + input.rowsAdded !==
      input.terminalFence.expectedCount ||
      nextLastCursor !== input.terminalFence.expectedLastCursor)
  ) {
    throw new Error("The D3 terminal page missed its exact count or cursor");
  }
}

export async function commitFinalAllocationDigest(
  db: D1Database,
  input: {
    bytes: number;
    claim: FinalWorkClaim;
    digest: string;
  }
) {
  await db.batch([
    leaseAssertion(db, input.claim),
    db
      .prepare(
        `UPDATE public_projection_final_work
            SET phase='ready',status='queued',phase_cursor='',phase_ordinal=0,
                allocation_bytes=?,allocation_digest=?,
                lease_token=NULL,lease_expires_at=NULL,
                updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE run_id=? AND phase='allocation_digest'
            AND status='processing' AND lease_token=? AND lease_epoch=?`
      )
      .bind(
        input.bytes,
        input.digest,
        input.claim.runId,
        input.claim.leaseToken,
        input.claim.leaseEpoch
      ),
    changeAssertion(db, 1),
  ]);
}

function controllerFromRow(row: ControllerRow): FinalWorkController {
  return {
    activeComponentSeed: row.active_component_seed,
    allocationBytes: row.allocation_bytes,
    allocationDigest: row.allocation_digest,
    canonicalMatchBytes: row.canonical_match_bytes,
    canonicalMatchCount: row.canonical_match_count,
    canonicalMatchDigest: row.canonical_match_digest,
    canonicalMatchLastCursor: row.canonical_match_last_cursor,
    canonicalRequestBytes: row.canonical_request_bytes,
    canonicalRequestCount: row.canonical_request_count,
    canonicalRequestDigest: row.canonical_request_digest,
    canonicalRequestLastCursor: row.canonical_request_last_cursor,
    componentBytes: row.component_bytes,
    componentCount: row.component_count,
    componentDigest: row.component_digest,
    componentLastCursor: row.component_last_cursor,
    frozenAt: row.frozen_at,
    inputDigest: row.input_digest,
    lastErrorCode: row.last_error_code,
    mappingBytes: row.mapping_bytes,
    mappingCount: row.mapping_count,
    mappingDigest: row.mapping_digest,
    mappingLastCursor: row.mapping_last_cursor,
    phase: row.phase,
    phaseCursor: row.phase_cursor,
    phaseOrdinal: row.phase_ordinal,
    publicRootBytes: row.public_root_bytes,
    publicRootCount: row.public_root_count,
    publicRootDigest: row.public_root_digest,
    publicRootLastCursor: row.public_root_last_cursor,
    relationBytes: row.relation_bytes,
    relationCount: row.relation_count,
    relationDigest: row.relation_digest,
    relationLastCursor: row.relation_last_cursor,
    resolutionBytes: row.resolution_bytes,
    resolutionCount: row.resolution_count,
    resolutionDigest: row.resolution_digest,
    resolutionLastCursor: row.resolution_last_cursor,
    runId: row.run_id,
    sourceMappingCount: row.source_mapping_count,
    sourceMappingDigest: row.source_mapping_digest,
    sourceMappingLastCursor: row.source_mapping_last_cursor,
    status: row.status,
  };
}
