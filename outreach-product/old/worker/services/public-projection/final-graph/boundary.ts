import { readDuplicateBatch } from "../../../repositories/public-projection-duplicate-comparisons";
import { readFinalGraphBoundary } from "../../../repositories/public-projection-final-graph";
import {
  type FinalBoundaryContext,
  FinalDuplicateSnapshotError,
} from "./model";

export function finalChangeAssertion(db: D1Database, expectedChanges: number) {
  return db
    .prepare(
      `INSERT INTO public_projection_final_assertions (
        expected_changes,actual_changes
      ) VALUES (?,changes())`
    )
    .bind(expectedChanges);
}

export async function readValidatedFinalBoundary(
  db: D1Database,
  runId: string
): Promise<FinalBoundaryContext> {
  const [boundary, duplicateBatch] = await Promise.all([
    readFinalGraphBoundary(db, runId),
    readDuplicateBatch(db, runId),
  ]);
  if (!(boundary && duplicateBatch)) {
    throw new FinalDuplicateSnapshotError(
      "The sealed D2 boundary is unavailable"
    );
  }
  if (
    boundary.mode !== "shadow" ||
    boundary.runStatus !== "running" ||
    boundary.selectionComplete !== 1 ||
    boundary.duplicateBatchInputHash !== duplicateBatch.inputHash ||
    boundary.duplicateMemberCount !== duplicateBatch.positionMemberCount
  ) {
    throw new FinalDuplicateSnapshotError(
      "The final duplicate run boundary changed"
    );
  }
  if (boundary.resolutionCount > boundary.duplicateMemberCount) {
    throw new FinalDuplicateSnapshotError(
      "The canonical resolution set changed after D2"
    );
  }
  return { boundary, duplicateBatch };
}
