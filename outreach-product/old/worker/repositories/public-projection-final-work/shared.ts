import { canonicalJson } from "../../services/public-projection/hash";
import {
  type FinalWorkClaim,
  PUBLIC_FINAL_WORK_MAX_PAGE_BYTES,
  PUBLIC_FINAL_WORK_PAGE_SIZE,
} from "./types";

export function changeAssertion(db: D1Database, expectedChanges: number) {
  return db
    .prepare(
      `INSERT INTO public_projection_final_assertions (
        expected_changes,actual_changes
      ) VALUES (?,changes())`
    )
    .bind(expectedChanges);
}

export function encodedJsonBytes(value: unknown) {
  return new TextEncoder().encode(canonicalJson(value)).byteLength;
}

export function leaseAssertion(db: D1Database, claim: FinalWorkClaim) {
  return db
    .prepare(
      `INSERT INTO public_projection_final_assertions (
        expected_changes,actual_changes
      ) VALUES (1,(
        SELECT COUNT(*) FROM public_projection_final_work
         WHERE run_id=? AND phase=? AND status='processing'
           AND lease_token=? AND lease_epoch=?
           AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      ))`
    )
    .bind(claim.runId, claim.phase, claim.leaseToken, claim.leaseEpoch);
}

export function pageJson(
  value: unknown[],
  label: string,
  maxRows = PUBLIC_FINAL_WORK_PAGE_SIZE
) {
  if (value.length > maxRows) {
    throw new Error(`The ${label} page exceeded its row budget`);
  }
  const payload = canonicalJson(value);
  if (
    new TextEncoder().encode(payload).byteLength >
    PUBLIC_FINAL_WORK_MAX_PAGE_BYTES
  ) {
    throw new Error(`The ${label} page exceeded its encoded byte budget`);
  }
  return payload;
}
